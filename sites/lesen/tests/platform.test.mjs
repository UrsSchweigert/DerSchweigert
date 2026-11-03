import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  createWebSpeech,
  createWebProgress,
  createWebReminders,
  createWebHaptics,
  createWebApp,
  createWebExport,
  createPlatformAdapter,
  UNSUPPORTED,
  PRACTICE_TIME_KEY,
  MAX_CARD_PRACTICE_MS,
  REPORT_FILENAME,
} from '../static/platform.mjs';

/** Minimal in-memory stand-in for localStorage. */
function createFakeStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  };
}

/**
 * Fake window with the Web Speech API pieces the adapter reads.
 * @param {{supported?: boolean, voices?: Array<Object>}} [options]
 */
function createFakeWindow({ supported = true, voices = [] } = {}) {
  const spoken = [];
  const win = {
    spoken,
    cancelled: 0,
    speechSynthesis: {
      getVoices: () => voices,
      speak: (utterance) => spoken.push(utterance),
      cancel: () => {
        win.cancelled++;
      },
    },
  };
  if (supported) {
    win.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
  } else {
    delete win.speechSynthesis;
  }
  return win;
}

test('web speech: supported window speaks through the Web Speech API', () => {
  const voices = [{ name: 'Anna', lang: 'de-DE', default: true }];
  const win = createFakeWindow({ voices });
  const speech = createWebSpeech(win);

  assert.equal(speech.kind, 'browser');
  assert.equal(speech.isSupported(), true);
  assert.equal(speech.voiceStatus('de'), 'available');
  speech.warm();
  speech.speak({ text: 'Mama', lang: 'de-DE', rate: 0.8 });

  assert.equal(win.spoken.length, 1);
  assert.equal(win.spoken[0].text, 'Mama');
  assert.equal(win.spoken[0].lang, 'de-DE');
  assert.equal(win.spoken[0].rate, 0.8);
  assert.equal(win.spoken[0].voice.name, 'Anna');

  const beforeCancel = win.cancelled;
  speech.cancel();
  assert.equal(win.cancelled, beforeCancel + 1);
});

test('web speech: unsupported window reports unsupported and never throws', () => {
  const win = createFakeWindow({ supported: false });
  const speech = createWebSpeech(win);
  let unsupported = 0;

  assert.equal(speech.isSupported(), false);
  assert.equal(speech.voiceStatus('de'), 'unknown');
  speech.warm();
  speech.cancel();
  speech.speak({ text: 'Mama', lang: 'de-DE', rate: 0.8, onUnsupported: () => unsupported++ });

  assert.equal(unsupported, 1);
  assert.equal(win.spoken.length, 0);
});

test('web speech: no matching voice calls onNoVoice instead of speaking', () => {
  const win = createFakeWindow({ voices: [{ name: 'English', lang: 'en-US' }] });
  const speech = createWebSpeech(win);
  let noVoice = 0;
  let unsupported = 0;

  speech.speak({
    text: 'Mama',
    lang: 'de-DE',
    rate: 0.8,
    onNoVoice: () => noVoice++,
    onUnsupported: () => unsupported++,
  });

  assert.equal(noVoice, 1);
  assert.equal(unsupported, 0);
  assert.equal(win.spoken.length, 0);
});

test('web speech: synthesis errors report onError except cancellations', () => {
  const win = createFakeWindow({ voices: [{ name: 'Anna', lang: 'de-DE' }] });
  const speech = createWebSpeech(win);
  let errors = 0;

  speech.speak({ text: 'Mama', lang: 'de-DE', rate: 0.8, onError: () => errors++ });
  win.spoken[0].onerror({ error: 'canceled' });
  win.spoken[0].onerror({ error: 'interrupted' });
  assert.equal(errors, 0);

  speech.speak({ text: 'Papa', lang: 'de-DE', rate: 0.8, onError: () => errors++ });
  win.spoken[1].onerror({ error: 'synthesis-failed' });
  assert.equal(errors, 1);
});

