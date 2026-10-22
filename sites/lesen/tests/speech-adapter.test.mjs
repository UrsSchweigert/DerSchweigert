import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { browserVoiceStatus, selectBrowserVoice, createBrowserSpeechAdapter, createSpeechAdapter } from '../static/speech-adapter.js';

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

  await t.test('speak does not set utterance.voice when only English voices available', () => {
    let capturedUtterance = null;
    const fakeWindow = {
      speechSynthesis: {
        cancel: () => {},
        getVoices: () => [{ name: 'David', lang: 'en-US', localService: true }],
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
    assert.equal(capturedUtterance.voice, null, 'utterance.voice should not be set when no German voice found');
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
});
