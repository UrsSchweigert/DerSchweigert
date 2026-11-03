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
  'setup.star_hint': '★ markiert den Buchstaben, mit dem du als Nächstes die meisten neuen Wörter lesen kannst.',
  'setup.mode': 'Modus',
  'setup.mode.patterns': 'Muster',
  'setup.mode.patterns_desc': 'Silbenmuster kombinieren',
  'setup.mode.sub.ma': 'ma',
  'setup.mode.sub.am': 'am',
  'setup.mode.sub.mam': 'mam',
  'setup.mode.sub.ama': 'ama',
  'setup.mode.words': 'Wörter',
  'setup.mode.words_desc': 'Wörter passen',
  'setup.mode.sentences': 'Sätze',
  'setup.mode.sentences_desc': 'Sätze passen',
  'setup.mode.flop': 'Flops',
  'setup.mode.flop_desc': 'Flop-Karten verfügbar',
  'setup.wordlength': 'Maximale Wortlänge',
  'setup.cardcount': 'Anzahl der Karten',
  'setup.start': 'Lesen starten',
  'setup.start_loading': 'Wörter werden geladen …',
  
  // Setup validation messages
  'setup.error.selection': 'Bitte wähle mindestens einen Konsonanten und einen Vokal aus.',
  'setup.error.wordlist': 'Die Wörterliste konnte nicht geladen werden. Bitte versuche es erneut.',
  'setup.error.no_flop': 'Keine Flop-Karten verfügbar.',
  'setup.error.no_words': 'Keine passenden Wörter gefunden. Wähle mehr Buchstaben oder eine andere Wortlänge.',
  'setup.error.no_pattern': 'Bitte wähle mindestens ein Muster aus.',
  'setup.warning.min_words': 'Mind. 10 Wörter erforderlich',
  'setup.warning.no_history': 'Noch kein passender Kartenverlauf vorhanden',
  'setup.error.sentencepool': 'Die Satzliste konnte nicht geladen werden. Bitte versuche es erneut.',
  'setup.error.no_sentences': 'Keine passenden Sätze gefunden. Wähle mehr Buchstaben.',
  
  // Practice screen
  'practice.stats.cleared': 'geschafft',
  'practice.stats.remaining': 'offen',
  'practice.stats.total': 'insgesamt',
  'practice.review_label': 'Noch einmal',
  'practice.progress_label': 'Geschaffte Karten',
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
  'feedback.tts_card_unsupported': 'Vorlesen gibt es nur für Wort- und Satzkarten.',
  
  // Complete screen
  'complete.button.again': 'Neue Runde',
  'complete.button.change': 'Buchstaben ändern',
  
  // Confirm end dialog
  'dialog.confirm_end.title': 'Übung beenden?',
  'dialog.confirm_end.text': 'Möchtest du die aktuelle Übung beenden und zur Auswahl zurückkehren?',
  'dialog.confirm_end.cancel': 'Weiter üben',
  'dialog.confirm_end.confirm': 'Beenden',
  
  // About dialog
  'dialog.about.title': 'Über Buchstabenzeit',
  'dialog.about.version': 'Version 1.0',
  'dialog.about.intro': 'Buchstabenzeit ist eine begleitete Leseübung. Ein Erwachsener wählt die Karten aus, begleitet das Kind beim Lesen und markiert die Antworten.',
  'dialog.about.privacy': 'Datenschutz',
  'dialog.about.privacy_text': 'Diese App sammelt keine persönlichen Daten, hat keine Benutzerkonten, keine Werbung und keine Analyse. Sie funktioniert vollständig offline und benötigt keine Internetverbindung.',
  'dialog.about.tts_privacy': 'Das Vorlesen nutzt die auf dem Gerät installierte Sprachausgabe (Text-to-Speech). Diese ist ein separater Dienst des Geräts; welche Daten sie verarbeitet, bestimmt die Geräteeinstellung, nicht diese App. Buchstabenzeit fordert nur lokal installierte Stimmen an und sendet dafür keine Daten ins Internet.',
  'dialog.about.licenses': 'Inhalte & Lizenzen',
  'dialog.about.wordlist': 'Wortliste: FrequencyWords & Wiktionary, CC BY-SA 4.0 – ',
  'dialog.about.font': 'Schriftart: Andika, SIL Open Font License 1.1 – ',
  
  // Pluralization support
  'unit.card': 'Karte',
  'unit.cards': 'Karten',
  'unit.attempt': 'Versuch',
  'unit.attempts': 'Versuche',
  'unit.attempts_dat': 'Versuchen',
  'unit.selected': 'ausgewählt',
  'unit.in_flop': 'in Flops',
  'unit.in': 'in',

  // About dialog license link (used as anchor text for license links)
  'dialog.about.license_link': 'Lizenz',

  // About dialog full privacy policy link
  'dialog.about.privacy_link': 'Vollständige Datenschutzerklärung',

  // About dialog close button
  'dialog.about.close': 'Schließen',

  // Document title shown in the browser tab
  'app.title_full': 'Buchstabenzeit | Leseübung',

  // Fallback feedback when no matching words are found for the Words pattern
  'feedback.pattern_fallback': 'Keine passenden Wörter gefunden – hier kommen Silbenmuster.',

  // Suffix for the completion summary sentence ("{cards} in {attempts} richtig gelesen.")
  'complete.summary_suffix': 'richtig gelesen.',

  // Setup screen: adult guidance note (details/summary block)
  'setup.adult_note.summary': 'Hinweise für Erwachsene',
  'setup.adult_note.text_1': 'Buchstabenzeit ist eine begleitete Leseübung: Ein Erwachsener wählt die Karten aus, begleitet das Kind beim Lesen und markiert die Antworten.',
  'setup.adult_note.text_2': 'Das Vorlesen ist eine optionale Hilfe. Es benötigt eine auf dem Gerät installierte deutsche Sprachausgabe und funktioniert offline nur, wenn eine passende Stimme vorhanden ist. Bei sehr kurzen Buchstabenfolgen kann die Aussprache vom natürlichen Klang abweichen.',
  'setup.adult_note.text_3': 'Die Übung lässt sich jederzeit vollständig ohne Ton nutzen.',

  // Footer
  'footer.tagline': 'Buchstabenzeit · Jeden Tag ein kleines Stück weiter.',
  'footer.about_button': 'Rechtliches & Datenschutz',
  'footer.parent_report': 'Bericht als CSV speichern',

  // Parent report export status
  'report.export_ready': 'Bericht gespeichert.',
  'report.export_failed': 'Bericht konnte nicht gespeichert werden.',
};

