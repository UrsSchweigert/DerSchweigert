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
 * Normalize a locale string for comparison (e.g., "de_DE" -> "de-de").
 * @param {string} locale - The locale string.
 * @returns {string} The normalized locale.
 */
function normalizeLocale(locale) {
  if (!locale) return "";
  return locale.replace(/_/g, "-").toLowerCase();
}

/**
 * Check whether a locale is standard German (de-DE), which is preferred
 * over other German variants such as de-AT or de-CH.
 * @param {string} locale - The locale string.
 * @returns {boolean} True for de-DE regardless of case or separator.
 */
function isStandardGermanLocale(locale) {
  return normalizeLocale(locale) === "de-de";
}

/**
 * Filter voices to those suitable for offline use in a given language.
 * A voice is offline-suitable iff:
 * - Its locale language matches the requested language
 * - It does NOT require network connection
 * - It is NOT marked as not-installed
 *
 * Results are stable-sorted so an exact de-DE voice is offered before other
 * German variants; filtering semantics are unchanged.
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

  const suitable = voices.filter((voice) => {
    const voiceLanguage = getLanguageFromLocale(voice.locale);
    return (
      voiceLanguage === targetLanguage &&
      !voice.networkRequired &&
      !voice.notInstalled
    );
  });

  // Array.prototype.sort is stable, so equal-ranked voices keep their order.
  return suitable.sort(
    (a, b) => Number(isStandardGermanLocale(b.locale)) - Number(isStandardGermanLocale(a.locale))
  );
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
