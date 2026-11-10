// promo.js — landing page behaviour for /promo/.
//
// Three jobs, all of them optional enhancements on top of a fully static
// German page:
//   1. locale switching (German default, English on demand, no reload),
//   2. sprite-frame cycling for the hero animations,
//   3. scroll parallax and reveal animations (IntersectionObserver + rAF).
//
// Everything that touches `document`, `window`, `navigator` or
// `localStorage` is guarded so this module can be imported from plain Node
// (node:test) without a DOM — same pattern as game/i18n.js.
//
// Locale resolution (see getLocale()):
//   stored `ffm_locale` (shared with the game) wins; otherwise German — unless
//   `navigator.language` exists and does NOT start with "de", in which case
//   English. The static HTML is German, so no-JS visitors and crawlers
//   always get German.

export const SUPPORTED_LOCALES = ['de', 'en'];
export const DEFAULT_LOCALE = 'de';
// Shared with the game (sites/ffm/static/game/i18n.js) so a language picked
// here is the one /play opens with, and the privacy policy only has to list
// one key.
export const STORAGE_KEY = 'ffm_locale';

// key -> { de, en }. The German values are byte-identical to the markup in
// index.html (promo.test.js enforces that, so copy can never drift).
export const DICTIONARY = {
  // Accessibility / navigation chrome
  'a11y.skip': { de: 'Zum Inhalt springen', en: 'Skip to content' },
  'a11y.mainNav': { de: 'Hauptnavigation', en: 'Main navigation' },
  'nav.game': { de: 'Spiel', en: 'Game' },
  'nav.art': { de: 'Kunst', en: 'Art' },
  'nav.prices': { de: 'Preise', en: 'Pricing' },
  'nav.family': { de: 'Familie', en: 'Family' },
  'nav.faq': { de: 'FAQ', en: 'FAQ' },
  'nav.play': { de: 'Jetzt spielen', en: 'Play now' },
  'nav.langToggle': { de: 'Sprache wechseln: Englisch', en: 'Switch language: German' },

  // Hero
  'hero.kicker': { de: 'Kopfrechnen-Abenteuer in sechs Akten', en: 'A mental-math adventure in six acts' },
  'hero.title': { de: 'Kopfrechnen für Jung und Alt', en: 'Mental math for young and old' },
  'hero.sub': {
    de: 'Schnelle Rechenaufgaben, handgemalte Papierbühnen und ein Drache, der wartet: im Browser im Abo, die App für iPhone und Android kommt als Einmalkauf – kein Abo, keine Verlängerung.',
    en: 'Fast arithmetic, hand-painted paper stages and a dragon that is waiting: subscription in the browser, the app for iPhone and Android is coming as a one-time purchase – no subscription, no renewal.',
  },
  'hero.ctaWeb': { de: 'Im Browser spielen', en: 'Play in the browser' },
  'hero.ctaApp': { de: 'Zur App-Version', en: 'About the app version' },
  'hero.print': {
    de: 'Level 1–2 gratis – ohne Konto zum Ausprobieren.',
    en: 'Levels 1–2 free – no account needed to try.',
  },

  // Für jede Generation
  'gen.kicker': { de: 'Für jede Generation', en: 'For every generation' },
  'gen.title': { de: 'Ein Spiel, drei Tempi', en: 'One game, three tempos' },
  'gen.lead': {
    de: 'Vom ersten Formen-Zählen bis zum schnellen Kopfrechnen im Alltag: Jede Generation findet ihr eigenes Tempo – und ihre eigene Schwierigkeit.',
    en: 'From counting shapes for the very first time to quick mental math in everyday life: every generation finds its own tempo – and its own difficulty.',
  },
  'gen.kids.title': { de: 'Kinder', en: 'Kids' },
  'gen.kids.text': {
    de: 'Der Modus Shapes zählt Formen – ohne Punkte, ohne Ende. Ein sanfter Einstieg, der einfach Spaß macht.',
    en: 'Shapes mode counts shapes – no score, no end. A gentle start that is simply fun.',
  },
  'gen.adults.title': { de: 'Erwachsene', en: 'Grown-ups' },
  'gen.adults.text': {
    de: 'Reflexe und Tempo: Auf Hard bleiben dir 5 Sekunden pro Aufgabe. Combo-Fähigkeiten belohnen Antworten in Serie.',
    en: 'Reflexes and speed: on Hard you get 5 seconds per question. Combo abilities reward correct answers in a row.',
  },
  'gen.seniors.title': { de: 'Großeltern', en: 'Grandparents' },
  'gen.seniors.text': {
    de: 'Auf Easy hast du 15 Sekunden und 7 Herzen – und die Anzeigen sind groß und ruhig. Kopfrechnen im eigenen Takt.',
    en: 'On Easy you get 15 seconds and 7 hearts – and the readouts are large and calm. Mental math at your own pace.',
  },

  // Handgemachte Kunst
  'art.kicker': { de: 'Handgemacht', en: 'Handcrafted' },
  'art.title': { de: 'Sechs Akte aus Papier, Licht und Farbe', en: 'Six acts of paper, light and colour' },
  'art.lead': {
    de: 'Jeder Akt ist ein gemaltes Parallax-Diorama: Himmel, Mittelgrund und Vordergrund als eigene Papierschichten, die sich beim Scrollen verschieben. 60 Level auf sechs Bühnen – nichts davon von der Stange.',
    en: 'Every act is a painted parallax diorama: sky, midground and foreground as separate layers of paper that shift as you scroll. 60 levels on six stages – none of it off the shelf.',
  },
  'art.act': { de: 'Akt', en: 'Act' },
  'art.stripLabel': { de: 'Die sechs Akte', en: 'The six acts' },
  'art.stripHint': {
    de: 'Seitlich wischen oder scrollen, um alle sechs Akte zu sehen.',
    en: 'Swipe or scroll sideways to see all six acts.',
  },
  'art.spriteTitle': { de: 'Der Held in Bewegung', en: 'The hero in motion' },
  'art.spriteText': {
    de: 'Der Held ist als Sprite-Sheet animiert: Warten, Laufen, Hieb, Sieg. Probiere die Animationen aus – jede Bewegung ist Frame für Frame gezeichnet.',
    en: 'The hero is animated from a sprite sheet: idle, walk, swing, victory. Try the animations – every movement is drawn frame by frame.',
  },
  'art.poseGroup': { de: 'Animation wählen', en: 'Choose animation' },
  'art.poseIdle': { de: 'Warten', en: 'Idle' },
  'art.poseWalk': { de: 'Gehen', en: 'Walk' },
  'art.poseSwing': { de: 'Hieb', en: 'Swing' },
  'art.poseVictory': { de: 'Sieg', en: 'Victory' },
  'art.fiendsTitle': { de: '36 Feinde und ein Drache', en: '36 fiends and a dragon' },
  'art.fiendsText': {
    de: '36 einzeln gezeichnete Feind-Sprites in zwei Sets, vom Schleim bis zum Skelett-Krieger, dazu ein Drache als Boss. 16-Bit-Nostalgie, gemalt wie ein Papiertheater.',
    en: '36 individually drawn fiend sprites in two sets, from slime to skeleton warrior, plus a dragon as the boss. 16-bit nostalgia, painted like a paper theatre.',
  },
  'art.dragonCaption': { de: 'Der Drache wartet am Ende des Feldzugs.', en: 'The dragon waits at the end of the campaign.' },

  // So spielt es sich
  'play.kicker': { de: 'So spielt es sich', en: 'How it plays' },
  'play.title': { de: 'Drei Schwierigkeiten, ein Formen-Modus', en: 'Three difficulties, a shapes mode' },
  'play.lead': {
    de: 'Du wählst das Tempo, das Spiel liefert die Fragen: Easy, Medium und Hard führen durch dieselben 60 Level in sechs Akten – Shapes ist der freie Formen-Modus daneben.',
    en: 'You pick the tempo, the game brings the questions: Easy, Medium and Hard lead through the same 60 levels in six acts – Shapes is the free-form practice mode alongside.',
  },
  'play.shapes.name': { de: 'Shapes', en: 'Shapes' },
  'play.shapes.meta': { de: '25 Sekunden · 9 Herzen · ohne Punkte', en: '25 seconds · 9 hearts · no score' },
  'play.shapes.text': {
    de: 'Der Einstieg ohne Druck: Formen zählen ohne Punkte und ohne Ende – 25 Sekunden pro Frage, 9 Herzen.',
    en: 'The no-pressure entry: count shapes with no score and no end – 25 seconds per question, 9 hearts.',
  },
  'play.easy.name': { de: 'Easy', en: 'Easy' },
  'play.easy.meta': { de: '15 Sekunden · 7 Herzen', en: '15 seconds · 7 hearts' },
  'play.easy.text': { de: 'Viel Zeit, viele Leben. Ideal zum Ankommen.', en: 'Plenty of time, plenty of lives. Ideal to settle in.' },
  'play.medium.name': { de: 'Medium', en: 'Medium' },
  'play.medium.meta': { de: '10 Sekunden · 5 Herzen', en: '10 seconds · 5 hearts' },
  'play.medium.text': { de: 'Der Takt für jeden Tag: flott, aber fair.', en: 'The everyday tempo: brisk but fair.' },
  'play.hard.name': { de: 'Hard', en: 'Hard' },
  'play.hard.meta': { de: '5 Sekunden · 3 Herzen', en: '5 seconds · 3 hearts' },
  'play.hard.text': { de: 'Volle Konzentration. Ein Fehler tut weh.', en: 'Full focus. One mistake hurts.' },
  'play.featureCombo.title': { de: 'Combo-Fähigkeiten', en: 'Combo abilities' },
  'play.featureCombo.text': {
    de: 'Richtige Antworten in Folge laden Combo-Fähigkeiten auf.',
    en: 'Correct answers in a row charge up combo abilities.',
  },
  'play.featureHeal.title': { de: 'Halten zum Heilen', en: 'Hold to heal' },
  'play.featureHeal.text': {
    de: 'Halte das linke Viertel des Spielfelds 9 Sekunden lang gedrückt und hol dir ein Herz zurück.',
    en: 'Hold the left quarter of the playfield for 9 seconds to win a heart back.',
  },
  'play.featureCampaign.title': { de: '60 Level in 6 Akten', en: '60 levels in 6 acts' },
  'play.featureCampaign.text': {
    de: 'Geschaffte Level bleiben gespeichert – so siehst du immer, wie weit du bist.',
    en: 'Completed levels stay saved – so you always see how far you have come.',
  },
  'play.featureBoard.title': { de: 'Bestenliste', en: 'Leaderboard' },
  'play.featureBoard.text': {
    de: 'Vergleiche deine Highscores im Web – auch in Jahrgangsgruppen.',
    en: 'Compare your high scores on the web – in year groups too.',
  },
  'play.healDemo': {
    de: 'Links unten 9 Sekunden halten: Die Leiste füllt sich, ein Herz kehrt zurück.',
    en: 'Hold the lower-left corner for 9 seconds: the bar fills up and a heart comes back.',
  },

  // Preise
  'prices.kicker': { de: 'Preise', en: 'Pricing' },
  'prices.title': { de: 'Ein Modell für jeden Weg', en: 'A model for every route' },
  'prices.lead': {
    de: 'Im Browser abonnierst du, in der App kaufst du einmal. Beide Wege starten mit Level 1–2 gratis.',
    en: 'On the web you subscribe, in the app you buy once. Both start with levels 1–2 for free.',
  },
  'prices.web.tag': { de: 'Im Browser', en: 'In the browser' },
  'prices.web.name': { de: 'Web-Abo', en: 'Web subscription' },
  'prices.web.price': { de: '3,00 EUR', en: 'EUR 3.00' },
  'prices.web.period': { de: 'alle 3 Monate', en: 'every 3 months' },
  'prices.web.note': {
    de: 'Inklusive Steuern · verlängert sich automatisch · jederzeit kündbar',
    en: 'Taxes included · renews automatically · cancel anytime',
  },
  'prices.web.f1': {
    de: 'Level 1–2 gratis, Premium schaltet Level 3–60 frei',
    en: 'Levels 1–2 free, premium unlocks levels 3–60',
  },
  'prices.web.f2': { de: 'Cloud-Konto mit synchronisiertem Fortschritt', en: 'Cloud account with synced progress' },
  'prices.web.f3': { de: 'Bestenliste inklusive', en: 'Leaderboard included' },
  'prices.web.f4': { de: 'Jederzeit kündbar', en: 'Cancel anytime' },
  'prices.web.cta': { de: 'Im Browser spielen', en: 'Play in the browser' },
  'prices.app.tag': { de: 'Empfohlen', en: 'Recommended' },
  'prices.app.name': { de: 'App-Einmalkauf', en: 'App one-time purchase' },
  'prices.app.price': { de: '3,99 EUR', en: 'EUR 3.99' },
  'prices.app.period': { de: 'einmalig', en: 'one-time' },
  'prices.app.note': {
    de: 'Einmalig freigeschaltet · kein Abo, keine Verlängerung',
    en: 'Unlocked with one payment · no subscription, no renewal',
  },
  'prices.app.f1': {
    de: 'Einmal zahlen und Level 3–60 freischalten',
    en: 'Pay once and unlock levels 3–60',
  },
  'prices.app.f2': { de: 'Kein Konto nötig', en: 'No account required' },
  'prices.app.f3': {
    de: 'Spielbar ohne Internet – nur Kauf und Wiederherstellung brauchen eine Verbindung',
    en: 'Playable without internet – only purchase and restore need a connection',
  },
  'prices.app.f4': { de: 'Kauf gilt geräteweit – für alle Profile auf dem Gerät', en: 'Device-wide – covers every profile on the device' },
  'prices.app.iosBadge': { de: 'Bald im App Store', en: 'Coming soon to the App Store' },
  'prices.app.androidBadge': { de: 'Bald bei Google Play', en: 'Coming soon to Google Play' },
  'prices.app.cta': { de: 'Mehr zur Familien-App', en: 'More about the family app' },
  'prices.compare.title': { de: 'Abo und Einmalkauf im Vergleich', en: 'Subscription and one-time purchase compared' },
  'prices.compare.regionLabel': {
    de: 'Abo und Einmalkauf im Vergleich, scrollbare Tabelle',
    en: 'Subscription and one-time purchase compared, scrollable table',
  },
  'prices.compare.feature': { de: 'Merkmal', en: 'Feature' },
  'prices.compare.colWeb': { de: 'Web-Abo', en: 'Web subscription' },
  'prices.compare.colApp': { de: 'App-Einmalkauf', en: 'App one-time purchase' },
  'prices.compare.row1': { de: 'Preis-Modell', en: 'Price model' },
  'prices.compare.r1web': { de: 'Abo', en: 'Subscription' },
  'prices.compare.r1app': { de: 'Einmalkauf', en: 'One-time purchase' },
  'prices.compare.row2': { de: 'Abrechnung', en: 'Billing' },
  'prices.compare.r2web': { de: '3,00 EUR alle 3 Monate', en: 'EUR 3.00 every 3 months' },
  'prices.compare.r2app': { de: '3,99 EUR einmalig', en: 'EUR 3.99 once' },
  'prices.compare.row3': { de: 'Konto nötig', en: 'Account needed' },
  'prices.compare.r3web': { de: 'Ja, für Premium', en: 'Yes, for premium' },
  'prices.compare.r3app': { de: 'Nein', en: 'No' },
  'prices.compare.row4': { de: 'Offline', en: 'Offline' },
  'prices.compare.r4web': { de: 'Nein, Browser nötig', en: 'No, browser required' },
  'prices.compare.r4app': { de: 'Ja, offline spielbar', en: 'Yes, playable offline' },
  'prices.compare.row5': { de: 'Fortschritt synchronisiert', en: 'Progress synced' },
  'prices.compare.r5web': { de: 'Ja, im Cloud-Konto', en: 'Yes, in the cloud account' },
  'prices.compare.r5app': { de: 'Nein, lokal auf dem Gerät', en: 'No, local to the device' },
  'prices.compare.row6': { de: 'Familien-Profile', en: 'Family profiles' },
  'prices.compare.r6web': { de: 'Nein – ein Konto pro Anmeldung', en: 'No – one account per sign-in' },
  'prices.compare.r6app': { de: 'Ja, lokale Profile', en: 'Yes, local profiles' },
  'prices.compare.row7': { de: 'Alle 60 Level', en: 'All 60 levels' },
  'prices.compare.r7web': { de: 'Ja, mit Premium', en: 'Yes, with premium' },
  'prices.compare.r7app': { de: 'Ja, mit dem Einmalkauf', en: 'Yes, with the one-time purchase' },
  'prices.compare.row9': { de: 'Bestenliste', en: 'Leaderboard' },
  'prices.compare.r9web': { de: 'Ja', en: 'Yes' },
  'prices.compare.r9app': { de: 'Nein, in der App ausgeblendet', en: 'No, hidden in the app' },
  'prices.compare.row8': { de: 'Kündigung', en: 'Cancellation' },
  'prices.compare.r8web': { de: 'Jederzeit im Konto', en: 'Anytime in your account' },
  'prices.compare.r8app': { de: 'Nicht nötig – kein Abo', en: 'Not needed – no subscription' },
  'prices.footnote': {
    de: 'Alle Preise inklusive Steuern. Der App-Preis ist der geplante Preis; im Store gilt der jeweils lokale Preis. Die Apps erscheinen später in den Stores; bis dahin spielst du Arithmo Slayer im Browser.',
    en: 'All prices include taxes. The app price is the planned price; the store shows the local price. The apps will arrive in the stores later; until then you play Arithmo Slayer in the browser.',
  },

  // Familie
  'family.kicker': { de: 'Familie', en: 'Family' },
  'family.title': { de: 'Ein Kauf – die ganze Familie trainiert.', en: 'One purchase – the whole family trains.' },
  'family.lead': {
    de: 'Die App ist um lokale Familien-Profile herum gebaut: Jede Person bekommt einen eigenen Namen, eigene Scores und eigene Level-Checkpoints – ohne Anmeldung, ohne Konto.',
    en: 'The app is built around local family profiles: everyone gets their own name, their own scores and their own level checkpoints – no sign-up, no account.',
  },
  'family.profileMeta': { de: 'Eigenes Profil', en: 'Own profile' },
  'family.deviceName': { de: 'Dieses Gerät', en: 'This device' },
  'family.deviceMeta': { de: '1 Kauf · 3 Profile', en: '1 purchase · 3 profiles' },
  'family.demoNote': { de: 'Beispielhafte Profile', en: 'Example profiles' },
  'family.p1.title': { de: 'Eigene Profile', en: 'Separate profiles' },
  'family.p1.text': { de: 'Name, Scores und Level-Checkpoints pro Person, gespeichert auf dem Gerät.', en: 'Name, scores and level checkpoints per person, stored on the device.' },
  'family.p2.title': { de: 'Wechsel auf dem Titelbildschirm', en: 'Switch on the title screen' },
  'family.p2.text': { de: 'Spieler wechseln mit einem Tipp – ohne An- und Abmelden.', en: 'Switch player with a single tap – no signing in or out.' },
  'family.p3.title': { de: 'Geräteweit', en: 'Device-wide' },
  'family.p3.text': {
    de: 'Ein Kauf auf dem Gerät schaltet Level 3–60 für alle Profile frei.',
    en: 'One purchase on the device unlocks levels 3–60 for every profile.',
  },
  'family.p4.title': { de: 'Kein Konto, kein Login', en: 'No account, no login' },
  'family.p4.text': {
    de: 'Spielbar ohne Internet – nur Kauf und Wiederherstellung brauchen eine Verbindung.',
    en: 'Playable without internet – only purchase and restore need a connection.',
  },
  'family.badge': { de: 'Gilt für iOS und Android', en: 'For iOS and Android' },
  'family.ctaFallback': { de: 'Bis dahin im Browser spielen', en: 'Play in the browser in the meantime' },

  // FAQ
  'faq.kicker': { de: 'FAQ', en: 'FAQ' },
  'faq.title': { de: 'Häufige Fragen', en: 'Frequently asked questions' },
  'faq.q1': { de: 'Warum ist das Web-Abo ein Abo?', en: 'Why is the web version a subscription?' },
  'faq.a1': {
    de: 'Im Browser läuft das Spiel auf unseren Servern: Konto, synchronisierter Fortschritt und Bestenliste brauchen laufende Infrastruktur. Deshalb ist der Web-Zugang ein Abo – 3,00 EUR alle 3 Monate, inklusive Steuern, jederzeit kündbar.',
    en: 'In the browser the game runs on our servers: account, synced progress and leaderboard need infrastructure that keeps running. That is why web access is a subscription – EUR 3.00 every 3 months, taxes included, cancellable anytime.',
  },
  'faq.q2': { de: 'Was bekomme ich mit dem Einmalkauf?', en: 'What does the one-time purchase include?' },
  'faq.a2': {
    de: 'Für 3,99 EUR einmalig schaltest du in der App Level 3–60 frei – ohne Abo. Der Kauf gilt geräteweit für alle Profile auf diesem Gerät; bei einer Erstattung entfällt der Zugang.',
    en: 'For a one-time EUR 3.99 you unlock levels 3–60 in the app – no subscription. The purchase is device-wide and covers every profile on that device; a refund ends the entitlement.',
  },
  'faq.q3': { de: 'Muss ich zahlen, um es auszuprobieren?', en: 'Do I have to pay to try it?' },
  'faq.a3': {
    de: 'Nein. Level 1–2 sind gratis – im Web und in der App.',
    en: 'No. Levels 1–2 are free – both on the web and in the app.',
  },
  'faq.q4': { de: 'Funktioniert die App offline?', en: 'Does the app work offline?' },
  'faq.a4': {
    de: 'Ja, spielbar ohne Internet – nur Kauf und Wiederherstellung brauchen eine Verbindung. Ein Konto braucht die App nicht.',
    en: 'Yes, playable without internet – only purchase and restore need a connection. The app does not need an account.',
  },
  'faq.q5': { de: 'Was passiert, wenn ich das Web-Abo kündige?', en: 'What happens if I cancel the web subscription?' },
  'faq.a5': {
    de: 'Du kündigst jederzeit; das Abo läuft bis zum Ende des bezahlten Zeitraums weiter. Danach bleiben Level 1–2 spielbar.',
    en: 'You can cancel anytime; the subscription runs until the end of the paid period. After that, levels 1–2 remain playable.',
  },
  'faq.q6': { de: 'Welche Sprachen gibt es?', en: 'Which languages are available?' },
  'faq.a6': { de: 'Das Spiel gibt es auf Deutsch und Englisch – diese Website ebenfalls.', en: 'The game is available in German and English – and so is this website.' },
  'faq.q7': { de: 'Brauchen Kinder in der App ein Konto?', en: 'Do kids need an account in the app?' },
  'faq.a7': { de: 'Nein. In der App legst du lokale Profile an – ohne E-Mail-Adresse und ohne Passwort.', en: 'No. In the app you create local profiles – no email address, no password.' },

  // Footer
  'footer.tagline': {
    de: 'Kopfrechnen für Jung und Alt – im Browser, die App für iOS und Android ist in Vorbereitung.',
    en: 'Mental math for young and old – in the browser; the app for iOS and Android is in preparation.',
  },
  'footer.play': { de: 'Zum Spiel', en: 'Go to the game' },
  'footer.legalTitle': { de: 'Rechtliches', en: 'Legal' },
  'footer.legalImpressum': { de: 'Impressum', en: 'Imprint' },
  'footer.legalPrivacy': { de: 'Datenschutz', en: 'Privacy' },
  'footer.legalTerms': { de: 'AGB', en: 'Terms' },
  // cancel.html and widerruf.html only exist in German.
  'footer.legalCancel': { de: 'Kündigung', en: 'Cancellation (DE)' },
  'footer.legalWithdrawal': { de: 'Widerruf', en: 'Right of withdrawal (DE)' },
  'footer.legalImpressumEn': { de: 'Imprint (EN)', en: 'Imprint (EN)' },
  'footer.legalPrivacyEn': { de: 'Privacy (EN)', en: 'Privacy (EN)' },
  'footer.legalTermsEn': { de: 'Terms (EN)', en: 'Terms (EN)' },
  'footer.supportTitle': { de: 'Support', en: 'Support' },
  'footer.supportText': { de: 'Fragen, Wünsche oder ein Fehler gefunden? Schreib uns.', en: 'Questions, requests or found a bug? Write to us.' },
  'footer.copyright': { de: '© 2026 Der Schweigert · Arithmo Slayer', en: '© 2026 Der Schweigert · Arithmo Slayer' },
};

