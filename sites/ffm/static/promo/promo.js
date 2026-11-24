// promo.js — landing page behaviour for /promo/.
//
// Two jobs, both optional enhancements on top of a fully static German page:
//   1. locale switching (German default, English on demand, no reload),
//   2. scroll parallax and reveal animations (IntersectionObserver + rAF).
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
  'nav.beta': { de: 'Beta', en: 'Beta' },
  'nav.play': { de: 'Jetzt spielen', en: 'Play now' },
  'nav.langToggle': { de: 'Sprache wechseln: Englisch', en: 'Switch language: German' },

  // Hero
  'hero.kicker': { de: 'Kopfrechnen-Abenteuer in sechs Akten', en: 'A mental-math adventure in six acts' },
  'hero.title': { de: 'Kopfrechnen für Jung und Alt', en: 'Mental math for young and old' },
  'hero.sub': {
    de: 'Schnelle Rechenaufgaben, handgemalte Papierbühnen und ein Drache, der wartet: im Browser im Abo, die iPhone-App gibt es im App Store als Einmalkauf – kein Abo, keine Verlängerung.',
    en: 'Fast arithmetic, hand-painted paper stages and a dragon that is waiting: subscription in the browser, the iPhone app is on the App Store as a one-time purchase – no subscription, no renewal.',
  },
  'hero.ctaWeb': { de: 'Im Browser spielen', en: 'Play in the browser' },
  'hero.betaLabel': { de: 'Android-Beta', en: 'Android beta' },
  'hero.betaText': { de: 'sucht Tester', en: 'needs testers' },
  'hero.appStoreLink': { de: 'Arithmo Slayer im App Store laden', en: 'Download Arithmo Slayer on the App Store' },
  'hero.ctaPlayStore': { de: 'Bald bei Google Play', en: 'Coming soon to Google Play' },
  'hero.ctaApp': { de: 'Zur App-Version', en: 'About the app version' },
  'hero.print': {
    de: 'Level 1–6 gratis – ohne Konto zum Ausprobieren.',
    en: 'Levels 1–6 free – no account needed to try.',
  },

  // Für jede Generation
  'gen.kicker': { de: 'Für jede Generation', en: 'For every generation' },
  'gen.title': { de: 'Vom Zählen zum Kopfrechnen', en: 'From counting to mental arithmetic' },
  'gen.lead': {
    de: 'Drei Stufen, eine Reise: Im Kindergarten werden Formen gezählt, in der Grundschule beginnt das Rechnen, und Erwachsene trainieren den Reflex – die Bühne wächst mit.',
    en: 'Three steps, one journey: kindergarten counts shapes, primary school starts the arithmetic, and adults train their reflexes – the stage grows with you.',
  },
  'gen.kindergarten.title': { de: 'Kindergarten', en: 'Kindergarten' },
  'gen.kindergarten.text': {
    de: 'Der Formen-Modus ist der sanfte Einstieg: Formen zählen, 25 Sekunden pro Frage, 9 Herzen – ohne Punkte und ohne Ende.',
    en: 'Shapes mode is the gentle start: count shapes, 25 seconds per question, 9 hearts – no score and no end.',
  },
  'gen.primary.title': { de: 'Grundschule', en: 'Primary school' },
  'gen.primary.text': {
    de: 'Hier beginnt das Rechnen: Leicht gibt 15 Sekunden und 7 Herzen, und das Abenteuer über 60 Level öffnet sich Akt für Akt.',
    en: 'Where the arithmetic starts: Easy gives 15 seconds and 7 hearts, and the 60-level campaign opens up act by act.',
  },
  'gen.adults.title': { de: 'Erwachsene', en: 'Adults' },
  'gen.adults.text': {
    de: 'Reflex-Training: Schwer gibt 5 Sekunden und 3 Herzen, Combos belohnen Serien, und die Bestenliste vergleicht Jahrgänge.',
    en: 'Reflex training: Hard gives 5 seconds and 3 hearts, combos reward streaks, and the leaderboard compares year groups.',
  },
  'gen.note': {
    de: 'Einstufung im App Store: 9+ (leichte Fantasy-Gewalt) – die drei Stufen sind Schwierigkeitsgrade, keine Altersempfehlung.',
    en: 'App Store rating: 9+ (mild fantasy violence) – the three stages are difficulty levels, not an age recommendation.',
  },

  // Handgemachte Kunst
  'art.kicker': { de: 'Handgemacht', en: 'Handcrafted' },
  'art.title': { de: 'Sechs Akte aus Papier, Licht und Farbe', en: 'Six acts of paper, light and colour' },
  'art.lead': {
    de: 'Jeder Akt ist ein gemaltes Parallax-Diorama: Himmel, Mittelgrund und Vordergrund als eigene Papierschichten, die sich beim Scrollen verschieben. 60 Level auf sechs Bühnen – nichts davon von der Stange.',
    en: 'Every act is a painted parallax diorama: sky, midground and foreground as separate layers of paper that shift as you scroll. 60 levels on six stages – none of it off the shelf.',
  },
  'art.story': {
    de: 'Am Morgen, an dem die Sonne nicht aufging, läuteten alle Glocken dreizehnmal: Der Berater des Königs hat die Krone des Gleichgewichts gestohlen und ihren Zauber verdreht. Als Lehrling des Dorfes ziehst du mit einem Zauberbuch und einem Talent für Zahlen los, um die Welt wieder in Ordnung zu bringen. Jede richtige Antwort nährt deine Magie. Erzählt wird auf stillen Pergamentkarten, und nach Level 60 wartet ein Ende.',
    en: 'On the morning the sun did not rise, every bell in the village rang thirteen times: the king\'s adviser had stolen the Crown of Balance and twisted its magic. As the village apprentice you set out with a spellbook and a talent for numbers to put the world right. Every right answer feeds your magic. The story is told on silent parchment cards, and after level 60 an ending waits.',
  },
  'art.stripLabel': { de: 'Die sechs Akte', en: 'The six acts' },
  'art.act1': { de: 'Akt 1 · Hinter dem Dorf', en: 'Act 1 · Beyond the Village' },
  'art.act1Teaser': {
    de: 'Die Laternen des Dorfes verblassen, und kleine Feinde verdrehen die Meilensteine.',
    en: 'The village lanterns fade behind you, and small fiends twist the milestones.',
  },
  'art.act2': { de: 'Akt 2 · Das weite Land', en: 'Act 2 · The Long Country' },
  'art.act2Teaser': {
    de: 'Der Pfad steigt in die Berge, und dein Zauberbuch öffnet eine Seite, die du noch nie gesehen hast.',
    en: 'The path climbs into the mountains, and your spellbook opens to a page you have never seen.',
  },
  'art.act3': { de: 'Akt 3 · Der Flüsterwald', en: 'Act 3 · The Whispering Woods' },
  'art.act3Teaser': {
    de: 'Im Wald flüstern die Blätter falsche Antworten, und vertraute Aufgaben verbergen neue Gefahren.',
    en: 'In the woods the leaves whisper wrong answers, and familiar sums hide new dangers.',
  },
  'art.act4': { de: 'Akt 4 · Die verschüttete Stadt', en: 'Act 4 · The Buried City' },
  'art.act4Teaser': {
    de: 'Unter den Bergen liegt eine Stadt, die der Stein verschluckt hat, voller unfertiger Rechnungen.',
    en: 'Under the mountains lies a city the stone swallowed, full of unfinished sums.',
  },
  'art.act5': { de: 'Akt 5 · Die stille Hauptstadt', en: 'Act 5 · The Silent Capital' },
  'art.act5Teaser': {
    de: 'Die Tore stehen offen, aber niemand grüßt dich, und die Uhren laufen rückwärts.',
    en: 'The gates stand open, but no one greets you, and the clocks run backward.',
  },
  'art.act6': { de: 'Akt 6 · Der Thron', en: 'Act 6 · The Throne' },
  'art.act6Teaser': {
    de: 'Hinter der letzten Tür wartet der Berater unter der gestohlenen Krone des Gleichgewichts.',
    en: 'Behind the last door the adviser waits beneath the stolen Crown of Balance.',
  },
  'art.actionTitle': { de: 'Der Held im Kampf', en: 'The hero in combat' },
  'art.actionText': {
    de: 'Drei Momente aus dem Kampf, gemalt im Stil der Bühnen: Nahkampf, Feuerball und die Blitzkugel als Combo-Angriff.',
    en: 'Three moments from combat, painted in the style of the stages: melee, fireball and a lightning combo strike.',
  },
  'art.actionFight': { de: 'Nahkampf – der Hieb sitzt.', en: 'Melee — the swing lands.' },
  'art.actionFireball': { de: 'Feuerball auf Distanz.', en: 'Fireball at range.' },
  'art.actionLightning': {
    de: 'Blitzkugel ab Serie 11.',
    en: 'Lightning ball from combo 11.',
  },
  'art.fiendsTitle': { de: '54 Feinde und ein Drache', en: '54 fiends and a dragon' },
  'art.fiendsText': {
    de: '54 einzeln gezeichnete Feinde in drei Sets, vom Kobold bis zum Kraken, jeder mit eigenem Laufzyklus aus acht Bildern, dazu der Drache als höchste Combo-Stufe. 16-Bit-Nostalgie, gemalt wie ein Papiertheater.',
    en: '54 individually drawn fiends in three sets, from imp to kraken, each with its own eight-frame walk cycle, plus the dragon as the highest combo tier. 16-bit nostalgia, painted like a paper theatre.',
  },
  'art.dragonCaption': {
    de: 'Ab Serie 21 greift der Drache ein.',
    en: 'From combo 21 the dragon joins the fight.',
  },

  // Gameplay filmstrip: real portrait captures from the app build
  'shots.kicker': { de: 'Aus dem Spiel', en: 'From the game' },
  'shots.title': { de: 'Fünf Momente, fünf Level', en: 'Five moments, five levels' },
  'shots.lead': {
    de: 'Echte Screenshots aus der App – vom ersten Hieb bis zur Heilung. Kein Mock-up, keine Montage: Dieselben Bildschirme, die du beim Spielen siehst.',
    en: 'Real screenshots from the app – from the first strike to the heal. No mock-up, no montage: the same screens you see while playing.',
  },
  'shots.stripLabel': { de: 'Screenshots aus dem Spiel', en: 'Screenshots from the game' },
  'shots.strike': { de: 'Level 1 · Hieb', en: 'Level 1 · Strike' },
  'shots.fireball': { de: 'Level 10 · Feuerball', en: 'Level 10 · Fireball' },
  'shots.blitz': { de: 'Level 20 · Blitz', en: 'Level 20 · Lightning' },
  'shots.dragon': { de: 'Level 30 · Drache', en: 'Level 30 · Dragon' },
  'shots.heal': { de: 'Level 40 · Heilen', en: 'Level 40 · Healing' },

  // So spielt es sich
  'play.kicker': { de: 'So spielt es sich', en: 'How it plays' },
  'play.title': { de: 'Drei Schwierigkeiten, ein Formen-Modus', en: 'Three difficulties, a shapes mode' },
  'play.lead': {
    de: 'Du wählst das Tempo, das Spiel liefert die Fragen: Leicht, Mittel und Schwer führen durch dieselben 60 Level in sechs Akten von Abenteuer I – Formen ist der freie Zähl-Modus daneben, und Abenteuer II: Genie wartet weiter unten.',
    en: 'You pick the tempo, the game brings the questions: Easy, Medium and Hard lead through the same 60 levels in six acts of Campaign I – Shapes is the free-form practice mode alongside, and Campaign II: Genius follows below.',
  },
  'play.shapes.name': {
    de: 'Formen',
    en: 'Shapes',
  },
  'play.shapes.icons': {
    de: 'Formen-Modus: Quadrat, Dreieck und Kreis zählen',
    en: 'Shapes mode: counting squares, triangles and circles',
  },
  'play.shapes.meta': { de: '25 Sekunden · 9 Herzen · ohne Punkte', en: '25 seconds · 9 hearts · no score' },
  'play.shapes.text': {
    de: 'Der Einstieg ohne Druck: Formen zählen ohne Punkte und ohne Ende – 25 Sekunden pro Frage, 9 Herzen.',
    en: 'The no-pressure entry: count shapes with no score and no end – 25 seconds per question, 9 hearts.',
  },
  'play.easy.name': {
    de: 'Leicht',
    en: 'Easy',
  },
  'play.easy.icons': { de: 'Schwierigkeit 1 von 3', en: 'Difficulty 1 of 3' },
  'play.easy.meta': { de: '15 Sekunden · 7 Herzen', en: '15 seconds · 7 hearts' },
  'play.easy.text': { de: 'Viel Zeit, viele Leben. Ideal zum Ankommen.', en: 'Plenty of time, plenty of lives. Ideal to settle in.' },
  'play.medium.name': {
    de: 'Mittel',
    en: 'Medium',
  },
  'play.medium.icons': { de: 'Schwierigkeit 2 von 3', en: 'Difficulty 2 of 3' },
  'play.medium.meta': { de: '10 Sekunden · 5 Herzen', en: '10 seconds · 5 hearts' },
  'play.medium.text': { de: 'Der Takt für jeden Tag: flott, aber fair.', en: 'The everyday tempo: brisk but fair.' },
  'play.hard.name': {
    de: 'Schwer',
    en: 'Hard',
  },
  'play.hard.icons': { de: 'Schwierigkeit 3 von 3', en: 'Difficulty 3 of 3' },
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
  // Campaign I: facts from app/level_data.json and game/levels.js (unlocks, boss rounds, missing operand)
  'camp1.kicker': { de: 'Abenteuer I', en: 'Campaign I' },
  'camp1.title': { de: 'Rechnen: die vier Grundrechenarten', en: 'Arithmetic: the four basic operations' },
  'camp1.lead': {
    de: 'Das erste Abenteuer führt durch 60 Level in sechs Akten. Es beginnt mit einem Plus und öffnet alle zehn Level eine neue Rechenart, bis alle vier im Spiel sind.',
    en: 'The first campaign leads through 60 levels in six acts. It starts with a plus and opens a new operation every ten levels, until all four are in play.',
  },
  'camp1.emblemEyebrow': { de: 'Abenteuer I', en: 'Campaign I' },
  'camp1.emblemTitle': { de: 'Rechnen', en: 'Arithmetic' },
  'camp1.topicsLabel': { de: 'Die sechs Stufen von Abenteuer I', en: 'The six stages of Campaign I' },
  'camp1.t1.lv': { de: 'Level 1–9', en: 'Levels 1–9' },
  'camp1.t1.name': { de: 'Addieren', en: 'Adding' },
  'camp1.t1.text': {
    de: 'Es beginnt mit Zahlen bis 3, die Zahlenräume wachsen schnell.',
    en: 'It starts with numbers up to 3, and the number ranges grow fast.',
  },
  'camp1.t1.ex': { de: '3 + 2 = 5', en: '3 + 2 = 5' },
  'camp1.t2.lv': { de: 'Level 10–19', en: 'Levels 10–19' },
  'camp1.t2.name': { de: 'Subtrahieren', en: 'Subtracting' },
  'camp1.t2.text': {
    de: 'Das Minus kommt dazu, und jede vierte Aufgabe versteckt eine Zahl.',
    en: 'Minus joins in, and every fourth question hides a number.',
  },
  'camp1.t2.ex': { de: '6 + ? = 10', en: '6 + ? = 10' },
  'camp1.t3.lv': { de: 'Level 20–29', en: 'Levels 20–29' },
  'camp1.t3.name': { de: 'Multiplizieren', en: 'Multiplying' },
  'camp1.t3.text': { de: 'Das Einmaleins öffnet sich, zuerst mit Zahlen bis 10.', en: 'The times tables open up, first with numbers up to 10.' },
  'camp1.t3.ex': { de: '6 × 4 = 24', en: '6 × 4 = 24' },
  'camp1.t4.lv': { de: 'Level 30–39', en: 'Levels 30–39' },
  'camp1.t4.name': { de: 'Dividieren', en: 'Dividing' },
  'camp1.t4.text': { de: 'Geteilt wird ohne Rest, zuerst mit Zahlen bis 10.', en: 'Division comes out even, first with numbers up to 10.' },
  'camp1.t4.ex': { de: '42 ÷ 7 = 6', en: '42 ÷ 7 = 6' },
  'camp1.t5.lv': { de: 'Level 40–49', en: 'Levels 40–49' },
  'camp1.t5.name': { de: 'Alle vier Rechenarten', en: 'All four operations' },
  'camp1.t5.text': { de: 'Plus, minus, mal und geteilt wechseln sich ab.', en: 'Plus, minus, times and divide take turns.' },
  'camp1.t5.ex': { de: '8 × ? = 56', en: '8 × ? = 56' },
  'camp1.t6.lv': { de: 'Level 50–60', en: 'Levels 50–60' },
  'camp1.t6.name': { de: 'Das große Finale', en: 'The grand finale' },
  'camp1.t6.text': {
    de: 'Zahlen bis 30 und fast jede zweite Aufgabe mit versteckter Zahl.',
    en: 'Numbers up to 30 and nearly every second question hides a number.',
  },
  'camp1.t6.ex': { de: '27 + 18 = 45', en: '27 + 18 = 45' },
  'camp1.f1.title': { de: 'Boss-Runden', en: 'Boss rounds' },
  'camp1.f1.text': {
    de: 'Auf Level 20, 30, 40, 50 und 60 ist der letzte Feind eine Boss-Runde: drei Treffer, drei Aufgabentypen.',
    en: 'On levels 20, 30, 40, 50 and 60 the last fiend is a boss round: three hits, three question types.',
  },
  'camp1.f2.title': { de: 'Die fehlende Zahl', en: 'The missing number' },
  'camp1.f2.text': {
    de: 'Ab Level 10 verstecken Aufgaben eine Zahl wie bei 6 + ? = 10. Das ist schwerer und gibt 25 Extrapunkte.',
    en: 'From level 10, questions hide a number as in 6 + ? = 10. It is harder and earns 25 bonus points.',
  },
  'camp1.f3.title': { de: 'Dein Tempo', en: 'Your pace' },
  'camp1.f3.text': {
    de: 'Leicht, Mittel und Schwer bestimmen Zeit und Herzen. Die Level 1–6 sind gratis.',
    en: 'Easy, Medium and Hard set the time and the hearts. Levels 1–6 are free.',
  },

  // Campaign II: facts from static/game/campaign2 (40 levels, eight acts, boss rounds, four answers, timer 1.2x-2x)
  'genie.kicker': { de: 'Abenteuer II', en: 'Campaign II' },
  'genie.title': { de: 'Genie: von Brüchen bis Logarithmen', en: 'Genius: from fractions to logarithms' },
  'genie.lead': {
    de: 'Das zweite Abenteuer hat 40 Level in acht Akten zu je fünf Leveln. Es spielt auf den Bühnen des ersten, wartet mit einem uralten Drachen auf – und fragt, was in der Schule erst später kommt.',
    en: 'The second campaign has 40 levels in eight acts of five. It plays on the first campaign\'s stages, brings an ancient dragon along, and asks what school only teaches later.',
  },
  'genie.emblemEyebrow': { de: 'Abenteuer II', en: 'Campaign II' },
  'genie.emblemTitle': { de: 'Genie', en: 'Genius' },
  'genie.topicsLabel': { de: 'Die acht Akte von Abenteuer II', en: 'The eight acts of Campaign II' },
  'genie.t1.lv': { de: 'Level 1–5', en: 'Levels 1–5' },
  'genie.t2.lv': { de: 'Level 6–10', en: 'Levels 6–10' },
  'genie.t3.lv': { de: 'Level 11–15', en: 'Levels 11–15' },
  'genie.t4.lv': { de: 'Level 16–20', en: 'Levels 16–20' },
  'genie.t5.lv': { de: 'Level 21–25', en: 'Levels 21–25' },
  'genie.t6.lv': { de: 'Level 26–30', en: 'Levels 26–30' },
  'genie.t7.lv': { de: 'Level 31–35', en: 'Levels 31–35' },
  'genie.t8.lv': { de: 'Level 36–40', en: 'Levels 36–40' },
  'genie.t1.name': { de: 'Brüche', en: 'Fractions' },
  'genie.t1.ex': { de: '3/12 = 1/4', en: '3/12 = 1/4' },
  'genie.t2.name': { de: 'Brüche mit ungleichen Nennern', en: 'Fractions with unlike denominators' },
  'genie.t2.ex': { de: '1/3 + 1/4 = 7/12', en: '1/3 + 1/4 = 7/12' },
  'genie.t3.name': { de: 'Potenzen', en: 'Powers' },
  'genie.t3.ex': { de: '(−3)³ = −27', en: '(−3)³ = −27' },
  'genie.t4.name': { de: 'Wurzeln', en: 'Roots' },
  'genie.t4.ex': { de: '∛343 = 7', en: '∛343 = 7' },
  'genie.t5.name': { de: 'Potenzgesetze', en: 'Exponent laws' },
  'genie.t5.ex': { de: '8^(2/3) = 4', en: '8^(2/3) = 4' },
  'genie.t6.name': { de: 'Wurzeln umformen', en: 'Simplifying radicals' },
  'genie.t6.ex': { de: '√72 = 6√2', en: '√72 = 6√2' },
  'genie.t7.name': { de: 'Logarithmen', en: 'Logarithms' },
  'genie.t7.ex': { de: 'log₃(1/9) = −2', en: 'log₃(1/9) = −2' },
  'genie.t8.name': { de: 'Alles zusammen', en: 'Everything together' },
  'genie.t8.ex': { de: '(2/3)⁻² − √(81/16) = 0', en: '(2/3)⁻² − √(81/16) = 0' },
  'genie.f1.title': { de: 'Vier Antworten, mehr Zeit', en: 'Four answers, more time' },
  'genie.f1.text': {
    de: 'Jede Aufgabe hat vier Antworten zur Wahl, und der Timer deiner Schwierigkeit wird gedehnt: anfangs um ein Fünftel, am Ende auf das Doppelte.',
    en: 'Every question offers four answers, and your difficulty\'s timer is stretched: by a fifth at first, up to double at the end.',
  },
  'genie.f2.title': { de: 'Boss-Runden', en: 'Boss rounds' },
  'genie.f2.text': {
    de: 'Auf Level 10, 20, 30 und 40 wartet eine Boss-Runde, die den Stoff der letzten fünf Level zusammenfasst.',
    en: 'Levels 10, 20, 30 and 40 end in a boss round that pulls the last five levels together.',
  },
  'genie.f3.title': { de: 'Unabhängig vom ersten Abenteuer', en: 'Independent of the first campaign' },
  'genie.f3.text': {
    de: 'Du musst Abenteuer I weder besitzen noch gespielt haben: Abenteuer II ist sofort spielbar und wechselt auf der Spieler-Seite der App, im Web im Profil.',
    en: 'You need neither own nor have played Campaign I: Campaign II is playable straight away, and you switch on the app\'s Players page, or in your profile on the web.',
  },

  'prices.kicker': { de: 'Preise', en: 'Pricing' },
  'prices.title': { de: 'Ein Modell für jeden Weg', en: 'A model for every route' },
  'prices.lead': {
    de: 'Im Browser abonnierst du, in der App kaufst du jedes Abenteuer einzeln und einmalig. Abenteuer I startet mit Level 1–6 gratis.',
    en: 'On the web you subscribe, in the app you buy each campaign separately, once. Campaign I starts with levels 1–6 for free.',
  },
  'prices.web.tag': { de: 'Im Browser', en: 'In the browser' },
  'prices.web.name': { de: 'Web-Abo', en: 'Web subscription' },
  'prices.web.price': { de: '1,99 EUR', en: 'EUR 1.99' },
  'prices.web.period': { de: 'alle 3 Monate', en: 'every 3 months' },
  'prices.web.note': {
    de: 'Inklusive Steuern · verlängert sich automatisch · jederzeit kündbar',
    en: 'Taxes included · renews automatically · cancel anytime',
  },
  'prices.web.f1': {
    de: 'Level 1–6 gratis, Premium schaltet Level 7–60 und Abenteuer II: Genie frei',
    en: 'Levels 1–6 free, premium unlocks levels 7–60 and Campaign II: Genius',
  },
  'prices.web.f2': { de: 'Cloud-Konto mit synchronisiertem Fortschritt', en: 'Cloud account with synced progress' },
  'prices.web.f3': { de: 'Bestenliste inklusive', en: 'Leaderboard included' },
  'prices.web.f4': { de: 'Jederzeit kündbar', en: 'Cancel anytime' },
  'prices.web.cta': { de: 'Im Browser spielen', en: 'Play in the browser' },
  'prices.app.tag': { de: 'Empfohlen', en: 'Recommended' },
  'prices.app.name': {
    de: 'Abenteuer I: Rechnen',
    en: 'Campaign I: Arithmetic',
  },
  'prices.app.price': { de: '2,99 EUR', en: 'EUR 2.99' },
  'prices.app.period': { de: 'einmalig', en: 'one-time' },
  'prices.app.note': {
    de: 'Einmalig freigeschaltet · kein Abo, keine Verlängerung',
    en: 'Unlocked with one payment · no subscription, no renewal',
  },
  'prices.app.f1': {
    de: 'Level 1–6 gratis zum Ausprobieren, dann einmal zahlen und Level 7–60, alle Heldenfarben und weitere Spieler freischalten',
    en: 'Levels 1–6 free to try, then pay once to unlock levels 7–60, all hero themes and more players',
  },
  'prices.app.f2': { de: 'Kein Konto nötig', en: 'No account required' },
  'prices.app.f3': {
    de: 'Spielbar ohne Internet – nur Kauf und Wiederherstellung brauchen eine Verbindung',
    en: 'Playable without internet – only purchase and restore need a connection',
  },
  'prices.app.f4': { de: 'Kauf gilt geräteweit – für alle Profile auf dem Gerät', en: 'Device-wide – covers every profile on the device' },
  'prices.app.iosBadge': { de: 'Jetzt im App Store', en: 'Now on the App Store' },
  'prices.app.androidBadge': { de: 'Bald bei Google Play', en: 'Coming soon to Google Play' },
  'prices.c2.tag': {
    de: 'Auch in der App',
    en: 'Also in the app',
  },
  'prices.c2.name': { de: 'Abenteuer II: Genie', en: 'Campaign II: Genius' },
  'prices.c2.price': {
    de: '1,99 EUR',
    en: 'EUR 1.99',
  },
  'prices.c2.period': {
    de: 'einmalig',
    en: 'one-time',
  },
  'prices.c2.note': {
    de: 'Einmalig freigeschaltet · kein Abo · Abenteuer I ist nicht nötig',
    en: 'Unlocked once · no subscription · Campaign I is not needed',
  },
  'prices.c2.f1': { de: '40 Level mit Brüchen, Potenzen, Wurzeln und Logarithmen – die ersten 3 gratis', en: '40 levels of fractions, powers, roots and logarithms – the first 3 free' },
  'prices.c2.f2': {
    de: 'Sofort spielbar: Abenteuer I musst du weder besitzen noch gespielt haben',
    en: 'Playable straight away: you need neither own nor have played Campaign I',
  },
  'prices.c2.f3': { de: 'Im Web-Abo ist Abenteuer II schon enthalten', en: 'In the web subscription Campaign II is already included' },
  'prices.c2.cta': { de: 'Mehr zu Abenteuer II', en: 'More about Campaign II' },
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
  'prices.compare.r2web': { de: '1,99 EUR alle 3 Monate', en: 'EUR 1.99 every 3 months' },
  'prices.compare.r2app': {
    de: 'Abenteuer I: 2,99 EUR · Abenteuer II: 1,99 EUR, je einmalig',
    en: 'Campaign I: EUR 2.99 · Campaign II: EUR 1.99, each once',
  },
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
  'prices.compare.r7app': {
    de: 'Ja, mit Abenteuer I',
    en: 'Yes, with Campaign I',
  },
  'prices.compare.row9': { de: 'Bestenliste', en: 'Leaderboard' },
  'prices.compare.r9web': { de: 'Ja', en: 'Yes' },
  'prices.compare.r9app': { de: 'Nein, in der App ausgeblendet', en: 'No, hidden in the app' },
  'prices.compare.row10': { de: 'Abenteuer II: Genie', en: 'Campaign II: Genius' },
  'prices.compare.r10web': { de: 'Ja, im Abo enthalten', en: 'Yes, included in the subscription' },
  'prices.compare.r10app': {
    de: 'Eigener Einmalkauf, Abenteuer I nicht nötig',
    en: 'Separate one-time purchase, Campaign I not needed',
  },
  'prices.compare.row8': { de: 'Kündigung', en: 'Cancellation' },
  'prices.compare.r8web': { de: 'Jederzeit im Konto', en: 'Anytime in your account' },
  'prices.compare.r8app': { de: 'Nicht nötig – kein Abo', en: 'Not needed – no subscription' },
  'prices.footnote': {
    de: 'Alle Preise inklusive Steuern, hier die Preise in Deutschland; im Store gilt der jeweils lokale Preis. Abenteuer I und Abenteuer II: Genie sind in der App zwei getrennte Einmalkäufe, und Genie braucht Abenteuer I nicht. Die iPhone-App gibt es im App Store, die Android-App folgt bei Google Play.',
    en: 'All prices include taxes and are the prices in Germany; the store shows the local price. In the app, Campaign I and Campaign II: Genius are two separate one-time purchases, and Genius does not need Campaign I. The iPhone app is on the App Store; the Android app follows on Google Play.',
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
    de: 'Ein Kauf auf dem Gerät schaltet Level 7–60 für alle Profile frei.',
    en: 'One purchase on the device unlocks levels 7–60 for every profile.',
  },
  'family.p4.title': { de: 'Kein Konto, kein Login', en: 'No account, no login' },
  'family.p4.text': {
    de: 'Spielbar ohne Internet – nur Kauf und Wiederherstellung brauchen eine Verbindung.',
    en: 'Playable without internet – only purchase and restore need a connection.',
  },
  'family.badge': { de: 'Gilt für iOS und Android', en: 'For iOS and Android' },
  'family.phoneCaption': { de: 'Titelbildschirm der App', en: 'App title screen' },
  'family.ctaFallback': { de: 'Bis dahin im Browser spielen', en: 'Play in the browser in the meantime' },

  // FAQ
  'faq.kicker': { de: 'FAQ', en: 'FAQ' },
  'faq.title': { de: 'Häufige Fragen', en: 'Frequently asked questions' },
  'faq.q1': { de: 'Warum ist das Web-Abo ein Abo?', en: 'Why is the web version a subscription?' },
  'faq.a1': {
    de: 'Im Browser läuft das Spiel auf unseren Servern: Konto, synchronisierter Fortschritt und Bestenliste brauchen laufende Infrastruktur. Deshalb ist der Web-Zugang ein Abo – 1,99 EUR alle 3 Monate, inklusive Steuern, jederzeit kündbar.',
    en: 'In the browser the game runs on our servers: account, synced progress and leaderboard need infrastructure that keeps running. That is why web access is a subscription – EUR 1.99 every 3 months, taxes included, cancellable anytime.',
  },
  'faq.q2': { de: 'Was bekomme ich mit dem Einmalkauf?', en: 'What does the one-time purchase include?' },
  'faq.a2': {
    de: 'Für 2,99 EUR einmalig schaltest du in der App Abenteuer I frei: Level 7–60, alle Heldenfarben und weitere Spieler – ohne Abo. Der Kauf gilt geräteweit für alle Profile auf diesem Gerät; bei einer Erstattung entfällt der Zugang. Abenteuer II: Genie ist ein eigener Einmalkauf für 1,99 EUR.',
    en: 'For a one-time EUR 2.99 you unlock Campaign I in the app: levels 7–60, all hero themes and more players – no subscription. The purchase is device-wide and covers every profile on that device; a refund ends the entitlement. Campaign II: Genius is its own one-time purchase for EUR 1.99.',
  },
  'faq.q3': { de: 'Muss ich zahlen, um es auszuprobieren?', en: 'Do I have to pay to try it?' },
  'faq.a3': {
    de: 'Nein. Level 1–6 sind gratis – im Web und in der App.',
    en: 'No. Levels 1–6 are free – both on the web and in the app.',
  },
  'faq.q4': { de: 'Funktioniert die App offline?', en: 'Does the app work offline?' },
  'faq.a4': {
    de: 'Ja, spielbar ohne Internet – nur Kauf und Wiederherstellung brauchen eine Verbindung. Ein Konto braucht die App nicht.',
    en: 'Yes, playable without internet – only purchase and restore need a connection. The app does not need an account.',
  },
  'faq.q5': { de: 'Was passiert, wenn ich das Web-Abo kündige?', en: 'What happens if I cancel the web subscription?' },
  'faq.a5': {
    de: 'Du kündigst jederzeit; das Abo läuft bis zum Ende des bezahlten Zeitraums weiter. Danach bleiben Level 1–6 spielbar.',
    en: 'You can cancel anytime; the subscription runs until the end of the paid period. After that, levels 1–6 remain playable.',
  },
  'faq.q6': { de: 'Welche Sprachen gibt es?', en: 'Which languages are available?' },
  'faq.a6': { de: 'Das Spiel gibt es auf Deutsch und Englisch – diese Website ebenfalls.', en: 'The game is available in German and English – and so is this website.' },
  'faq.q7': { de: 'Brauchen Kinder in der App ein Konto?', en: 'Do kids need an account in the app?' },
  'faq.q8': { de: 'Was ist Abenteuer II: Genie?', en: 'What is Campaign II: Genius?' },
  'faq.a8': {
    de: 'Das zweite Abenteuer: 40 Level mit Brüchen, Potenzen, Wurzeln und Logarithmen, mit vier Antworten pro Aufgabe und mehr Zeit. Es hängt nicht vom ersten ab: Du musst Abenteuer I weder besitzen noch gespielt haben. Im Web-Abo ist es enthalten; in der App ist es ein eigener Einmalkauf für 1,99 EUR in Deutschland. Gewechselt wird auf der Spieler-Seite der App, im Web im Profil.',
    en: 'The second campaign: 40 levels of fractions, powers, roots and logarithms, with four answers per question and more time. It does not depend on the first one: you need neither own nor have played Campaign I. It is included in the web subscription; in the app it is a separate one-time purchase for EUR 1.99 in Germany. You switch campaigns on the app\'s Players page, or in your profile on the web.',
  },
  'faq.a7': { de: 'Nein. In der App legst du lokale Profile an – ohne E-Mail-Adresse und ohne Passwort.', en: 'No. In the app you create local profiles – no email address, no password.' },

  // Footer
  'footer.tagline': {
    de: 'Kopfrechnen für Jung und Alt – im Browser, die iPhone-App im App Store, die Android-App folgt in Kürze.',
    en: 'Mental math for young and old – in the browser, the iPhone app on the App Store, the Android app to follow.',
  },
  'footer.play': { de: 'Zum Spiel', en: 'Go to the game' },
  'footer.legalTitle': { de: 'Rechtliches', en: 'Legal' },
  'footer.legalImpressum': { de: 'Impressum', en: 'Imprint' },
  'footer.legalPrivacy': { de: 'Datenschutz', en: 'Privacy' },
  'footer.legalPrivacyApp': { de: 'App-Datenschutz', en: 'App privacy' },
  'footer.legalTermsApp': { de: 'AGB der App', en: 'App terms' },
  'footer.legalTerms': { de: 'AGB', en: 'Terms' },
  // cancel.html and widerruf.html only exist in German.
  'footer.legalCancel': { de: 'Kündigung', en: 'Cancellation (DE)' },
  'footer.legalWithdrawal': { de: 'Widerruf', en: 'Right of withdrawal (DE)' },
  'footer.legalImpressumEn': { de: 'Imprint (EN)', en: 'Imprint (EN)' },
  'footer.legalPrivacyEn': { de: 'Privacy (EN)', en: 'Privacy (EN)' },
  'footer.legalTermsEn': { de: 'Terms (EN)', en: 'Terms (EN)' },
  'footer.supportTitle': { de: 'Support', en: 'Support' },
  'footer.supportText': { de: 'Fragen, Wünsche oder ein Fehler gefunden? Schreib uns.', en: 'Questions, requests or found a bug? Write to us.' },
  // Follow call to action (links to the public Facebook Page; plain link, no plugin, no external request)
  'follow.title': { de: 'Folge uns auf Facebook', en: 'Follow us on Facebook' },
  'follow.text': {
    de: 'Neuigkeiten zu Arithmo Slayer, Einblicke hinter die Kulissen und Rechenrätsel für die ganze Familie – direkt in deinem Feed.',
    en: 'News about Arithmo Slayer, a look behind the scenes and maths puzzles for the whole family – right in your feed.',
  },
  'follow.cta': { de: 'Auf Facebook folgen', en: 'Follow on Facebook' },
  'follow.aria': { de: 'Auf Facebook folgen (öffnet in einem neuen Tab)', en: 'Follow on Facebook (opens in a new tab)' },
  'footer.facebook': { de: 'Facebook', en: 'Facebook' },
  'footer.copyright': { de: '© 2026 Der Schweigert · Arithmo Slayer', en: '© 2026 Der Schweigert · Arithmo Slayer' },
};