test('web speech: missing window is a safe unsupported adapter', () => {
  const speech = createWebSpeech(undefined);

  assert.equal(speech.isSupported(), false);
  assert.doesNotThrow(() => speech.warm());
  assert.doesNotThrow(() => speech.cancel());
  assert.doesNotThrow(() => speech.speak({ text: 'Mama', lang: 'de-DE' }));
});

test('web progress: round-trips stats, language and selection through the store', () => {
  const store = createFakeStore();
  const progress = createWebProgress(store);

  assert.deepEqual(progress.read(), {});
  progress.write({ Mama: { correct_count: 2, incorrect_count: 1 } });
  assert.deepEqual(progress.read(), { Mama: { correct_count: 2, incorrect_count: 1 } });

  assert.equal(progress.readLanguage(), 'de');
  progress.writeLanguage('en');
  assert.equal(progress.readLanguage(), 'en');
  progress.writeLanguage('fr');
  assert.equal(progress.readLanguage(), 'de');

  assert.equal(progress.readSelection('de'), null);
  progress.writeSelection('de', { consonants: ['m'], vowels: ['a'], specials: [] });
  assert.deepEqual(progress.readSelection('de'), { consonants: ['m'], vowels: ['a'], specials: [] });
  assert.equal(progress.readSelection('en'), null);
});

test('web progress: corrupt or absent store falls back to defaults', () => {
  const store = createFakeStore({
    'buchstabenzeit:card-stats': '{not json',
    'buchstabenzeit:language': 'de',
    'buchstabenzeit:selection:de': '[]',
  });
  const progress = createWebProgress(store);

  assert.deepEqual(progress.read(), {});
  assert.equal(progress.readLanguage(), 'de');
  assert.equal(progress.readSelection('de'), null);

  const missing = createWebProgress(undefined);
  assert.deepEqual(missing.read(), {});
  assert.equal(missing.readLanguage(), 'de');
  assert.equal(missing.readSelection('de'), null);
  assert.doesNotThrow(() => missing.write({ a: 1 }));
  assert.doesNotThrow(() => missing.writeLanguage('en'));
  assert.doesNotThrow(() => missing.writeSelection('de', { consonants: [], vowels: [], specials: [] }));
});

test('web progress: practice time accumulates, is capped per card and survives corruption', () => {
  const store = createFakeStore();
  const progress = createWebProgress(store);

  assert.equal(progress.readPracticeMs(), 0);
  progress.addPracticeMs(1500);
  progress.addPracticeMs('2500');
  assert.equal(progress.readPracticeMs(), 4000);
  assert.equal(store.getItem(PRACTICE_TIME_KEY), '4000');

  progress.addPracticeMs(-500);
  progress.addPracticeMs('not-a-number');
  progress.addPracticeMs(Number.NaN);
  assert.equal(progress.readPracticeMs(), 4000);

  progress.addPracticeMs(MAX_CARD_PRACTICE_MS * 10);
  assert.equal(progress.readPracticeMs(), 4000 + MAX_CARD_PRACTICE_MS);

  const corrupt = createWebProgress(createFakeStore({ [PRACTICE_TIME_KEY]: '{oops' }));
  assert.equal(corrupt.readPracticeMs(), 0);

  const missing = createWebProgress(undefined);
  assert.equal(missing.readPracticeMs(), 0);
  assert.equal(missing.addPracticeMs(1000), 1000);
  assert.equal(missing.readPracticeMs(), 0);
});

