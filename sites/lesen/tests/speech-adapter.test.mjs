import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { browserVoiceStatus, selectBrowserVoice, createBrowserSpeechAdapter, createSpeechAdapter, createNativeSpeechAdapter } from '../static/speech-adapter.js';

test('selectBrowserVoice', async t => {
  await t.test('no German voices returns null', () => {
    const voices = [{ lang: 'en-US', localService: true }];
    const result = selectBrowserVoice(voices, 'de-DE');
    assert.equal(result, null);
  });

  await t.test('prefers default:true German over others', () => {
    const voices = [
      { name: 'X', lang: 'de-DE', localService: true },
      { name: 'Anna', lang: 'de-DE', default: true, localService: true }
    ];
    const result = selectBrowserVoice(voices, 'de-DE');
    assert.equal(result.name, 'Anna');
  });

  await t.test('no default, prefers localService:true (first)', () => {
    const voices = [
      { name: 'Net', lang: 'de-DE', localService: false },
      { name: 'Anna', lang: 'de-DE', localService: true }
    ];
    const result = selectBrowserVoice(voices, 'de-DE');
    assert.equal(result.name, 'Anna');
  });

  await t.test('no default, no localService returns first candidate', () => {
    const voices = [
      { name: 'A', lang: 'de-DE' },
      { name: 'B', lang: 'de-DE' }
    ];
    const result = selectBrowserVoice(voices, 'de-DE');
    assert.equal(result.name, 'A');
  });

  await t.test('excludes non-German voices (prefers German)', () => {
    const voices = [
      { name: 'Dan', lang: 'en-GB', default: true },
      { name: 'Anna', lang: 'de-DE', localService: true }
    ];
    const result = selectBrowserVoice(voices, 'de-DE');
    assert.equal(result.name, 'Anna');
  });

  await t.test('handles underscore and case variations', () => {
    const voices = [
      { name: 'Anna', lang: 'DE_de', localService: true }
    ];
    const result = selectBrowserVoice(voices, 'de-DE');
    assert.equal(result.name, 'Anna');
  });
});

test('browserVoiceStatus', async t => {
  await t.test('empty array returns "unknown"', () => {
    const result = browserVoiceStatus([], 'de');
    assert.equal(result, 'unknown');
  });

  await t.test('populated array with no matching lang returns "none"', () => {
    const voices = [{ lang: 'en-US' }, { lang: 'fr-FR' }];
    const result = browserVoiceStatus(voices, 'de');
    assert.equal(result, 'none');
  });

  await t.test('array with matching de-DE returns "available"', () => {
    const voices = [{ lang: 'en-US' }, { lang: 'de-DE' }, { lang: 'fr-FR' }];
    const result = browserVoiceStatus(voices, 'de');
    assert.equal(result, 'available');
  });

  await t.test('array with underscore and case variations returns "available"', () => {
    const voices = [{ lang: 'DE_de' }];
    const result = browserVoiceStatus(voices, 'de');
    assert.equal(result, 'available');
  });

  await t.test('array with de-AT (Austrian German) returns "available" for lang "de"', () => {
    const voices = [{ lang: 'en-US' }, { lang: 'de-AT' }];
    const result = browserVoiceStatus(voices, 'de');
    assert.equal(result, 'available');
  });
});