/**
 * Merges another page's translations into the shared dictionary, so a second
 * page can reuse this locale layer (storage key, detection, translateDom)
 * without copying it. Duplicate keys throw: a silent overwrite would make one
 * page show the other page's copy.
 */
export function registerDictionary(entries) {
  for (const [key, value] of Object.entries(entries)) {
    if (key in DICTIONARY) throw new Error(`duplicate i18n key: ${key}`);
    if (!value || typeof value.de !== 'string' || typeof value.en !== 'string') {
      throw new TypeError(`i18n entry ${key} needs de and en strings`);
    }
    DICTIONARY[key] = value;
  }
  return DICTIONARY;
}

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

/**
 * Splits a translation into runs so numeric ranges can be kept on one line.
 * An en dash is a line-break opportunity, which is how "Level 1–/2" appears at
 * 320 px; the static markup uses <span class="nb"> for that, and a runtime
 * translation has to rebuild the same guard instead of flattening it.
 */
export function splitRanges(value) {
  return String(value)
    .split(/(\d+–\d+)/)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, nb: /^\d+–\d+$/.test(part) }));
}

/** Writes `value` into `el`, wrapping numeric ranges in .nb spans. */
function setTranslatableText(el, value) {
  const runs = splitRanges(value);
  if (runs.length === 1 && !runs[0].nb) {
    el.textContent = value;
    return;
  }
  el.textContent = '';
  for (const run of runs) {
    if (!run.nb) {
      el.append(run.text);
      continue;
    }
    const span = document.createElement('span');
    span.className = 'nb';
    span.textContent = run.text;
    el.append(span);
  }
}