test('web export: native shell writes the CSV and opens the share sheet', async () => {
  const calls = [];
  const win = {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        Filesystem: {
          writeFile: async (options) => {
            calls.push(['writeFile', options]);
            return { uri: 'file:///cache/report.csv' };
          },
          getUri: async (options) => {
            calls.push(['getUri', options]);
            return { uri: 'file:///cache/buchstabenzeit-report.csv' };
          },
        },
        Share: {
          share: async (options) => {
            calls.push(['share', options]);
          },
        },
      },
    },
  };
  const exporter = createWebExport(win);

  assert.equal(exporter.kind, 'native');
  assert.equal(exporter.isSupported(), true);
  assert.deepEqual(await exporter.save('card,correct\n"Mama",1\n', REPORT_FILENAME), {
    saved: true,
    kind: 'native',
  });
  assert.deepEqual(calls[0], [
    'writeFile',
    { path: REPORT_FILENAME, data: 'card,correct\n"Mama",1\n', directory: 'CACHE', encoding: 'UTF8' },
  ]);
  assert.deepEqual(calls[1], ['getUri', { path: REPORT_FILENAME, directory: 'CACHE' }]);
  assert.equal(calls[2][0], 'share');
  assert.equal(calls[2][1].title, REPORT_FILENAME);
  assert.equal(calls[2][1].url, 'file:///cache/buchstabenzeit-report.csv');
});

/** Fake browser download surface that records blob and anchor usage. */
function createFakeDownloadWindow() {
  const created = [];
  const clicks = [];
  const revoked = [];
  const appended = [];
  const win = {
    Blob: class {
      constructor(parts, options) {
        this.parts = parts;
        this.options = options;
      }
    },
    URL: {
      createObjectURL: (blob) => {
        created.push(blob);
        return 'blob:report';
      },
      revokeObjectURL: (href) => revoked.push(href),
    },
    document: {
      body: {
        appendChild: (anchor) => appended.push(anchor),
      },
      createElement: (tag) => {
        const anchor = { tag, click: () => clicks.push(anchor), remove: () => {} };
        return anchor;
      },
    },
  };
  return { win, created, clicks, revoked, appended };
}

test('web export: the browser path downloads the CSV through a blob and anchor', async () => {
  const { win, created, clicks, revoked, appended } = createFakeDownloadWindow();
  const previousFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = () => {
    fetches++;
    throw new Error('export must not use the network');
  };
  try {
    const exporter = createWebExport(win);

    assert.equal(exporter.kind, 'web');
    assert.equal(exporter.isSupported(), true);
    const result = await exporter.save('card,correct\n"Mama",1\n');

    assert.deepEqual(result, { saved: true, kind: 'download' });
    assert.equal(created.length, 1);
    assert.deepEqual(created[0].parts, ['card,correct\n"Mama",1\n']);
    assert.equal(created[0].options.type, 'text/csv;charset=utf-8');
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0].href, 'blob:report');
    assert.equal(clicks[0].download, REPORT_FILENAME);
    assert.deepEqual(appended, [clicks[0]]);
    assert.deepEqual(revoked, ['blob:report']);
    assert.equal(fetches, 0);
  } finally {
    if (previousFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previousFetch;
    }
  }
});

test('web export: a native shell without plugins fails instead of downloading', async () => {
  const { win, created, clicks } = createFakeDownloadWindow();
  win.Capacitor = { isNativePlatform: () => true };
  const exporter = createWebExport(win);

  assert.equal(exporter.kind, 'native');
  assert.equal(exporter.isSupported(), false);
  assert.deepEqual(await exporter.save('a,b\n1,2\n'), {
    saved: false,
    kind: 'native',
    reason: UNSUPPORTED,
  });
  assert.equal(created.length, 0);
  assert.equal(clicks.length, 0);
});

test('web export: a failing native write reports failure without a web fallback', async () => {
  const { win, created, clicks } = createFakeDownloadWindow();
  const shared = [];
  win.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Filesystem: {
        writeFile: async () => {
          throw new Error('disk full');
        },
        getUri: async () => ({ uri: 'file:///cache/report.csv' }),
      },
      Share: {
        share: async (options) => {
          shared.push(options);
        },
      },
    },
  };
  const exporter = createWebExport(win);

  assert.deepEqual(await exporter.save('a,b\n1,2\n'), {
    saved: false,
    kind: 'native',
    reason: 'failed',
  });
  assert.equal(shared.length, 0);
  assert.equal(created.length, 0);
  assert.equal(clicks.length, 0);
});

