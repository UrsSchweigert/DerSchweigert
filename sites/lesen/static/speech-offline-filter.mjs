/**
 * Voice filtering logic for offline-only TextToSpeech.
 * This module provides pure functions to filter voices based on offline capability
 * and language. It mirrors native Android filter logic for cross-platform consistency.
 */

/**
 * Extract the language code (part before '-' or '_') from a locale string.
 * @param {string} locale - The locale string (e.g., "de-DE", "de_DE", "de")
 * @returns {string} The language code (e.g., "de")
 */
function getLanguageFromLocale(locale) {
  if (!locale) return "";
  return locale.split(/[-_]/)[0].toLowerCase();
}

/**
 * Filter voices to those suitable for offline use in a given language.
 * A voice is offline-suitable iff:
 * - Its locale language matches the requested language
 * - It does NOT require network connection
 * - It is NOT marked as not-installed
 *
 * @param {Array} voices - Array of voice objects with { name, locale, networkRequired, notInstalled }
 * @param {string} lang - The desired language code or locale (e.g., "de" or "de-DE")
 * @returns {Array} Array of offline-suitable voices for the language
 */
export function selectOfflineVoices(voices, lang) {
  if (!Array.isArray(voices) || !lang) {
    return [];
  }

  const targetLanguage = getLanguageFromLocale(lang);

  return voices.filter((voice) => {
    const voiceLanguage = getLanguageFromLocale(voice.locale);
    return (
      voiceLanguage === targetLanguage &&
      !voice.networkRequired &&
      !voice.notInstalled
    );
  });
}

/**
 * Check if at least one offline-suitable voice exists for the language.
 *
 * @param {Array} voices - Array of voice objects with { name, locale, networkRequired, notInstalled }
 * @param {string} lang - The desired language code or locale
 * @returns {boolean} True if at least one offline voice is available
 */
export function hasOfflineVoice(voices, lang) {
  return selectOfflineVoices(voices, lang).length > 0;
}