/** Replaces the text of every [data-i18n] node and the translatable attributes. */
export function translateDom(root) {
  const scope = root || (hasDocument() ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  const locale = getLocale();

  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    setTranslatableText(el, t(el.getAttribute('data-i18n'), locale));
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

function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// --- Scroll effects ---------------------------------------------------

function initParallax() {
  const layers = Array.from(document.querySelectorAll('[data-parallax]'));
  if (!layers.length) return;
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
  };

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

// --- Pannable looping bands -------------------------------------------
// The act strip is a real horizontal scroller (touch, trackpad, wheel and
// mouse drag) whose content is duplicated once. A small rAF loop advances
// scrollLeft and wraps at half the track, so the loop is seamless while
// native panning and keyboard scrolling keep working. Dragging, wheeling or
// focusing pauses the automatic advance and schedules a short resume.
function initPannableBands() {
  const bands = Array.from(document.querySelectorAll('[data-pannable-band]'));
  if (!bands.length || prefersReducedMotion()) return;

  const SPEED = 40;          // px per second
  const RESUME_DELAY = 2400; // ms after the last interaction

  for (const viewport of bands) {
    const track = viewport.querySelector('[data-band-track]');
    const firstSet = track?.firstElementChild;
    if (!track || !firstSet) continue;

    // A two-set track only loops while one set is at least as wide as the
    // visible content (the padding is peek space, not content). On wide
    // screens the primary set can be narrower than the band, so clone it
    // until the scroll range covers one unit plus one visible width.
    const unitWidth = () => firstSet.getBoundingClientRect().width || 1;
    const visibleWidth = () => {
      const styles = getComputedStyle(viewport);
      const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      return Math.max(1, viewport.clientWidth - padX);
    };
    const ensureCopies = () => {
      const unit = unitWidth();
      if (!unit) return;
      while (track.scrollWidth + 1 < unit + visibleWidth()) {
        const clone = firstSet.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        track.appendChild(clone);
      }
    };
    ensureCopies();
    window.addEventListener('resize', ensureCopies, { passive: true });

    let paused = false;
    let dragging = false;
    let visible = true;
    let last = performance.now();
    let resumeTimer = null;
    let dragStartX = 0;
    let dragStartLeft = 0;

    const pause = () => {
      paused = true;
      if (resumeTimer !== null) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
      }
    };
    const resume = () => {
      paused = false;
      last = performance.now();
    };
    const resumeSoon = () => {
      if (resumeTimer !== null) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(resume, RESUME_DELAY);
    };
    const wrap = () => {
      const unit = unitWidth();
      if (viewport.scrollLeft >= unit) viewport.scrollLeft -= unit;
      else if (viewport.scrollLeft < 0) viewport.scrollLeft += unit;
    };
    const endDrag = (event) => {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove('is-dragging');
      if (event && viewport.hasPointerCapture?.(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      resumeSoon();
    };

    viewport.addEventListener('scroll', wrap, { passive: true });
    viewport.addEventListener('focus', pause);
    viewport.addEventListener('blur', resume);
    viewport.addEventListener('wheel', () => { pause(); resumeSoon(); }, { passive: true });
    viewport.addEventListener('touchstart', pause, { passive: true });
    viewport.addEventListener('touchend', resumeSoon, { passive: true });
    viewport.addEventListener('touchcancel', resumeSoon, { passive: true });

    viewport.addEventListener('pointerdown', (event) => {
      pause();
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      dragging = true;
      dragStartX = event.clientX;
      dragStartLeft = viewport.scrollLeft;
      viewport.classList.add('is-dragging');
      try {
        viewport.setPointerCapture?.(event.pointerId);
      } catch {
        // Capture is an enhancement; dragging still works without it.
      }
      event.preventDefault();
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      viewport.scrollLeft = dragStartLeft - (event.clientX - dragStartX);
      wrap();
    });
    viewport.addEventListener('pointerup', endDrag);
    viewport.addEventListener('pointercancel', endDrag);

    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      }, { threshold: 0.05 });
      observer.observe(viewport);
    }

    const step = (now) => {
      const dt = Math.min(64, now - last) / 1000;
      last = now;
      if (visible && !paused && !dragging && !document.hidden) {
        viewport.scrollLeft += SPEED * dt;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
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

  initParallax();
  initPannableBands();
  initReveal();
}

// A deferred module runs while readyState is already "interactive" but before
// DOMContentLoaded, so booting on anything but "complete" would translate the
// DOM before a page module imported after this one had a chance to call
// registerDictionary(). That is why only a document that has fully loaded boots
// immediately.
if (typeof document !== 'undefined' && document && typeof document.querySelectorAll === 'function') {
  if (document.readyState === 'complete') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }
}