test('createBrowserSpeechAdapter', async t => {
  await t.test('returns object with kind "browser"', () => {
    const adapter = createBrowserSpeechAdapter({});
    assert.equal(adapter.kind, 'browser');
  });

  await t.test('isSupported returns false for empty window', () => {
    const adapter = createBrowserSpeechAdapter({});
    assert.equal(adapter.isSupported(), false);
  });

  await t.test('isSupported returns true for window with speechSynthesis and SpeechSynthesisUtterance', () => {
    const fakeWindow = {
      speechSynthesis: {},
      SpeechSynthesisUtterance: function() {}
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    assert.equal(adapter.isSupported(), true);
  });

  await t.test('voiceStatus calls browserVoiceStatus with getVoices result', () => {
    const fakeWindow = {
      speechSynthesis: {
        getVoices: () => [{ lang: 'de-DE' }]
      },
      SpeechSynthesisUtterance: function() {}
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    assert.equal(adapter.voiceStatus('de'), 'available');
  });

  await t.test('warm calls getVoices safely', () => {
    let called = false;
    const fakeWindow = {
      speechSynthesis: {
        getVoices: () => { called = true; return []; }
      }
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    adapter.warm();
    assert.equal(called, true);
  });

  await t.test('cancel calls speechSynthesis.cancel', () => {
    let cancelCalled = false;
    const fakeWindow = {
      speechSynthesis: {
        cancel: () => { cancelCalled = true; }
      }
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    adapter.cancel();
    assert.equal(cancelCalled, true);
  });

  await t.test('speak builds utterance with correct properties', () => {
    let builtUtterance = null;
    let speakCalled = false;
    const fakeWindow = {
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [],
        speak: (u) => { speakCalled = true; }
      },
      SpeechSynthesisUtterance: function(text) {
        this.text = text;
        this.lang = null;
        this.rate = null;
        this.onerror = null;
        builtUtterance = this;
      }
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    const onErrorCalled = { value: false };
    adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onError: () => { onErrorCalled.value = true; }
    });
    assert.equal(builtUtterance.text, 'test');
    assert.equal(builtUtterance.lang, 'de-DE');
    assert.equal(builtUtterance.rate, 0.8);
    assert.equal(speakCalled, true);
  });

  await t.test('speak calls onError for non-canceled errors', () => {
    let captured = null;
    const fakeWindow = {
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [],
        speak: (u) => { captured = u; }
      },
      SpeechSynthesisUtterance: function(text) {
        this.text = text;
        this.lang = null;
        this.rate = null;
        this.onerror = null;
      }
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    let onErrorCalled = false;
    adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onError: () => { onErrorCalled = true; }
    });
    assert.ok(captured, 'utterance was passed to speak');
    captured.onerror({ error: 'network' });
    assert.equal(onErrorCalled, true);
  });

  await t.test('speak ignores canceled and interrupted errors', () => {
    const fakeWindow = {
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [],
        speak: (u) => {}
      },
      SpeechSynthesisUtterance: function(text) {
        this.text = text;
        this.lang = null;
        this.rate = null;
        this.onerror = null;
      }
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    let onErrorCalled = false;
    let capturedUtterance = null;
    
    // Replace speak to capture the utterance
    fakeWindow.speechSynthesis.speak = (u) => { capturedUtterance = u; };
    
    adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onError: () => { onErrorCalled = true; }
    });
    
    // Simulate a 'canceled' error
    capturedUtterance.onerror({ error: 'canceled' });
    assert.equal(onErrorCalled, false, 'onError should not be called for canceled');
    
    // Simulate an 'interrupted' error
    capturedUtterance.onerror({ error: 'interrupted' });
    assert.equal(onErrorCalled, false, 'onError should not be called for interrupted');
    
    // Simulate a real error
    capturedUtterance.onerror({ error: 'network' });
    assert.equal(onErrorCalled, true, 'onError should be called for other errors');
  });

  await t.test('speak sets utterance.voice to German localService voice when available', () => {
    let capturedUtterance = null;
    const germanVoice = { name: 'Anna', lang: 'de-DE', localService: true };
    const fakeWindow = {
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [germanVoice],
        speak: (u) => { capturedUtterance = u; }
      },
      SpeechSynthesisUtterance: function(text) {
        this.text = text;
        this.lang = null;
        this.rate = null;
        this.voice = null;
        this.onerror = null;
      }
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onError: () => {}
    });
    assert.equal(capturedUtterance.voice, germanVoice, 'utterance.voice should be set to the German voice');
  });

  await t.test('speak calls onNoVoice when only English voices available', () => {
    const fakeWindow = {
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [{ name: 'David', lang: 'en-US', localService: true }],
        speak: (u) => {}
      },
      SpeechSynthesisUtterance: function(text) {
        this.text = text;
        this.lang = null;
        this.rate = null;
        this.voice = null;
        this.onerror = null;
      }
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    let onNoVoiceCalled = false;
    adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onNoVoice: () => { onNoVoiceCalled = true; }
    });
    assert.equal(onNoVoiceCalled, true, 'onNoVoice should be called when no German voice found');
  });
});

