/**
 * Internationalization (i18n) module for Buchstabenzeit.
 * 
 * This module provides a translation function t(lang, key) that looks up
 * translated strings in language-specific dictionaries. If a translation
 * is not found for the requested language, the key itself is returned as
 * a fallback.
 */

/**
 * German (Deutsch) translation dictionary.
 * Contains all user-visible strings from the application.
 */
const DE = {
  // Brand and main headings
  'app.title': 'Buchstabenzeit',
  'setup.title': 'Lesen lernen, Karte für Karte.',
  'setup.intro': 'Stelle deine Buchstabenkarten zusammen und lies in deinem eigenen Tempo. Jeder kleine Schritt zählt!',
  'practice.title': 'Deine Lesekarten',
  'complete.title': 'Alle Karten geschafft!',
  
  // Setup form labels
  'setup.consonants': 'Konsonanten',
  'setup.vowels': 'Vokale',
  'setup.specials': 'Besonderheiten',
  'setup.pattern': 'Buchstabenfolge',
  'setup.pattern.cv': 'Konsonant + Vokal',
  'setup.pattern.vc': 'Vokal + Konsonant',
  'setup.pattern.words': 'Wörter',
  'setup.pattern.words_desc': 'Wörter passen',
  'setup.pattern.flop': 'Flop Training',
  'setup.pattern.flop_desc': 'Die schwierigsten Karten',
  'setup.wordlength': 'Maximale Wortlänge',
  'setup.cardcount': 'Anzahl der Karten',
  'setup.start': 'Lesen starten',
  'setup.start_loading': 'Wörter werden geladen …',
  
  // Setup validation messages
  'setup.error.selection': 'Bitte wähle mindestens einen Konsonanten und einen Vokal aus.',
  'setup.error.wordlist': 'Die Wörterliste konnte nicht geladen werden. Bitte versuche es erneut.',
  'setup.error.no_flop': 'Keine Flop-Karten verfügbar.',
  'setup.error.no_words': 'Keine passenden Wörter gefunden. Wähle mehr Buchstaben oder eine andere Wortlänge.',
  'setup.warning.min_words': 'Mind. 10 Wörter erforderlich',
  'setup.warning.no_history': 'Noch kein passender Kartenverlauf vorhanden',
  
  // Practice screen
  'practice.stats.cleared': 'geschafft',
  'practice.stats.remaining': 'offen',
  'practice.stats.total': 'insgesamt',
  'practice.review_label': 'Noch einmal',
  'practice.button.finish': 'Auswahl',
  'practice.button.speak': 'Vorlesen',
  'practice.button.retry': 'Noch üben',
  'practice.button.correct': 'Richtig gelesen',
  
  // Feedback messages
  'feedback.card_done': 'Karte geschafft.',
  'feedback.try_again': 'Versuch es noch einmal.',
  'feedback.try_later': 'Diese Karte kommt am Ende noch einmal dran.',
  'feedback.tts_unsupported': 'Die Vorlesefunktion wird von diesem Browser nicht unterstützt.',
  'feedback.tts_no_voice': 'Keine deutsche Stimme verfügbar. Bitte aktiviere eine deutsche Sprachausgabe auf deinem Gerät.',
  'feedback.tts_error': 'Die deutsche Aussprache konnte nicht abgespielt werden.',
  
  // Complete screen
  'complete.button.again': 'Neue Runde',
  'complete.button.change': 'Buchstaben ändern',
  
  // Confirm end dialog
  'dialog.confirm_end.title': 'Übung beenden?',
  'dialog.confirm_end.text': 'Möchtest du die aktuelle Übung beenden und zur Auswahl zurückkehren?',
  'dialog.confirm_end.cancel': 'Weiter üben',
  'dialog.confirm_end.confirm': 'Beenden',
  
  // TTS disclaimer dialog
  'dialog.tts_disclaimer.title': 'Hinweis zum Vorlesen',
  'dialog.tts_disclaimer.text': 'Das Vorlesen nutzt die Sprachausgabe deines Geräts. Klang und Verfügbarkeit hängen von den Barrierefreiheits- bzw. Sprachausgabe-Einstellungen deines Geräts ab.',
  'dialog.tts_disclaimer.extra': 'Da die Silben teils keine echten Wörter sind, kann die Aussprache ungewöhnlich klingen.',
  'dialog.tts_disclaimer.close': 'Verstanden',
  
  // About dialog
  'dialog.about.title': 'Über Buchstabenzeit',
  'dialog.about.version': 'Version 1.0',
  'dialog.about.intro': 'Buchstabenzeit ist eine begleitete Leseübung. Ein Erwachsener wählt die Karten aus, begleitet das Kind beim Lesen und markiert die Antworten.',
  'dialog.about.privacy': 'Datenschutz',
  'dialog.about.privacy_text': 'Diese App sammelt keine persönlichen Daten, hat keine Benutzerkonten, keine Werbung und keine Analyse. Sie funktioniert vollständig offline und benötigt keine Internetverbindung.',
  'dialog.about.tts_privacy': 'Das Vorlesen nutzt die auf dem Gerät installierte Sprachausgabe (Text-to-Speech). Diese ist ein separater Dienst des Geräts; welche Daten sie verarbeitet, bestimmt die Geräteeinstellung, nicht diese App. Buchstabenzeit fordert nur lokal installierte Stimmen an und sendet dafür keine Daten ins Internet.',
  'dialog.about.licenses': 'Inhalte & Lizenzen',
  'dialog.about.wordlist': 'Wortliste: FrequencyWords & Wiktionary, CC BY-SA 4.0 – Lizenz',
  'dialog.about.font': 'Schriftart: Andika, SIL Open Font License 1.1 – Lizenz',
  
  // Pluralization support
  'unit.card': 'Karte',
  'unit.cards': 'Karten',
  'unit.attempt': 'Versuch',
  'unit.attempts': 'Versuche',
  'unit.selected': 'ausgewählt',
  'unit.in_flop': 'im Flop Training',
  'unit.in': 'in',
};

/**
 * Language-specific dictionaries.
 * Currently only contains German (de).
 * Future expansions would add 'en', 'fr', etc.
 */
const dictionaries = {
  de: DE,
};

/**
 * Translate a key into the specified language.
 * 
 * @param {string} lang - Language code (e.g., 'de', 'en')
 * @param {string} key - Translation key (e.g., 'setup.title')
 * @returns {string} Translated string, or the key itself if not found
 * 
 * @example
 * t('de', 'setup.title') // => 'Lesen lernen, Karte für Karte.'
 * t('de', 'nonexistent.key') // => 'nonexistent.key' (fallback)
 */
export function t(lang, key) {
  const dictionary = dictionaries[lang];
  if (!dictionary) {
    return key;
  }
  return dictionary[key] ?? key;
}

export default { t };