test('web export: a missing browser download surface is unsupported', async () => {
  const exporter = createWebExport({ document: {} });

  assert.equal(exporter.kind, 'web');
  assert.equal(exporter.isSupported(), false);
  assert.deepEqual(await exporter.save('a,b\n'), {
    saved: false,
    kind: 'download',
    reason: UNSUPPORTED,
  });
});

test('web reminders: unsupported, denied and no-ops without touching Notification', async () => {
  const previous = globalThis.Notification;
  let touched = 0;
  globalThis.Notification = {
    requestPermission: async () => {
      touched++;
      return 'granted';
    },
  };
  try {
    const reminders = createWebReminders();

    assert.equal(reminders.isSupported(), false);
    assert.equal(await reminders.requestPermission(), 'denied');
    assert.equal(await reminders.schedule({ at: '08:00' }), UNSUPPORTED);
    assert.equal(await reminders.cancelAll(), UNSUPPORTED);
    assert.equal(reminders.status(), UNSUPPORTED);
    assert.equal(touched, 0);
  } finally {
    if (previous === undefined) {
      delete globalThis.Notification;
    } else {
      globalThis.Notification = previous;
    }
  }
});

test('web haptics: unsupported no-ops', async () => {
  const haptics = createWebHaptics();

  assert.equal(haptics.isSupported(), false);
  assert.equal(await haptics.impact('light'), UNSUPPORTED);
  assert.equal(await haptics.vibrate(100), UNSUPPORTED);
});

test('platform adapter: exposes the four capabilities plus app without Capacitor', () => {
  const store = createFakeStore();
  const win = createFakeWindow({ voices: [{ lang: 'de-DE' }] });
  win.localStorage = store;
  const platform = createPlatformAdapter({ window: win });

  assert.equal(platform.speech.kind, 'browser');
  assert.equal(platform.progress.readLanguage(), 'de');
  assert.equal(platform.reminders.isSupported(), false);
  assert.equal(platform.haptics.isSupported(), false);

  assert.equal(platform.app.isSupported(), false);
  assert.equal(platform.app.kind, 'web');
  const handle = platform.app.addListener('backButton', () => {});
  assert.equal(typeof handle.remove, 'function');
  assert.doesNotThrow(() => handle.remove());
  assert.doesNotThrow(() => platform.app.exitApp());
});

test('platform adapter: forwards listeners and exitApp to a Capacitor App plugin', () => {
  const calls = [];
  const win = {
    Capacitor: {
      Plugins: {
        App: {
          addListener: (eventName, handler) => {
            calls.push(['addListener', eventName]);
            return { remove: () => calls.push(['remove', eventName]) };
          },
          exitApp: () => calls.push(['exitApp']),
        },
      },
    },
  };
  const platform = createPlatformAdapter({ window: win });

  assert.equal(platform.app.isSupported(), true);
  assert.equal(platform.app.kind, 'native');
  const handler = () => {};
  const handle = platform.app.addListener('appStateChange', handler);
  platform.app.exitApp();
  handle.remove();

  assert.deepEqual(calls, [
    ['addListener', 'appStateChange'],
    ['exitApp'],
    ['remove', 'appStateChange'],
  ]);
});

test('platform adapter: defaults are safe outside a browser', () => {
  const platform = createPlatformAdapter();

  assert.equal(platform.speech.isSupported(), false);
  assert.deepEqual(platform.progress.read(), {});
  assert.equal(platform.reminders.isSupported(), false);
  assert.equal(platform.haptics.isSupported(), false);
  assert.equal(platform.app.isSupported(), false);
  assert.equal(platform.export.kind, 'web');
  assert.equal(platform.export.isSupported(), false);
});

test('web app: addListener without a plugin returns a removable no-op handle', () => {
  const app = createWebApp(undefined);

  const handle = app.addListener('backButton', () => {
    throw new Error('must not be called');
  });
  assert.equal(typeof handle.remove, 'function');
  assert.doesNotThrow(() => handle.remove());
  assert.doesNotThrow(() => app.exitApp());
});