test('createSpeechAdapter', async t => {
  await t.test('returns an adapter for B1 (browser)', () => {
    const adapter = createSpeechAdapter({
      speechSynthesis: {},
      SpeechSynthesisUtterance: function() {}
    });
    assert.equal(adapter.kind, 'browser');
    assert.equal(typeof adapter.isSupported, 'function');
    assert.equal(typeof adapter.speak, 'function');
    assert.equal(typeof adapter.cancel, 'function');
    assert.equal(typeof adapter.warm, 'function');
    assert.equal(typeof adapter.voiceStatus, 'function');
  });

  await t.test('returns kind "native" when Capacitor.Plugins.OfflineTts is present', () => {
    const fakePlugin = {
      initialize: async () => ({ status: 'ready' }),
      listOfflineVoices: async () => ({ voices: [], suitableCount: 0 }),
      speak: async () => {},
      stop: async () => {}
    };
    const adapter = createSpeechAdapter({
      Capacitor: {
        Plugins: {
          OfflineTts: fakePlugin
        }
      }
    });
    assert.equal(adapter.kind, 'native');
  });

  await t.test('returns kind "browser" when Capacitor is absent', () => {
    const adapter = createSpeechAdapter({
      speechSynthesis: {},
      SpeechSynthesisUtterance: function() {}
    });
    assert.equal(adapter.kind, 'browser');
  });
});

test('Browser adapter speak with outcome callbacks', async t => {
  await t.test('calls onUnsupported when not supported', async () => {
    const unsupportedWindow = {};
    const adapter = createBrowserSpeechAdapter(unsupportedWindow);
    let onUnsupportedCalled = false;
    await adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onUnsupported: () => { onUnsupportedCalled = true; }
    });
    assert.equal(onUnsupportedCalled, true);
  });

  await t.test('calls onNoVoice when no German voices available', async () => {
    const fakeWindow = {
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [{ name: 'David', lang: 'en-US' }]
      },
      SpeechSynthesisUtterance: function() {
        this.lang = null;
        this.rate = null;
        this.voice = null;
        this.onerror = null;
      }
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    let onNoVoiceCalled = false;
    adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onNoVoice: () => { onNoVoiceCalled = true; }
    });
    assert.equal(onNoVoiceCalled, true);
  });

  await t.test('calls speechSynthesis.speak when German voice is available', async () => {
    let speakCalled = false;
    const germanVoice = { name: 'Anna', lang: 'de-DE', localService: true };
    const fakeWindow = {
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [germanVoice],
        speak: () => { speakCalled = true; }
      },
      SpeechSynthesisUtterance: function(text) {
        this.text = text;
        this.lang = null;
        this.rate = null;
        this.voice = null;
        this.onerror = null;
      }
    };
    const adapter = createBrowserSpeechAdapter(fakeWindow);
    let utteranceVoice = null;
    fakeWindow.speechSynthesis.speak = (u) => {
      utteranceVoice = u.voice;
      speakCalled = true;
    };
    adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onNoVoice: () => {}
    });
    assert.equal(speakCalled, true);
    assert.equal(utteranceVoice, germanVoice);
  });
});