// --- Locale state -----------------------------------------------------

let currentLocale = null;
const listeners = new Set();

function hasDocument() {
  return typeof document !== 'undefined' && document && typeof document.querySelectorAll === 'function';
}

function readStored() {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return null;
    const value = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LOCALES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStored(locale) {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Private mode / storage disabled: the toggle still works for this page view.
  }
}

/** German unless the browser clearly speaks something else. */
export function detectBrowserLocale() {
  if (typeof navigator === 'undefined' || !navigator || !navigator.language) return DEFAULT_LOCALE;
  return String(navigator.language).toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** Stored choice wins, then browser detection, then German. */
export function getLocale() {
  if (!currentLocale) currentLocale = readStored() || detectBrowserLocale();
  return currentLocale;
}

/** Translates `key`; unknown keys return the key itself. */
export function t(key, locale = getLocale()) {
  const entry = DICTIONARY[key];
  if (!entry) return key;
  return entry[locale] ?? entry[DEFAULT_LOCALE] ?? key;
}

export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replaces the text of every [data-i18n] node and the translatable attributes. */
export function translateDom(root) {
  const scope = root || (hasDocument() ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  const locale = getLocale();

  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'), locale);
  });
  scope.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label'), locale));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title'), locale));
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'), locale));
  });
}

