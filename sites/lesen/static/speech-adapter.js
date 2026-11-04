/**
 * Platform speech adapter for Buchstabenzeit.
 * Provides a unified interface to speech synthesis across platforms.
 * B1: Browser speech via Web Speech API.
 * B2: Will add native Android speech.
 */

/**
 * Check voice availability for a given language.
 * @param {Array<{lang: string}>} voices - Array of available voices with lang property.
 * @param {string} lang - Language code (e.g., 'de').
 * @returns {'unknown' | 'none' | 'available'}
 */
export function browserVoiceStatus(voices, lang) {
  if (voices.length === 0) {
    return 'unknown';
  }
  const found = voices.some(v =>
    v.lang.toLowerCase().replace('_', '-').startsWith(lang)
  );
  return found ? 'available' : 'none';
}

/**
 * Select a browser voice by language, with priority for default and localService.
 * @param {Array<{lang: string, default?: boolean, localService?: boolean}>} voices - Array of available voices.
 * @param {string} lang - Language code (e.g., 'de-DE').
 * @returns {Object|null} The selected voice, or null if no match found.
 */
export function selectBrowserVoice(voices, lang) {
  const prefix = String(lang).split('-')[0].toLowerCase();
  const candidates = voices.filter(v =>
    v.lang.toLowerCase().replace('_', '-').startsWith(prefix)
  );

  if (candidates.length === 0) {
    return null;
  }

  // Priority a: first candidate with default === true
  const defaultVoice = candidates.find(v => v.default === true);
  if (defaultVoice) {
    return defaultVoice;
  }

  // Priority b: first candidate with localService === true
  const localVoice = candidates.find(v => v.localService === true);
  if (localVoice) {
    return localVoice;
  }

  // Priority c: first candidate
  return candidates[0];
}

/**
 * Create a browser-based speech adapter using Web Speech API.
 * @param {Window} [win=window] - Window object (for testing).
 * @returns {Object} Adapter with kind, isSupported, voiceStatus, warm, cancel, speak.
 */
export function createBrowserSpeechAdapter(win = window) {
  return {
    kind: 'browser',

    isSupported() {
      return 'speechSynthesis' in win && 'SpeechSynthesisUtterance' in win;
    },

    voiceStatus(lang) {
      return browserVoiceStatus(win.speechSynthesis?.getVoices() || [], lang);
    },

    warm() {
      win.speechSynthesis?.getVoices();
    },

    cancel() {
      win.speechSynthesis?.cancel();
    },

    speak({ text, lang, rate, onUnsupported, onNoVoice, onError }) {
      if (!this.isSupported()) {
        onUnsupported?.();
        return;
      }
      
      const prefix = String(lang).split('-')[0].toLowerCase();
      if (this.voiceStatus(prefix) === 'none') {
        onNoVoice?.();
        return;
      }

      this.cancel();
      const utterance = new win.SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = rate;
      const voice = selectBrowserVoice(win.speechSynthesis.getVoices() || [], lang);
      if (voice) {
        utterance.voice = voice;
      }
      utterance.onerror = event => {
        if (event.error !== 'canceled' && event.error !== 'interrupted') {
          onError?.();
        }
      };
      win.speechSynthesis.speak(utterance);
    }
  };
}

/**
 * Create a native (Capacitor) speech adapter using offline TTS plugin.
 * @param {Object} plugin - The OfflineTts plugin from Capacitor.
 * @returns {Object} Adapter with kind, isSupported, warm, cancel, speak.
 */
export function createNativeSpeechAdapter(plugin) {
  let initPromise = null;

  return {
    kind: 'native',

    isSupported() {
      return true;
    },

    async warm() {
      try {
        if (!initPromise) {
          initPromise = plugin.initialize();
        }
        await initPromise;
      } catch (e) {
        // Ignore initialization errors during warm
      }
    },

    async cancel() {
      try {
        await plugin.stop();
      } catch (e) {
        // Ignore cancel errors
      }
    },

    async speak({ text, lang, rate, pitch, onUnsupported, onNoVoice, onError }) {
      try {
        if (!initPromise) {
          initPromise = plugin.initialize();
        }
        const init = await initPromise;
        if (!init || init.status !== 'ready') {
          onNoVoice?.();
          return;
        }

        const list = await plugin.listOfflineVoices({ lang });
        if (!list || !list.suitableCount) {
          onNoVoice?.();
          return;
        }

        await plugin.speak({ text, lang, rate, pitch: pitch ?? 1.0 });
      } catch (e) {
        onError?.();
      }
    }
  };
}

/**
 * Factory for the appropriate speech adapter.
 * B1: Returns browser adapter.
 * B2: Detects native speech and returns native adapter if available.
 * @param {Window} [win=window] - Window object (for testing).
 * @returns {Object} Speech adapter.
 */
export function createSpeechAdapter(win = window) {
  const plugin = win.Capacitor?.Plugins?.OfflineTts;
  if (plugin) {
    return createNativeSpeechAdapter(plugin);
  }
  return createBrowserSpeechAdapter(win);
}