test('Native adapter speak with outcome callbacks', async t => {
  await t.test('calls onNoVoice when listOfflineVoices returns suitableCount 0', async () => {
    const fakePlugin = {
      initialize: async () => ({ status: 'ready', languageAvailable: true }),
      listOfflineVoices: async () => ({ voices: [], suitableCount: 0 }),
      speak: async () => {},
      stop: async () => {}
    };
    const adapter = createNativeSpeechAdapter(fakePlugin);
    let onNoVoiceCalled = false;
    await adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onNoVoice: () => { onNoVoiceCalled = true; }
    });
    assert.equal(onNoVoiceCalled, true);
  });

  await t.test('calls plugin.speak when suitableCount >= 1', async () => {
    let pluginSpeakCalled = false;
    const fakePlugin = {
      initialize: async () => ({ status: 'ready', languageAvailable: true }),
      listOfflineVoices: async () => ({ voices: ['voice1'], suitableCount: 1 }),
      speak: async () => { pluginSpeakCalled = true; },
      stop: async () => {}
    };
    const adapter = createNativeSpeechAdapter(fakePlugin);
    await adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8
    });
    assert.equal(pluginSpeakCalled, true);
  });

  await t.test('calls onError when plugin.speak rejects', async () => {
    const fakePlugin = {
      initialize: async () => ({ status: 'ready', languageAvailable: true }),
      listOfflineVoices: async () => ({ voices: ['voice1'], suitableCount: 1 }),
      speak: async () => { throw new Error('speak failed'); },
      stop: async () => {}
    };
    const adapter = createNativeSpeechAdapter(fakePlugin);
    let onErrorCalled = false;
    await adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onError: () => { onErrorCalled = true; }
    });
    assert.equal(onErrorCalled, true);
  });

  await t.test('calls onNoVoice when initialize status is not ready', async () => {
    const fakePlugin = {
      initialize: async () => ({ status: 'error', languageAvailable: false }),
      listOfflineVoices: async () => ({ voices: [], suitableCount: 0 }),
      speak: async () => {},
      stop: async () => {}
    };
    const adapter = createNativeSpeechAdapter(fakePlugin);
    let onNoVoiceCalled = false;
    await adapter.speak({
      text: 'test',
      lang: 'de-DE',
      rate: 0.8,
      onNoVoice: () => { onNoVoiceCalled = true; }
    });
    assert.equal(onNoVoiceCalled, true);
  });

  await t.test('caches initialize promise so it runs only once', async () => {
    let initCallCount = 0;
    const fakePlugin = {
      initialize: async () => {
        initCallCount++;
        return { status: 'ready', languageAvailable: true };
      },
      listOfflineVoices: async () => ({ voices: ['voice1'], suitableCount: 1 }),
      speak: async () => {},
      stop: async () => {}
    };
    const adapter = createNativeSpeechAdapter(fakePlugin);
    
    // First call
    await adapter.speak({ text: 'test1', lang: 'de-DE', rate: 0.8 });
    assert.equal(initCallCount, 1);
    
    // Second call should reuse cached promise
    await adapter.speak({ text: 'test2', lang: 'de-DE', rate: 0.8 });
    assert.equal(initCallCount, 1, 'initialize should only be called once');
  });

  await t.test('warm calls initialize and caches the promise', async () => {
    let initCallCount = 0;
    const fakePlugin = {
      initialize: async () => {
        initCallCount++;
        return { status: 'ready', languageAvailable: true };
      },
      listOfflineVoices: async () => ({ voices: ['voice1'], suitableCount: 1 }),
      speak: async () => {},
      stop: async () => {}
    };
    const adapter = createNativeSpeechAdapter(fakePlugin);
    
    // Warm should start initialization
    await adapter.warm();
    assert.equal(initCallCount, 1);
    
    // Speak should reuse the cached promise
    await adapter.speak({ text: 'test', lang: 'de-DE', rate: 0.8 });
    assert.equal(initCallCount, 1, 'initialize should only be called once total');
  });

  await t.test('cancel calls plugin.stop without throwing', async () => {
    let stopCalled = false;
    const fakePlugin = {
      initialize: async () => ({ status: 'ready' }),
      listOfflineVoices: async () => ({ voices: [], suitableCount: 0 }),
      speak: async () => {},
      stop: async () => { stopCalled = true; }
    };
    const adapter = createNativeSpeechAdapter(fakePlugin);
    await adapter.cancel();
    assert.equal(stopCalled, true);
  });
});