/** Updates the toggle button: "EN" while German is active, "DE" while English is. */
function syncToggle() {
  if (!hasDocument()) return;
  const button = document.getElementById('promo-lang-toggle');
  if (!button) return;
  const locale = getLocale();
  const code = button.querySelector('.lang-toggle-code');
  if (code) code.textContent = locale === 'de' ? 'EN' : 'DE';
}

/** Switches locale without a reload: dictionary, <html lang>, storage, listeners. */
export function setLocale(locale, { persist = true } = {}) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new RangeError(`Unsupported locale: ${locale}`);
  }
  currentLocale = locale;
  if (persist) writeStored(locale);
  if (hasDocument()) {
    document.documentElement.lang = locale;
    translateDom();
    syncToggle();
  }
  for (const listener of listeners) {
    try {
      listener(locale);
    } catch {
      // A broken listener must not break the switch for everyone else.
    }
  }
  return locale;
}

export function toggleLocale() {
  return setLocale(getLocale() === 'de' ? 'en' : 'de');
}

// --- Sprite animation -------------------------------------------------
// Frames come from the shared transparent hero sheets at the bucket root.
const SPRITES = {
  idle: { fps: 4, frames: ['idle/idle_frame0.png', 'idle/idle_frame1.png'] },
  walk: { fps: 10, frames: ['walk/walk_frame0.png', 'walk/walk_frame1.png', 'walk/walk_frame2.png', 'walk/walk_frame3.png'] },
  swing: { fps: 12, frames: ['swing/swing_frame0.png', 'swing/swing_frame1.png', 'swing/swing_frame2.png'] },
  victory: { fps: 3, frames: ['victory/victory_frame0.png', 'victory/victory_frame1.png'] },
};

