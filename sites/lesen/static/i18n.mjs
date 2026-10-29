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
  'setup.pattern.patterns': 'Muster',
  'setup.pattern.patterns_desc': 'Silbenmuster kombinieren',
  'setup.pattern.sub.ma': 'ma',
  'setup.pattern.sub.am': 'am',
  'setup.pattern.sub.mam': 'mam',
  'setup.pattern.sub.ama': 'ama',
  'setup.pattern.words': 'Wörter',
  'setup.pattern.words_desc': 'Wörter passen',
  'setup.pattern.flop': 'Flops',
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
  'setup.error.no_pattern': 'Bitte wähle mindestens ein Muster aus.',
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
  'setup.pattern': 'Letter sequence',
  'setup.pattern.patterns': 'Patterns',
  'setup.pattern.patterns_desc': 'Combine syllable patterns',
  'setup.pattern.sub.ma': 'ma',
  'setup.pattern.sub.am': 'am',
  'setup.pattern.sub.mam': 'mam',
  'setup.pattern.sub.ama': 'ama',
  'setup.pattern.words': 'Words',
  'setup.pattern.words_desc': 'Matching words',
  'setup.pattern.flop': 'Flops',
  'setup.pattern.flop_desc': 'The trickiest cards',
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
  
  // Practice screen
  'practice.stats.cleared': 'completed',
  'practice.stats.remaining': 'remaining',
  'practice.stats.total': 'total',
  'practice.review_label': 'Review',
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
  
  // Complete screen
  'complete.button.again': 'New round',
  'complete.button.change': 'Change letters',
  
  // Confirm end dialog
  'dialog.confirm_end.title': 'End practice?',
  'dialog.confirm_end.text': 'Do you want to end the current practice and return to the selection?',
  'dialog.confirm_end.cancel': 'Continue practicing',
  'dialog.confirm_end.confirm': 'End',
  
  // TTS disclaimer dialog
  'dialog.tts_disclaimer.title': 'About read aloud',
  'dialog.tts_disclaimer.text': 'Read aloud uses your device\'s text-to-speech feature. Sound quality and availability depend on your device\'s accessibility settings.',
  'dialog.tts_disclaimer.extra': 'Since the syllables are not always real words, the pronunciation may sound unusual.',
  'dialog.tts_disclaimer.close': 'Got it',
  
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