/**
 * English translation dictionary.
 * Contains all user-visible strings from the application in English.
 */
const EN = {
  // Brand and main headings
  'app.title': 'Letter time',
  'setup.title': 'Learn to read, card by card.',
  'setup.intro': 'Assemble your letter cards and read at your own pace. Every small step counts!',
  'practice.title': 'Your reading cards',
  'complete.title': 'All cards completed!',
  
  // Setup form labels
  'setup.consonants': 'Consonants',
  'setup.vowels': 'Vowels',
  'setup.specials': 'Special characters',
  'setup.star_hint': '★ marks the letter that unlocks the most new words to read next.',
  'setup.mode': 'Mode',
  'setup.mode.patterns': 'Patterns',
  'setup.mode.patterns_desc': 'Combine syllable patterns',
  'setup.mode.sub.ma': 'ma',
  'setup.mode.sub.am': 'am',
  'setup.mode.sub.mam': 'mam',
  'setup.mode.sub.ama': 'ama',
  'setup.mode.words': 'Words',
  'setup.mode.words_desc': 'Matching words',
  'setup.mode.sentences': 'Sentences',
  'setup.mode.sentences_desc': 'Matching sentences',
  'setup.mode.flop': 'Flops',
  'setup.mode.flop_desc': 'Flop cards available',
  'setup.wordlength': 'Maximum word length',
  'setup.cardcount': 'Number of cards',
  'setup.start': 'Start reading',
  'setup.start_loading': 'Loading words …',
  
  // Setup validation messages
  'setup.error.selection': 'Please select at least one consonant and one vowel.',
  'setup.error.wordlist': 'The word list could not be loaded. Please try again.',
  'setup.error.no_flop': 'No flop cards available.',
  'setup.error.no_words': 'No matching words found. Select more letters or a different word length.',
  'setup.error.no_pattern': 'Please select at least one pattern.',
  'setup.warning.min_words': 'Minimum 10 words required',
  'setup.warning.no_history': 'No matching card history available yet',
  'setup.error.sentencepool': 'The sentence list could not be loaded. Please try again.',
  'setup.error.no_sentences': 'No matching sentences found. Select more letters.',
  
  // Practice screen
  'practice.stats.cleared': 'completed',
  'practice.stats.remaining': 'remaining',
  'practice.stats.total': 'total',
  'practice.review_label': 'Review',
  'practice.progress_label': 'Completed cards',
  'practice.button.finish': 'Selection',
  'practice.button.speak': 'Read aloud',
  'practice.button.retry': 'Practice more',
  'practice.button.correct': 'Read correctly',
  
  // Feedback messages
  'feedback.card_done': 'Card completed.',
  'feedback.try_again': 'Try again.',
  'feedback.try_later': 'This card will come up again at the end.',
  'feedback.tts_unsupported': 'Text-to-speech is not supported by this browser.',
  'feedback.tts_no_voice': 'No English voice available. Please enable an English voice in your device settings.',
  'feedback.tts_error': 'Could not play the English pronunciation.',
  'feedback.tts_card_unsupported': 'Read aloud is only available for word and sentence cards.',
  
  // Complete screen
  'complete.button.again': 'New round',
  'complete.button.change': 'Change letters',
  
  // Confirm end dialog
  'dialog.confirm_end.title': 'End practice?',
  'dialog.confirm_end.text': 'Do you want to end the current practice and return to the selection?',
  'dialog.confirm_end.cancel': 'Continue practicing',
  'dialog.confirm_end.confirm': 'End',
  
  // About dialog
  'dialog.about.title': 'About Letter time',
  'dialog.about.version': 'Version 1.0',
  'dialog.about.intro': 'Letter time is guided reading practice. An adult chooses the cards, guides the child through reading, and marks the answers.',
  'dialog.about.privacy': 'Privacy',
  'dialog.about.privacy_text': 'This app collects no personal data, has no user accounts, no ads, and no analytics. It works completely offline and requires no internet connection.',
  'dialog.about.tts_privacy': 'Read aloud uses your device\'s installed text-to-speech feature. This is a separate service from your device; what data it processes is determined by your device settings, not by this app. Buchstabenzeit only requests locally installed voices and does not send any data to the internet.',
  'dialog.about.licenses': 'Content & Licenses',
  'dialog.about.wordlist': 'Word list: FrequencyWords & Wiktionary, CC BY-SA 4.0 – ',
  'dialog.about.font': 'Font: Andika, SIL Open Font License 1.1 – ',
  
  // Pluralization support
  'unit.card': 'card',
  'unit.cards': 'cards',
  'unit.attempt': 'attempt',
  'unit.attempts': 'attempts',
  'unit.attempts_dat': 'attempts',
  'unit.selected': 'selected',
  'unit.in_flop': 'in Flops',
  'unit.in': 'in',

  // About dialog license link (used as anchor text for license links)
  'dialog.about.license_link': 'License',

  // About dialog full privacy policy link
  'dialog.about.privacy_link': 'Full privacy policy',

  // About dialog close button
  'dialog.about.close': 'Close',

  // Document title shown in the browser tab
  'app.title_full': 'Letter time | Reading Practice',

  // Fallback feedback when no matching words are found for the Words pattern
  'feedback.pattern_fallback': 'No matching words found – here come syllable patterns.',

  // Suffix for the completion summary sentence ("{cards} in {attempts} richtig gelesen.")
  'complete.summary_suffix': 'read correctly.',

  // Setup screen: adult guidance note (details/summary block)
  'setup.adult_note.summary': 'Tips for adults',
  'setup.adult_note.text_1': 'Letter time is guided reading practice: An adult chooses the cards, guides the child through reading, and marks the answers.',
  'setup.adult_note.text_2': 'Read aloud is optional help. It requires an English voice installed on your device and works offline only if a matching voice is available. With very short letter sequences, the pronunciation may differ from natural speech.',
  'setup.adult_note.text_3': 'The practice works completely without sound.',

  // Footer
  'footer.tagline': 'Letter time · Every day a little bit further.',
  'footer.about_button': 'Legal & Privacy',
  'footer.parent_report': 'Save report as CSV',

  // Parent report export status
  'report.export_ready': 'Report saved.',
  'report.export_failed': 'Report could not be saved.',
};

/**
 * Language-specific dictionaries.
 * Currently contains German (de) and English (en).
 * Future expansions would add 'fr', etc.
 */
const dictionaries = {
  de: DE,
  en: EN,
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

export { DE, EN };
export default { t };