function spriteUrl(frame) {
  return `/game/hero-sprites-transparent/animation-frames/${frame}`;
}

function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function initSprites() {
  const nodes = Array.from(document.querySelectorAll('[data-sprite]'));
  if (!nodes.length) return;

  // Preload every frame once so the first cycle does not flicker.
  Object.values(SPRITES).forEach((set) => {
    set.frames.forEach((frame) => {
      const img = new Image();
      img.src = spriteUrl(frame);
    });
  });

  let pose = 'idle';
  let frameIndex = 0;
  let last = 0;
  let raf = 0;

  const paint = () => {
    const src = spriteUrl(SPRITES[pose].frames[frameIndex]);
    nodes.forEach((el) => {
      if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    });
  };

  const setPose = (next) => {
    if (!SPRITES[next]) return;
    pose = next;
    frameIndex = 0;
    last = 0;
    paint();
    document.querySelectorAll('[data-pose]').forEach((button) => {
      const active = button.getAttribute('data-pose') === pose;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };

  document.querySelectorAll('[data-pose]').forEach((button) => {
    button.addEventListener('click', () => setPose(button.getAttribute('data-pose')));
  });

  paint();
  if (prefersReducedMotion()) return;

  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (document.visibilityState === 'hidden') return;
    const interval = 1000 / SPRITES[pose].fps;
    if (now - last < interval) return;
    last = now;
    frameIndex = (frameIndex + 1) % SPRITES[pose].frames.length;
    paint();
  };
  raf = requestAnimationFrame(tick);
  window.addEventListener('pagehide', () => cancelAnimationFrame(raf), { once: true });
}

// --- Scroll effects ---------------------------------------------------

function initParallax() {
  const layers = Array.from(document.querySelectorAll('[data-parallax]'));
  const filmstrip = document.querySelector('[data-filmstrip]');
  if (!layers.length && !filmstrip) return;
  if (prefersReducedMotion()) return;

  let ticking = false;

  const update = () => {
    ticking = false;
    const scrollY = window.scrollY || window.pageYOffset || 0;
    if (scrollY < window.innerHeight * 1.6) {
      layers.forEach((el) => {
        const speed = parseFloat(el.getAttribute('data-parallax')) || 0;
        el.style.transform = `translate3d(0, ${(scrollY * speed).toFixed(2)}px, 0)`;
      });
    }
    if (filmstrip) {
      const frames = filmstrip.querySelectorAll('[data-frame-img]');
      const offset = filmstrip.scrollLeft;
      const width = filmstrip.clientWidth || 1;
      frames.forEach((img) => {
        const frame = img.parentElement;
        const center = frame.offsetLeft - offset + frame.offsetWidth / 2;
        const delta = (center - width / 2) / width;
        img.style.transform = `translate3d(${(delta * 18).toFixed(2)}px, 0, 0) scale(1.06)`;
      });
    }
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  if (filmstrip) filmstrip.addEventListener('scroll', onScroll, { passive: true });
  update();
}

function initReveal() {
  const items = Array.from(document.querySelectorAll('.reveal'));
  if (!items.length) return;
  if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  );
  items.forEach((el) => observer.observe(el));
}

function boot() {
  // `no-js` hides the language toggle (dead without scripting); `js` enables
  // the reveal animations.
  document.documentElement.classList.remove('no-js');
  document.documentElement.classList.add('js');
  const locale = getLocale();
  document.documentElement.lang = locale;
  translateDom();
  syncToggle();

  const button = document.getElementById('promo-lang-toggle');
  if (button) {
    button.addEventListener('click', () => toggleLocale());
  }

  initSprites();
  initParallax();
  initReveal();
}

if (typeof document !== 'undefined' && document && typeof document.querySelectorAll === 'function') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}
