// i18n.js — Lightweight English/German locale support for the Arithmo
// Slayer game UI.
//
// Scope: translates user-visible chrome (splash screen, auth/account
// modals, billing, gameplay overlays, HUD labels, common errors). It does
// NOT translate: brand/product names ("Arithmo Slayer"), code
// identifiers/API values, equation/problem content, the legal pages
// (terms*.html, datenschutz*.html, impressum*.html, cancel.html — these are
// already offered as separate German/English documents), or the Cloudflare
// Turnstile security widget (embedded third-party UI).
//
// Locale is auto-detected from the browser (German for de* locales, English
// otherwise), remembered across visits via localStorage, and can be
// switched at any time with a visible toggle without reloading the page —
// see setLocale()/toggleLocale() and onLocaleChange().
//
// This module is written defensively around `window`/`document`/
// `localStorage`/`navigator` so it can be imported from plain Node
// (node:test) without a DOM: every browser API access is guarded.

export const SUPPORTED_LOCALES = ['en', 'de'];
export const DEFAULT_LOCALE = 'en';
const STORAGE_KEY = 'ffm_locale';

const listeners = new Set();
let currentLocale = null;

// --- Dictionary -------------------------------------------------------
// key -> { en, de }. Keys are grouped by UI area for readability. Values
// may contain `{placeholders}` substituted via t(key, { placeholder: value
// }). Keys ending in `Html` are trusted static markup (never user content)
// used with data-i18n-html.
const DICTIONARY = {
  // Splash screen
  'splash.intro': {
    en: 'Train your math reflexes, beat the clock, and climb the rankings one correct answer at a time.',
    de: 'Trainiere deine Kopfrechen-Reflexe, schlage die Uhr und klettere in der Rangliste nach oben – eine richtige Antwort nach der anderen.',
  },
  'splash.loginRegister': { en: 'Login / Register', de: 'Anmelden / Registrieren' },
  'splash.logout': { en: 'Logout', de: 'Abmelden' },
  'splash.greeting': { en: 'Welcome, {username}!', de: 'Willkommen, {username}!' },
  'splash.chooseDifficulty': { en: 'Choose your difficulty:', de: 'Wähle deinen Schwierigkeitsgrad:' },
  'leaderboard.title': { en: 'Leaderboard', de: 'Bestenliste' },
  'leaderboard.allYears': { en: 'All years', de: 'Alle Jahrgänge' },
  'leaderboard.unclassified': { en: 'Unclassified', de: 'Nicht eingeordnet' },
  'leaderboard.note': { en: 'Showing high scores set in the last 2 weeks.', de: 'Zeigt Highscores der letzten 2 Wochen.' },
  'leaderboard.loading': { en: 'Loading leaderboard…', de: 'Bestenliste wird geladen…' },
  'leaderboard.empty': { en: 'No high scores yet.', de: 'Noch keine Highscores.' },
  'leaderboard.completeProfile': { en: 'Complete profile', de: 'Profil vervollständigen' },
  'leaderboard.profilePrompt': {
    en: 'Add your first grade year in profile to join year groups.',
    de: 'Trage dein Einschulungsjahr im Profil ein, um an Jahrgangsgruppen teilzunehmen.',
  },
  'leaderboard.yearPromptInvalid': { en: 'Please enter a valid year.', de: 'Bitte gib ein gültiges Jahr ein.' },
  'leaderboard.yearPromptMessage': { en: 'Enter your first grade year (e.g. 2012):', de: 'Gib dein Einschulungsjahr ein (z. B. 2012):' },
  'leaderboard.personalBest': { en: "Your high score: {score} ({date})", de: 'Dein Highscore: {score} ({date})' },
  'leaderboard.jumpLabel': { en: "Jump to a level you've already cleared:", de: 'Springe zu einem bereits geschafften Level:' },
  'levels.startFromOne': { en: 'Start from Level 1', de: 'Ab Level 1 starten' },
  'levels.level': { en: 'Level {level}', de: 'Level {level}' },
  'scoreHistory.ariaLabel': { en: 'Score history chart', de: 'Punkteverlauf-Diagramm' },
  'personalDevelopment.title': { en: 'My progress', de: 'Mein Fortschritt' },
  'personalDevelopment.perLevelBest': { en: 'Level {level}: {score} points', de: 'Level {level}: {score} Punkte' },
  'personalDevelopment.completed': { en: '{completed} of {total} levels completed', de: '{completed} von {total} Leveln geschafft' },
  'personalDevelopment.noProgress': {
    en: 'No progress yet — clear a level to start your history.',
    de: 'Noch kein Fortschritt – schaffe ein Level, um deinen Verlauf zu starten.',
  },
  'common.close': { en: 'Close', de: 'Schließen' },
  'common.page': { en: '{page} / {pages}', de: '{page} / {pages}' },
  'common.previous': { en: 'Previous', de: 'Zurück' },
  'common.next': { en: 'Next', de: 'Weiter' },
  'personalDevelopment.loadFailed': {
    en: 'Could not load your progress. Please try again.',
    de: 'Dein Fortschritt konnte nicht geladen werden. Bitte versuche es erneut.',
  },
  'profiles.defaultName': { en: 'Player 1', de: 'Spieler 1' },
  'profiles.title': { en: 'Family players', de: 'Spieler der Familie' },
  'profiles.playingAsLabel': { en: 'Playing as', de: 'Spieler' },
  'profiles.progressForLabel': { en: 'Progress for', de: 'Fortschritt von' },
  'profiles.switchPlayer': { en: 'Switch player', de: 'Spieler wechseln' },
  'hud.status': { en: 'Game status', de: 'Spielstatus' },
  'hud.hearts': { en: 'Hearts', de: 'Herzen' },
  'hud.time': { en: 'Time', de: 'Zeit' },
  'hud.timeRemaining': { en: 'Time remaining', de: 'Verbleibende Zeit' },
  'hud.combo': { en: 'Combo', de: 'Serie' },
  'hud.score': { en: 'Score', de: 'Punkte' },
  'hud.countShapes': { en: 'Count the shapes', de: 'Zähle die Formen' },
  'hud.incorrect': { en: 'Not quite', de: 'Noch nicht ganz' },
  'hud.timeout': { en: 'Time ran out', de: 'Zeit abgelaufen' },
  'nav.play': { en: 'Play', de: 'Spielen' },
  'nav.progress': { en: 'Progress', de: 'Fortschritt' },
  'nav.players': { en: 'Players', de: 'Spieler' },
  'nav.levels': { en: 'Levels', de: 'Level' },
  'nav.leaderboard': { en: 'Ranking', de: 'Rangliste' },
  'practice.title': { en: 'Practice sessions', de: 'Übungseinheiten' },
  'practice.sessionType': { en: 'Session type', de: 'Übungsart' },
  'practice.kind.targeted': { en: 'Targeted practice', de: 'Gezieltes Üben' },
  'practice.kind.short': { en: 'Short practice', de: 'Kurzes Training' },
  'practice.kind.assisted': { en: 'Assisted practice', de: 'Unterstütztes Training' },
  'practice.kind.elite': { en: 'Elite practice', de: 'Elite-Training' },
  'practice.kind.recovery': { en: 'Recovery practice', de: 'Aufholtraining' },
  'practice.kind.shapes': { en: 'Shape counting', de: 'Formen zählen' },
  'practice.level': { en: 'Source level', de: 'Ausgangslevel' },
  'practice.badges': { en: 'Practice badges', de: 'Übungsabzeichen' },
  'practice.start': { en: 'Start practice', de: 'Training starten' },
  'practice.unscoredNotice': {
    en: 'Practice is unscored and does not change campaign progress.',
    de: 'Training ist unbewertet und verändert den Abenteuerfortschritt nicht.',
  },
  'practice.retry': { en: 'Try this practice again', de: 'Dieses Training wiederholen' },
  'practice.resultsTitle': { en: 'Practice complete', de: 'Training abgeschlossen' },
  'practice.completed': {
    en: 'Practice complete — {correct} correct answers.',
    de: 'Training abgeschlossen – {correct} richtige Antworten.',
  },
  'practice.questionProgress': {
    en: 'Questions resolved: {resolved} / {total}',
    de: 'Aufgaben bearbeitet: {resolved} / {total}',
  },
  'practice.invalidMode': { en: 'Choose a valid practice type.', de: 'Wähle eine gültige Übungsart.' },
  'practice.noMissedProblems': {
    en: 'No missed questions from Level {level} are available yet. Play that level first.',
    de: 'Für Level {level} gibt es noch keine falsch beantworteten Aufgaben. Spiele zuerst dieses Level.',
  },
  'practice.startFailed': {
    en: 'Practice for Level {level} could not start. Check access and try again.',
    de: 'Das Training für Level {level} konnte nicht starten. Prüfe den Zugriff und versuche es erneut.',
  },
  'practice.badgesLoadFailed': {
    en: 'Practice badges could not be loaded.',
    de: 'Übungsabzeichen konnten nicht geladen werden.',
  },
  'practice.badgesSaveFailed': {
    en: 'Practice finished, but its badge could not be saved. Retry saving below.',
    de: 'Das Training ist beendet, aber das Abzeichen konnte nicht gespeichert werden. Versuche es unten erneut.',
  },
  'practice.retryBadgeSave': { en: 'Retry badge save', de: 'Abzeichen erneut speichern' },
  'practice.badge.practice-targeted': { en: 'Targeted practice', de: 'Gezieltes Üben' },
  'practice.badge.practice-shapes': { en: 'Shape practice', de: 'Formen-Training' },
  'practice.badge.practice-addition': { en: 'Addition practice', de: 'Additionstraining' },
  'practice.badge.practice-subtraction': { en: 'Subtraction practice', de: 'Subtraktionstraining' },
  'practice.badge.practice-multiplication': { en: 'Multiplication practice', de: 'Multiplikationstraining' },
  'practice.badge.practice-division': { en: 'Division practice', de: 'Divisionstraining' },
  'practice.intro.title': { en: 'Level {level}: a new skill', de: 'Level {level}: eine neue Fähigkeit' },
  'practice.intro.body': {
    en: 'Review the idea and a worked example before the practice begins.',
    de: 'Sieh dir die Erklärung und ein Beispiel an, bevor das Training beginnt.',
  },
  'practice.intro.example': { en: 'Worked example', de: 'Beispiel mit Rechenweg' },
  'practice.intro.continue': { en: 'Continue', de: 'Weiter' },
  'practice.intro.skip': { en: 'Skip example', de: 'Beispiel überspringen' },
  'skillIntro.subtraction.explanation': {
    en: 'Subtraction finds the difference. Start at {a} and take away {b}.',
    de: 'Bei der Subtraktion findest du den Unterschied. Starte bei {a} und ziehe {b} ab.',
  },
  'skillIntro.subtraction.workedExample': {
    en: '{a} − {b} = {answer}. Count back {b} steps from {a}.',
    de: '{a} − {b} = {answer}. Zähle von {a} {b} Schritte zurück.',
  },
  'skillIntro.multiplication.explanation': {
    en: 'Multiplication counts equal groups. {a} groups of {b} make the total.',
    de: 'Multiplikation zählt gleich große Gruppen. {a} Gruppen mit je {b} ergeben zusammen.',
  },
  'skillIntro.multiplication.workedExample': {
    en: '{a} × {b} means {a} groups of {b}: {answer}.',
    de: '{a} × {b} bedeutet {a} Gruppen mit je {b}: {answer}.',
  },
  'skillIntro.division.explanation': {
    en: 'Division shares a total into equal groups. Split {a} fairly into {b} groups.',
    de: 'Bei der Division wird eine Gesamtmenge gleich verteilt. Teile {a} gerecht in {b} Gruppen.',
  },
  'skillIntro.division.workedExample': {
    en: '{a} ÷ {b} = {answer}. Since {b} × {answer} = {a}, the division is exact.',
    de: '{a} ÷ {b} = {answer}. Weil {b} × {answer} = {a}, geht die Division ohne Rest auf.',
  },
  'audio.settings': { en: 'Audio settings', de: 'Toneinstellungen' },
  'audio.musicVolume': { en: 'Music volume', de: 'Musiklautstärke' },
  'audio.musicVolumeUnavailable': {
    en: 'Music volume control is disabled until audio routing is verified on this device.',
    de: 'Die Musiklautstärke ist deaktiviert, bis die Audioausgabe auf diesem Gerät überprüft wurde.',
  },
  'audio.musicVolumeReady': { en: 'Music volume control is available.', de: 'Die Musiklautstärke kann angepasst werden.' },
  'audio.effectsVolume': { en: 'Effects volume', de: 'Effektlautstärke' },
  'audio.preferencesSaveFailed': {
    en: 'Audio changed, but this device could not save the preference.',
    de: 'Der Ton wurde geändert, aber die Einstellung konnte auf diesem Gerät nicht gespeichert werden.',
  },
  'audio.preferencesLoadFailed': {
    en: 'Saved audio settings could not be read; current device defaults remain in use.',
    de: 'Gespeicherte Toneinstellungen konnten nicht gelesen werden; die aktuellen Gerätevorgaben bleiben aktiv.',
  },
  'nav.terms': { en: 'Terms', de: 'AGB' },
  'overlay.pause': { en: 'Pause', de: 'Pause' },
  'campaign.continueAt': { en: 'Continue at Level {level}', de: 'Weiter bei Level {level}' },
  'campaign.replay': { en: 'Replay Level {level}', de: 'Level {level} wiederholen' },
  'campaign.complete': { en: 'Campaign complete — replay your favourites', de: 'Abenteuer geschafft — spiele deine Lieblingslevel erneut' },
  'campaign.victory': { en: 'Adventure complete!', de: 'Abenteuer geschafft!' },
  'campaign.chooseLevel': { en: 'Continue or replay a cleared level:', de: 'Weiterspielen oder ein geschafftes Level wiederholen:' },
  'profiles.navigation': { en: 'Players', de: 'Spieler' },
  'splash.play': { en: 'Play', de: 'Spielen' },
  'splash.levels': { en: 'Levels', de: 'Level' },
  'scoreHistory.title': { en: 'Score history', de: 'Punkteverlauf' },
  'profiles.create': { en: 'Add player', de: 'Spieler hinzufügen' },
  'profiles.rename': { en: 'Rename', de: 'Umbenennen' },
  'profiles.delete': { en: 'Delete player', de: 'Spieler löschen' },
  'profiles.name': { en: 'Player name', de: 'Spielername' },
  'profiles.save': { en: 'Save', de: 'Speichern' },
  'profiles.cancel': { en: 'Cancel', de: 'Abbrechen' },
  'profiles.previous': { en: 'Previous', de: 'Zurück' },
  'profiles.next': { en: 'Next', de: 'Weiter' },
  'profiles.page': { en: '{page} / {pages}', de: '{page} / {pages}' },
  'profiles.confirmDelete': {
    en: 'Delete {name} and all their progress?',
    de: '{name} und den gesamten Fortschritt löschen?',
  },
  'profiles.confirm': { en: 'Confirm deletion', de: 'Löschen bestätigen' },
  'profiles.switchBlocked': {
    en: 'Return to the title screen before changing players.',
    de: 'Kehre zum Titel zurück, bevor du den Spieler wechselst.',
  },
  'profiles.invalidName': { en: 'Enter a valid player name.', de: 'Gib einen gültigen Spielernamen ein.' },
  'profiles.lastProfile': { en: 'Keep at least one player.', de: 'Mindestens ein Spieler muss bleiben.' },
  'profiles.storageError': {
    en: 'Player data could not be saved or loaded. Please try again.',
    de: 'Spielerdaten konnten nicht gespeichert oder geladen werden. Bitte versuche es erneut.',
  },
  'overlay.finishGame': { en: 'Finish game', de: 'Spiel abschließen' },
  'overlay.quitAttemptTitle': { en: 'Leave this attempt?', de: 'Diesen Versuch beenden?' },
  'attempt.firstReplies': { en: 'First answers: {correct}/{total} correct', de: 'Erste Antworten: {correct}/{total} richtig' },
  'attempt.bestStreak': { en: 'Best streak: {streak}', de: 'Beste Serie: {streak}' },
  'attempt.accuracyImproved': { en: 'More accurate than your last clear at this difficulty!', de: 'Genauer als beim letzten Abschluss auf dieser Schwierigkeit!' },
  'attempt.streakImproved': { en: 'Your best streak grew by {improvement}!', de: 'Deine beste Serie ist um {improvement} gewachsen!' },
  'attempt.personalBest': { en: 'New personal score best!', de: 'Neue persönliche Bestpunktzahl!' },
  'attempt.replayGoal': { en: 'Next goal: one more correct first answer.', de: 'Nächstes Ziel: eine erste Antwort mehr richtig.' },
  'attempt.keepAccuracy': { en: 'Next goal: keep that accuracy on your next attempt.', de: 'Nächstes Ziel: auch beim nächsten Versuch so genau bleiben.' },
  'reward.fireball': { en: 'Fireball', de: 'Feuerball' },
  'reward.lightning': { en: 'Lightning', de: 'Blitz' },
  'reward.dragon': { en: 'Dragon', de: 'Drache' },
  'reward.cast': { en: '{ability}!', de: '{ability}!' },
  'reward.upcoming': { en: '{ability} in {count}', de: '{ability} in {count}' },
  'reward.upcomingChance': { en: '{ability} {chance}% in {count}', de: '{ability} {chance}% in {count}' },
  'reward.activeChance': { en: '{ability}: {chance}% per hit', de: '{ability}: {chance}% pro Treffer' },
  'feedback.shapesAnswer': { en: 'There are {count} shapes.', de: 'Es sind {count} Formen.' },
  'gameplay.encounters': { en: 'Defeated: {defeated}/{total}', de: 'Besiegt: {defeated}/{total}' },
  'gameplay.healProgress': { en: 'Heal: {percent}%', de: 'Heilen: {percent}%' },
  'overlay.completedProgressNotice': {
    en: 'Cleared levels stay saved. Points from this unfinished level are not recorded.',
    de: 'Geschaffte Level bleiben gespeichert. Punkte aus diesem unfertigen Level werden nicht gespeichert.',
  },

  // Difficulty buttons
  'difficulty.shapes.label': { en: 'Shapes', de: 'Formen' },
  'difficulty.shapes.detail': { en: 'Count the shapes · no score, no end', de: 'Formen zählen · keine Punkte, kein Ende' },
  'difficulty.easy.label': { en: 'Easy', de: 'Leicht' },
  'difficulty.easy.detail': { en: '15 seconds · 7 hearts', de: '15 Sekunden · 7 Herzen' },
  'difficulty.medium.label': { en: 'Medium', de: 'Mittel' },
  'difficulty.medium.detail': { en: '10 seconds · 5 hearts', de: '10 Sekunden · 5 Herzen' },
  'difficulty.hard.label': { en: 'Hard', de: 'Schwer' },
  'difficulty.hard.detail': { en: '5 seconds · 3 hearts', de: '5 Sekunden · 3 Herzen' },

  'legal.impressum': { en: 'Impressum', de: 'Impressum' },
  'legal.privacy': { en: 'Privacy', de: 'Datenschutz' },
  'legal.cancellation': { en: 'Cancellation', de: 'Kündigung' },
  'legal.withdrawal': { en: 'Withdraw contract', de: 'Vertrag widerrufen' },
  'legal.terms': { en: 'Terms', de: 'AGB' },
  'legal.termsEnglish': { en: 'Terms (English)', de: 'AGB (Englisch)' },
  'legal.privacyEn': { en: 'Privacy (EN)', de: 'Datenschutz (EN)' },

  // Top bar
  'topbar.login': { en: 'Login', de: 'Anmelden' },
  'topbar.logout': { en: 'Logout', de: 'Abmelden' },
  'topbar.muteAriaLabel': { en: 'Mute sound', de: 'Ton stummschalten' },
  'topbar.unmuteAriaLabel': { en: 'Unmute sound', de: 'Ton einschalten' },
  'lang.toggleAriaLabel': { en: 'Switch to German', de: 'Auf Englisch umschalten' },
  'lang.toggleLabel': { en: 'DE', de: 'EN' },

  // Cookie banner
  'cookie.notice': { en: 'This site uses a security widget that requires your consent.', de: 'Diese Seite verwendet ein Sicherheits-Widget, das deine Zustimmung erfordert.' },
  'cookie.privacyLink': { en: 'Privacy Policy', de: 'Datenschutzerklärung' },
  'cookie.accept': { en: 'Accept', de: 'Akzeptieren' },
  'cookie.decline': { en: 'Decline', de: 'Ablehnen' },
  'cookie.turnstileBlocked': {
    en: 'This feature requires the security check script. Please accept cookies in the banner to continue.',
    de: 'Diese Funktion benötigt das Sicherheits-Skript. Bitte akzeptiere die Cookies im Banner, um fortzufahren.',
  },
  'cookie.settingsLink': { en: 'Cookie settings', de: 'Cookie-Einstellungen' },

  // Auth modal — login
  'auth.tabLogin': { en: 'Login', de: 'Anmelden' },
  'auth.tabRegister': { en: 'Register', de: 'Registrieren' },
  'auth.usernamePlaceholder': { en: 'Username', de: 'Benutzername' },
  'auth.passwordPlaceholder': { en: 'Password', de: 'Passwort' },
  'auth.loginSubmit': { en: 'Login', de: 'Anmelden' },
  'auth.forgotPassword': { en: 'Forgot password?', de: 'Passwort vergessen?' },
  'auth.resendEmailPlaceholder': { en: 'Your email', de: 'Deine E-Mail-Adresse' },
  'auth.resendVerification': { en: 'Resend verification email', de: 'Bestätigungs-E-Mail erneut senden' },
  'auth.verifyBeforeLogin': {
    en: 'Please verify your email before logging in.',
    de: 'Bitte bestätige deine E-Mail-Adresse, bevor du dich anmeldest.',
  },
  'auth.enterEmailToResend': {
    en: 'Enter your email to resend the verification link.',
    de: 'Gib deine E-Mail-Adresse ein, um den Bestätigungslink erneut zu senden.',
  },
  'auth.verificationResent': {
    en: 'Verification email sent. Please check your inbox.',
    de: 'Bestätigungs-E-Mail gesendet. Bitte prüfe dein Postfach.',
  },

  // Auth modal — register
  'auth.regUsernamePlaceholder': { en: 'Username (3-20 chars)', de: 'Benutzername (3–20 Zeichen)' },
  'auth.emailPlaceholder': { en: 'Email', de: 'E-Mail-Adresse' },
  'auth.regPasswordPlaceholder': { en: 'Password (8+ chars)', de: 'Passwort (mind. 8 Zeichen)' },
  'auth.firstGradeYearPlaceholder': { en: 'First grade year (optional)', de: 'Einschulungsjahr (optional)' },
  'auth.consentAdultOrGuardian': {
    en: "I confirm I am at least 18 years old. If this account will be used by a child, I confirm I am that child's parent/legal guardian and consent to their use of this service.",
    de: 'Ich bestätige, dass ich mindestens 18 Jahre alt bin. Falls dieses Konto von einem Kind genutzt wird, bestätige ich, dass ich der Elternteil/Erziehungsberechtigte dieses Kindes bin und der Nutzung dieses Dienstes zustimme.',
  },
  'auth.registerSubmit': { en: 'Register', de: 'Registrieren' },
  'auth.mustConfirmTerms': {
    en: 'You must confirm the terms and age requirements to register.',
    de: 'Du musst die Bedingungen und Altersanforderungen bestätigen, um dich zu registrieren.',
  },
  'auth.registrationSuccessful': {
    en: 'Registration successful! Check your email to verify your account before logging in.',
    de: 'Registrierung erfolgreich! Prüfe deine E-Mails, um dein Konto zu bestätigen, bevor du dich anmeldest.',
  },

  // Auth modal — forgot/reset password
  'auth.forgotEmailPlaceholder': { en: 'Your email', de: 'Deine E-Mail-Adresse' },
  'auth.sendResetLink': { en: 'Send reset link', de: 'Link zum Zurücksetzen senden' },
  'auth.backToLogin': { en: 'Back to login', de: 'Zurück zum Login' },
  'auth.resetLinkSent': {
    en: 'If that email is registered, a reset link has been sent.',
    de: 'Falls diese E-Mail-Adresse registriert ist, wurde ein Link zum Zurücksetzen gesendet.',
  },
  'auth.newPasswordPlaceholder': { en: 'New password (8+ chars)', de: 'Neues Passwort (mind. 8 Zeichen)' },
  'auth.confirmNewPasswordPlaceholder': { en: 'Confirm new password', de: 'Neues Passwort bestätigen' },
  'auth.resetPasswordSubmit': { en: 'Reset Password', de: 'Passwort zurücksetzen' },
  'auth.passwordsDoNotMatch': { en: 'Passwords do not match.', de: 'Die Passwörter stimmen nicht überein.' },
  'auth.missingOrExpiredResetLink': {
    en: 'Missing or expired reset link.',
    de: 'Fehlender oder abgelaufener Link zum Zurücksetzen.',
  },
  'auth.passwordResetDone': { en: 'Password reset! You can now log in.', de: 'Passwort zurückgesetzt! Du kannst dich jetzt anmelden.' },
  'auth.accountDeleted': { en: 'Your account has been deleted.', de: 'Dein Konto wurde gelöscht.' },

  // Account modal
  'account.tabProfile': { en: 'Profile', de: 'Profil' },
  'account.tabPassword': { en: 'Password', de: 'Passwort' },
  'account.tabScores': { en: 'High Scores', de: 'Highscores' },
  'account.tabBilling': { en: 'Billing', de: 'Abo & Zahlung' },
  'account.tabDanger': { en: 'Delete Account', de: 'Konto löschen' },
  'account.currentEmailLabel': { en: 'Current email:', de: 'Aktuelle E-Mail-Adresse:' },
  'account.newEmailPlaceholder': { en: 'New email (optional)', de: 'Neue E-Mail-Adresse (optional)' },
  'account.currentPasswordForEmailPlaceholder': {
    en: 'Current password (required to change email)',
    de: 'Aktuelles Passwort (erforderlich für E-Mail-Änderung)',
  },
  'account.save': { en: 'Save', de: 'Speichern' },
  'account.pendingEmailNote': {
    en: 'Verification pending for {email}. Check that inbox to confirm the change.',
    de: 'Bestätigung ausstehend für {email}. Prüfe dieses Postfach, um die Änderung zu bestätigen.',
  },
  'account.loadProfileFailed': { en: 'Failed to load profile.', de: 'Profil konnte nicht geladen werden.' },
  'account.validYearRequired': { en: 'Please enter a valid year.', de: 'Bitte gib ein gültiges Jahr ein.' },
  'account.currentPasswordRequiredForEmail': {
    en: 'Enter your current password to change your email.',
    de: 'Gib dein aktuelles Passwort ein, um deine E-Mail-Adresse zu ändern.',
  },
  'account.saved': { en: 'Saved.', de: 'Gespeichert.' },
  'account.currentPasswordPlaceholder': { en: 'Current password', de: 'Aktuelles Passwort' },
  'account.newPasswordPlaceholder': { en: 'New password (8+ chars)', de: 'Neues Passwort (mind. 8 Zeichen)' },
  'account.confirmNewPasswordPlaceholder': { en: 'Confirm new password', de: 'Neues Passwort bestätigen' },
  'account.changePassword': { en: 'Change Password', de: 'Passwort ändern' },
  'account.newPasswordsDoNotMatch': { en: 'New passwords do not match.', de: 'Die neuen Passwörter stimmen nicht überein.' },
  'account.passwordChanged': { en: 'Password changed.', de: 'Passwort geändert.' },
  'auth.passwordChangedPleaseLogIn': {
    en: 'Password changed. For your security, please log in again.',
    de: 'Passwort geändert. Bitte melde dich aus Sicherheitsgründen erneut an.',
  },

  // Billing
  'billing.loading': { en: 'Loading billing status...', de: 'Abrechnungsstatus wird geladen...' },
  'billing.loadingShort': { en: 'Loading...', de: 'Wird geladen...' },
  'billing.loadFailed': { en: 'Failed to load billing status', de: 'Abrechnungsstatus konnte nicht geladen werden' },
  'billing.managePortal': { en: 'Manage Subscription', de: 'Abo verwalten' },
  'billing.openingPortal': { en: 'Opening subscription management...', de: 'Abo-Verwaltung wird geöffnet...' },
  'billing.subscribe': { en: 'Subscribe (€3/3 months)', de: 'Abonnieren (3 €/3 Monate)' },
  'billing.cancelRenewals': { en: 'Cancel future renewals', de: 'Zukünftige Verlängerungen kündigen' },
  'billing.refreshStatus': { en: 'Refresh access status', de: 'Zugriffsstatus aktualisieren' },
  'billing.retryCodeGrant': { en: 'Retry pending code grant', de: 'Ausstehende Code-Einlösung erneut versuchen' },
  'billing.redeemCodePlaceholder': { en: 'Enter code', de: 'Code eingeben' },
  'billing.redeem': { en: 'Redeem', de: 'Einlösen' },
  'billing.pleaseEnterCode': { en: 'Please enter a code.', de: 'Bitte gib einen Code ein.' },
  'billing.codeRedeemed': { en: 'Code redeemed! Access granted.', de: 'Code eingelöst! Zugriff gewährt.' },
  'billing.redeemFailed': { en: 'Failed to redeem code.', de: 'Code konnte nicht eingelöst werden.' },
  'billing.invalidPortalUrl': { en: 'Invalid portal URL. Please try again.', de: 'Ungültige Portal-URL. Bitte versuche es erneut.' },
  'billing.openPortalFailed': { en: 'Failed to open billing portal.', de: 'Abo-Verwaltung konnte nicht geöffnet werden.' },
  'billing.foundingPlayer': {
    en: 'Founding player: free access while the service operates.',
    de: 'Gründungsspieler: kostenloser Zugriff, solange der Dienst betrieben wird.',
  },
  'billing.accessUntil': { en: 'Access until {date}.', de: 'Zugriff bis {date}.' },
  'billing.prelaunch': { en: 'Paid access has not launched yet.', de: 'Der kostenpflichtige Zugriff ist noch nicht verfügbar.' },
  'billing.freeLevelsNotice': {
    en: 'Levels 1–2 are free. Later levels require a subscription or a code.',
    de: 'Level 1–2 sind kostenlos. Spätere Level benötigen ein Abo oder einen Code.',
  },
  'billing.nextPayment': { en: 'Next payment: €3 on {date}.', de: 'Nächste Zahlung: 3 € am {date}.' },
  'billing.noFurtherPaymentScheduled': {
    en: 'No further payment is currently scheduled.',
    de: 'Derzeit ist keine weitere Zahlung geplant.',
  },
  'billing.disclosure': {
    en: 'Premium subscription unlocks levels 3-60. Free players can enjoy levels 1-2 anytime.',
    de: 'Das Premium-Abo schaltet die Level 3–60 frei. Kostenlose Spieler können Level 1–2 jederzeit spielen.',
  },
  'billing.confirmCancelRenewals': {
    en: 'Stop future renewals? Already-paid and gifted access will remain available.',
    de: 'Zukünftige Verlängerungen stoppen? Bereits bezahlter und geschenkter Zugriff bleibt erhalten.',
  },

  // Account danger zone
  'account.dangerWarning': {
    en: 'Deleting your account is permanent and cannot be undone. All your scores and profile data will be erased immediately.',
    de: 'Das Löschen deines Kontos ist endgültig und kann nicht rückgängig gemacht werden. Alle deine Highscores und Profildaten werden sofort gelöscht.',
  },
  'account.deletePasswordPlaceholder': { en: 'Current password', de: 'Aktuelles Passwort' },
  'account.deleteConfirmCheck': { en: 'I understand this cannot be undone.', de: 'Ich verstehe, dass dies nicht rückgängig gemacht werden kann.' },
  'account.deleteSubmit': { en: 'Delete my account permanently', de: 'Mein Konto endgültig löschen' },
  'account.deleteConfirmNeeded': {
    en: 'Please confirm you understand this cannot be undone.',
    de: 'Bitte bestätige, dass du verstehst, dass dies nicht rückgängig gemacht werden kann.',
  },
  'account.enterCurrentPassword': { en: 'Enter your current password.', de: 'Gib dein aktuelles Passwort ein.' },
  'account.confirmDeleteDialog': {
    en: 'This will permanently delete your account and all your scores. This cannot be undone. Continue?',
    de: 'Dadurch werden dein Konto und alle deine Highscores endgültig gelöscht. Dies kann nicht rückgängig gemacht werden. Fortfahren?',
  },

  // Auth status modal
  'auth.working': { en: 'Working...', de: 'Wird bearbeitet...' },
  'auth.verifyingEmail': { en: 'Verifying your email...', de: 'E-Mail-Adresse wird bestätigt...' },
  'auth.emailVerified': { en: 'Your email has been verified! You can now log in.', de: 'Deine E-Mail-Adresse wurde bestätigt! Du kannst dich jetzt anmelden.' },
  'auth.verificationFailed': { en: 'Verification failed: {message}', de: 'Bestätigung fehlgeschlagen: {message}' },
  'auth.confirmingEmailChange': { en: 'Confirming your new email address...', de: 'Neue E-Mail-Adresse wird bestätigt...' },
  'auth.emailChangeConfirmed': { en: 'Your new email address has been confirmed!', de: 'Deine neue E-Mail-Adresse wurde bestätigt!' },
  'auth.emailChangeConfirmFailed': { en: 'Could not confirm email change: {message}', de: 'E-Mail-Änderung konnte nicht bestätigt werden: {message}' },
  'auth.paymentConfirmPending': {
    en: 'Payment confirmation pending. Use Refresh access status after confirmation.',
    de: 'Zahlungsbestätigung ausstehend. Nutze „Zugriffsstatus aktualisieren“ nach der Bestätigung.',
  },
  'auth.paymentConfirmFailed': { en: 'Could not confirm payment: {message}', de: 'Zahlung konnte nicht bestätigt werden: {message}' },
  'auth.loginRequiredForPremium': { en: 'Please log in to play premium levels', de: 'Bitte melde dich an, um Premium-Level zu spielen' },
  'auth.subscriptionRequired': { en: 'Premium subscription required', de: 'Premium-Abo erforderlich' },
  'auth.accessDenied': { en: 'Access denied', de: 'Zugriff verweigert' },
  'auth.failedToLoadLevel': { en: 'Failed to load level {level}', de: 'Level {level} konnte nicht geladen werden' },

  // Checkout modal
  'checkout.title': { en: 'Subscribe to Arithmo Slayer Premium', de: 'Arithmo Slayer Premium abonnieren' },
  'checkout.priceLine': {
    en: '€3 every 3 months (€1/month equivalent), including applicable VAT. Renews automatically. Cancel future renewals at any time; access continues until the paid period ends.',
    de: '3 € alle 3 Monate (entspricht 1 €/Monat), inkl. anfallender Mehrwertsteuer. Verlängert sich automatisch. Zukünftige Verlängerungen können jederzeit gekündigt werden; der Zugriff bleibt bis zum Ende des bezahlten Zeitraums bestehen.',
  },
  'checkout.audienceNote': {
    en: 'Subscriptions are for adult purchasers in Germany. Children may play with a parent or guardian\'s permission.',
    de: 'Abos richten sich an erwachsene Käufer in Deutschland. Kinder dürfen mit Erlaubnis eines Elternteils oder Erziehungsberechtigten spielen.',
  },
  'checkout.discontinuationNote': {
    en: 'The service may eventually be discontinued. We will inform subscribers in advance about closure and subscription handling. Statutory rights remain unaffected.',
    de: 'Der Dienst könnte irgendwann eingestellt werden. Abonnenten werden im Voraus über die Einstellung und den Umgang mit Abos informiert. Gesetzliche Rechte bleiben unberührt.',
  },
  'checkout.consentAdult': {
    en: "I confirm I am at least 18 years old. Children can play this game with a parent's account.",
    de: 'Ich bestätige, dass ich mindestens 18 Jahre alt bin. Kinder können dieses Spiel mit dem Konto eines Elternteils spielen.',
  },
  'checkout.consentTermsHtml': {
    en: 'I accept the <a href="/terms.en.html" target="_blank">terms of service</a> and <a href="/datenschutz.en.html" target="_blank">privacy policy</a>',
    de: 'Ich akzeptiere die <a href="/terms.html" target="_blank">Nutzungsbedingungen</a> und die <a href="/datenschutz.html" target="_blank">Datenschutzerklärung</a>',
  },
  // Verbatim, operator-approved digital-content declarations (Sec. 356
  // BGB) -- the German wording is authoritative and must match
  // app/legal_texts.py IMMEDIATE_ACCESS_DECLARATION/WITHDRAWAL_WAIVER_DECLARATION
  // exactly; the English text is a non-binding translation only.
  'checkout.consentImmediateAccess': {
    de: 'Ich stimme ausdrücklich zu, dass Urs Schweigert vor Ablauf der Widerrufsfrist mit der Bereitstellung der kostenpflichtigen digitalen Inhalte beginnt.',
    en: 'I expressly agree that Urs Schweigert begins providing the paid digital content before the withdrawal period has expired. (Non-binding translation; the German wording is authoritative.)',
  },
  'checkout.consentWithdrawalWaiver': {
    de: 'Mir ist bekannt, dass ich durch meine Zustimmung mit Beginn der Bereitstellung mein Widerrufsrecht verliere.',
    en: 'I am aware that by giving this consent, I lose my right of withdrawal once provision of the content begins. (Non-binding translation; the German wording is authoritative.)',
  },
  'checkout.proceed': { en: 'Proceed to Checkout', de: 'Weiter zur Kasse' },
  'checkout.confirmAdultAndTerms': {
    en: 'Please confirm you are 18+ and accept the terms.',
    de: 'Bitte bestätige, dass du 18+ bist, und akzeptiere die Bedingungen.',
  },
  'checkout.confirmDigitalContentDeclarations': {
    en: 'Please confirm both digital-content declarations above.',
    de: 'Bitte bestätige beide Erklärungen zu den digitalen Inhalten oben.',
  },
  'checkout.invalidUrl': { en: 'Invalid checkout URL. Please try again.', de: 'Ungültige Checkout-URL. Bitte versuche es erneut.' },
  'checkout.failed': { en: 'Checkout failed.', de: 'Checkout fehlgeschlagen.' },

  // Gameplay overlays
  'overlay.levelClearTitle': { en: 'Level {level} Clear!', de: 'Level {level} geschafft!' },
  'overlay.scoreLine': { en: 'Score: {score}', de: 'Punkte: {score}' },
  'overlay.nextLevel': { en: 'Next Level', de: 'Nächstes Level' },
  'overlay.replayLevel': { en: 'Play Same Level Again', de: 'Level erneut spielen' },
  'overlay.saveScoreReturnTitleHtml': { en: 'Save Score &amp; Return to Title', de: 'Punkte speichern &amp; zurück zum Titel' },
  'overlay.saveScoreFailed': { en: 'Could not save score. Please try again.', de: 'Punkte konnten nicht gespeichert werden. Bitte versuche es erneut.' },
  'overlay.gameOverTitle': { en: 'Game Over', de: 'Spiel vorbei' },
  'overlay.shapesTryAgain': { en: 'Take a breath, then try again!', de: 'Atme kurz durch und versuch es noch einmal!' },
  'overlay.retryLevel': { en: 'Try This Level Again', de: 'Level erneut versuchen' },
  'overlay.returnTitle': { en: 'Return to Title', de: 'Zurück zum Titel' },
  'overlay.pausedTitle': { en: 'Paused', de: 'Pausiert' },
  'overlay.resume': { en: 'Resume', de: 'Weiterspielen' },
  'overlay.quitScorePrompt': { en: 'Save your score before leaving?', de: 'Punkte vor dem Verlassen speichern?' },
  'overlay.discardScore': { en: 'Discard Score & Return to Title', de: 'Punkte verwerfen & zurück zum Titel' },
  'overlay.backToPause': { en: 'Back', de: 'Zurück' },
  'overlay.guestScoreNotice': { en: 'Only signed-in players can save scores.', de: 'Nur angemeldete Spieler können Punkte speichern.' },
  'overlay.shapesScoreNotice': { en: 'Shapes practice does not record scores.', de: 'Beim Formen-Training werden keine Punkte gespeichert.' },
  'overlay.healTipTitle': { en: 'Low on Hearts!', de: 'Wenig Herzen!' },
  'overlay.healTipBodyHtml': {
    en: 'On multiple-choice levels, hold your finger on the <strong>left edge</strong> of the screen while you play to slowly heal your hearts — no tapping required! It only works while you solve problems in your head, so try not to count on your fingers.',
    de: 'Halte in Multiple-Choice-Leveln deinen Finger auf den <strong>linken Rand</strong> des Bildschirms, während du spielst, um langsam deine Herzen zu heilen – ohne zu tippen! Das funktioniert nur, solange du die Aufgaben im Kopf löst, also versuche, nicht an den Fingern zu zählen.',
  },
  'overlay.healTipBody': {
    en: 'Hold the left quarter of the playfield for nine seconds to restore one heart. Keep holding while choosing answers with another finger. Getting hurt interrupts healing.',
    de: 'Halte das linke Viertel des Spielfelds neun Sekunden lang, um ein Herz zu heilen. Halte weiter, während du mit einem anderen Finger antwortest. Verletzungen unterbrechen das Heilen.',
  },
  'overlay.healTipConfirm': { en: 'Got it!', de: 'Verstanden!' },

  // Gameplay input
  'input.answerPlaceholder': { en: '...', de: '...' },
  'input.strike': { en: 'Strike!', de: 'Angriff!' },

  // Footer
  'footer.cancellation': { en: 'Cancellation', de: 'Kündigung' },
  'footer.withdrawal': { en: 'Withdraw contract', de: 'Vertrag widerrufen' },
  'footer.terms': { en: 'Terms', de: 'AGB' },
  'footer.privacyEn': { en: 'Privacy (EN)', de: 'Datenschutz (EN)' },
  'errors.unknownServerError': {
    en: 'Something went wrong. Please try again.',
    de: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
  },

  // HUD (canvas-drawn, not DOM)
  'hud.shapes': { en: 'Shapes', de: 'Formen' },
  'hud.level': { en: 'Level {level}', de: 'Level {level}' },
};

// --- Known server/error identifiers --------------------------------------
// Backend responses mix machine identifiers (snake_case, e.g.
// "email_not_verified") with plain English sentences. We only translate
// messages we recognize exactly; anything else (arbitrary user/server
// content) is shown as-is so we never mistranslate or mangle content we
// don't control.
const SERVER_MESSAGES = {
  // auth.py identifiers
  captcha_verification_failed: { en: 'Security check failed. Please try again.', de: 'Sicherheitsüberprüfung fehlgeschlagen. Bitte versuche es erneut.' },
  email_not_verified: { en: 'Please verify your email before logging in.', de: 'Bitte bestätige deine E-Mail-Adresse, bevor du dich anmeldest.' },
  invalid_or_expired_token: { en: 'This link is invalid or has expired.', de: 'Dieser Link ist ungültig oder abgelaufen.' },
  'Invalid request': { en: 'Invalid request.', de: 'Ungültige Anfrage.' },
  'Invalid input': { en: 'Invalid input.', de: 'Ungültige Eingabe.' },
  'Invalid credentials': { en: 'Invalid credentials.', de: 'Ungültige Zugangsdaten.' },
  'Invalid current password': { en: 'Invalid current password.', de: 'Falsches aktuelles Passwort.' },
  'Username must be 3-20 alphanumeric characters': {
    en: 'Username must be 3-20 alphanumeric characters.',
    de: 'Der Benutzername muss 3–20 alphanumerische Zeichen enthalten.',
  },
  'Valid email required': { en: 'A valid email address is required.', de: 'Eine gültige E-Mail-Adresse ist erforderlich.' },
  'Password must be 8-128 characters': { en: 'Password must be 8-128 characters.', de: 'Das Passwort muss 8–128 Zeichen lang sein.' },
  'Username or email already taken': { en: 'Username or email already taken.', de: 'Benutzername oder E-Mail-Adresse bereits vergeben.' },
  'Email address already in use': { en: 'Email address already in use.', de: 'E-Mail-Adresse wird bereits verwendet.' },
  'New email must be different from current email': {
    en: 'New email must be different from current email.',
    de: 'Die neue E-Mail-Adresse muss sich von der aktuellen unterscheiden.',
  },
  'No refresh token': { en: 'Not logged in.', de: 'Nicht angemeldet.' },
  'Refresh token expired or invalid': { en: 'Your session has expired. Please log in again.', de: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.' },

  // Fallback messages thrown by api.js when the server gives no error detail
  'Registration failed': { en: 'Registration failed.', de: 'Registrierung fehlgeschlagen.' },
  'Login failed': { en: 'Login failed.', de: 'Anmeldung fehlgeschlagen.' },
  'Session changed during login. Please try again.': {
    en: 'Session changed during login. Please try again.',
    de: 'Die Sitzung hat sich während der Anmeldung geändert. Bitte versuche es erneut.',
  },
  'Failed to resend verification email': { en: 'Failed to resend verification email.', de: 'Bestätigungs-E-Mail konnte nicht erneut gesendet werden.' },
  'Verification failed': { en: 'Verification failed.', de: 'Bestätigung fehlgeschlagen.' },
  'Failed to send reset email': { en: 'Failed to send reset email.', de: 'E-Mail zum Zurücksetzen konnte nicht gesendet werden.' },
  'Password reset failed': { en: 'Password reset failed.', de: 'Passwort-Zurücksetzung fehlgeschlagen.' },
  'Could not confirm email change': { en: 'Could not confirm email change.', de: 'E-Mail-Änderung konnte nicht bestätigt werden.' },
  'Failed to change password': { en: 'Failed to change password.', de: 'Passwort konnte nicht geändert werden.' },
  'Failed to update email': { en: 'Failed to update email.', de: 'E-Mail-Adresse konnte nicht aktualisiert werden.' },
  'Failed to delete account': { en: 'Failed to delete account.', de: 'Konto konnte nicht gelöscht werden.' },
  'Failed to fetch level': { en: 'Failed to fetch level.', de: 'Level konnte nicht geladen werden.' },
  'Failed to fetch level config': { en: 'Failed to fetch level.', de: 'Level konnte nicht geladen werden.' },
  'Failed to fetch billing status': { en: 'Failed to fetch billing status.', de: 'Abrechnungsstatus konnte nicht geladen werden.' },
  'Checkout failed': { en: 'Checkout failed.', de: 'Checkout fehlgeschlagen.' },
  'Failed to open billing portal': { en: 'Failed to open billing portal.', de: 'Abo-Verwaltung konnte nicht geöffnet werden.' },
  'Failed to redeem code': { en: 'Failed to redeem code.', de: 'Code konnte nicht eingelöst werden.' },
  'Failed to cancel subscription': { en: 'Failed to cancel subscription.', de: 'Abo konnte nicht gekündigt werden.' },

  // access-flow.js identifiers/messages
  'Authentication required': { en: 'Authentication required.', de: 'Anmeldung erforderlich.' },
  payment_required: { en: 'Payment required.', de: 'Zahlung erforderlich.' },
  'Access denied': { en: 'Access denied.', de: 'Zugriff verweigert.' },

  // billing.py identifiers
  account_not_found: { en: 'Account not found.', de: 'Konto nicht gefunden.' },
  verification_required: { en: 'Please verify your email first.', de: 'Bitte bestätige zuerst deine E-Mail-Adresse.' },
  billing_provider_unavailable: {
    en: 'Billing is temporarily unavailable. Please retry — no access grant was assumed.',
    de: 'Die Abrechnung ist vorübergehend nicht verfügbar. Bitte versuche es erneut — es wurde kein Zugriff gewährt.',
  },
  sales_unavailable: { en: 'Sales are currently unavailable.', de: 'Der Verkauf ist derzeit nicht verfügbar.' },
  subscription_not_needed: { en: 'A subscription is not needed right now.', de: 'Ein Abo wird derzeit nicht benötigt.' },
  adult_and_terms_confirmation_required: {
    en: 'Please confirm you are 18+ and accept the terms.',
    de: 'Bitte bestätige, dass du 18+ bist, und akzeptiere die Bedingungen.',
  },
  invalid_declarations_language: {
    en: 'Could not determine the checkout language. Please reload the page and try again.',
    de: 'Die Checkout-Sprache konnte nicht ermittelt werden. Bitte lade die Seite neu und versuche es erneut.',
  },
  declarations_version_mismatch: {
    en: 'The checkout terms were updated. Please reload the page and try again.',
    de: 'Die Checkout-Bedingungen wurden aktualisiert. Bitte lade die Seite neu und versuche es erneut.',
  },
  digital_content_declarations_required: {
    en: 'Please confirm both digital-content declarations above.',
    de: 'Bitte bestätige beide Erklärungen zu den digitalen Inhalten oben.',
  },
  payment_confirmation_pending: {
    en: 'Payment confirmation pending. Use Refresh access status after confirmation.',
    de: 'Zahlungsbestätigung ausstehend. Nutze „Zugriffsstatus aktualisieren“ nach der Bestätigung.',
  },
  no_billing_account: { en: 'No billing account found.', de: 'Kein Abrechnungskonto gefunden.' },
  portal_unavailable: {
    en: 'Subscription management is temporarily unavailable. Please retry later.',
    de: 'Die Abo-Verwaltung ist vorübergehend nicht verfügbar. Bitte versuche es später erneut.',
  },
  code_not_needed: { en: 'A code is not needed right now.', de: 'Ein Code wird derzeit nicht benötigt.' },
  invalid_code: { en: 'Invalid code.', de: 'Ungültiger Code.' },
  invalid_webhook_signature: { en: 'The payment confirmation could not be verified.', de: 'Die Zahlungsbestätigung konnte nicht überprüft werden.' },
  billing_retry_required: { en: 'Billing is temporarily unavailable. Please retry.', de: 'Die Abrechnung ist vorübergehend nicht verfügbar. Bitte versuche es erneut.' },
  subscription_mismatch: { en: 'The subscription could not be verified for this account.', de: 'Das Abo konnte diesem Konto nicht zugeordnet werden.' },
  invalid_subscription: { en: 'The subscription could not be verified.', de: 'Das Abo konnte nicht überprüft werden.' },
  invalid_invoice: { en: 'The payment could not be verified.', de: 'Die Zahlung konnte nicht überprüft werden.' },
  account_deleted: { en: 'This account has been deleted.', de: 'Dieses Konto wurde gelöscht.' },
  billing_conflict: { en: 'Your billing information changed. Please refresh and try again.', de: 'Deine Abrechnungsdaten haben sich geändert. Bitte aktualisiere die Seite und versuche es erneut.' },
  invalid_price: { en: 'The subscription price is unavailable.', de: 'Der Abo-Preis ist nicht verfügbar.' },
  gift_period_too_short_for_checkout: { en: 'Your existing access period is too short to start checkout.', de: 'Dein bestehender Zugriffszeitraum ist zu kurz, um den Bezahlvorgang zu starten.' },
  billing_busy: {
    en: 'Resolve the pending code redemption before deleting your account.',
    de: 'Löse die ausstehende Code-Einlösung, bevor du dein Konto löschst.',
  },

  // main.py identifiers
  level_not_found: { en: 'Level not found.', de: 'Level nicht gefunden.' },
  registration_required: { en: 'Please log in to play premium levels.', de: 'Bitte melde dich an, um Premium-Level zu spielen.' },
  premium_access_required: { en: 'Premium subscription required.', de: 'Premium-Abo erforderlich.' },
  level_required: { en: 'A level is required.', de: 'Ein Level ist erforderlich.' },
  'Invalid first_grade_year filter': { en: 'Invalid year filter.', de: 'Ungültiger Jahrgangsfilter.' },

  // cancel_requests.py identifiers
  invalid_request: { en: 'Invalid request.', de: 'Ungültige Anfrage.' },
  invalid_idempotency_key: { en: 'Invalid request. Please try again.', de: 'Ungültige Anfrage. Bitte versuche es erneut.' },
  valid_contact_email_required: { en: 'A valid contact email is required.', de: 'Eine gültige Kontakt-E-Mail-Adresse ist erforderlich.' },
  invalid_account_email: { en: 'Invalid account email.', de: 'Ungültige Konto-E-Mail-Adresse.' },
  invalid_username: { en: 'Invalid username.', de: 'Ungültiger Benutzername.' },
  identifying_info_required: { en: 'Identifying information is required.', de: 'Identifizierende Angaben sind erforderlich.' },
  invalid_cancellation_type: { en: 'Invalid cancellation type.', de: 'Ungültiger Kündigungstyp.' },
  reason_too_long: { en: 'Reason is too long.', de: 'Begründung ist zu lang.' },
  idempotency_conflict: { en: 'This request was already submitted differently.', de: 'Diese Anfrage wurde bereits anders übermittelt.' },
  requested_date_must_be_future: { en: 'The requested date must be in the future.', de: 'Das gewünschte Datum muss in der Zukunft liegen.' },
  requested_date_not_allowed: { en: 'The requested date is not allowed.', de: 'Das gewünschte Datum ist nicht zulässig.' },
  requested_date_too_far: { en: 'The requested date is too far in the future.', de: 'Das gewünschte Datum liegt zu weit in der Zukunft.' },
  invalid_requested_date: { en: 'The requested date is invalid.', de: 'Das gewünschte Datum ist ungültig.' },
  stripe_reference_too_long: { en: 'The payment reference is too long.', de: 'Die Zahlungsreferenz ist zu lang.' },
  invalid_status: { en: 'This status is invalid.', de: 'Dieser Status ist ungültig.' },
  not_found: { en: 'The requested item was not found.', de: 'Der angeforderte Eintrag wurde nicht gefunden.' },
  cannot_process: { en: 'This request cannot be processed.', de: 'Diese Anfrage kann nicht bearbeitet werden.' },
  invalid_outcome: { en: 'The selected outcome is invalid.', de: 'Das ausgewählte Ergebnis ist ungültig.' },
  already_exists: { en: 'This account already exists.', de: 'Dieses Konto existiert bereits.' },
  wrong_identity: { en: 'This code belongs to a different account.', de: 'Dieser Code gehört zu einem anderen Konto.' },
  expired: { en: 'This code has expired.', de: 'Dieser Code ist abgelaufen.' },
  already_redeemed: { en: 'This code has already been redeemed.', de: 'Dieser Code wurde bereits eingelöst.' },
  invalid_months: { en: 'The access period is invalid.', de: 'Der Zugriffszeitraum ist ungültig.' },
  version_mismatch: { en: 'Your data changed. Please refresh and try again.', de: 'Deine Daten haben sich geändert. Bitte aktualisiere die Seite und versuche es erneut.' },
};

// --- Locale persistence/detection ----------------------------------------

function hasLocalStorage() {
  try {
    return typeof localStorage !== 'undefined' && localStorage !== null;
  } catch {
    return false;
  }
}

function readStoredLocale() {
  if (!hasLocalStorage()) return null;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LOCALES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale) {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Quota exceeded or storage disabled: locale just won't persist.
  }
}

function detectBrowserLocale() {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const langs = (nav && Array.isArray(nav.languages) && nav.languages.length)
      ? nav.languages
      : (nav && nav.language ? [nav.language] : []);
    for (const lang of langs) {
      if (typeof lang !== 'string') continue;
      const baseLanguage = lang.toLowerCase().split('-')[0];
      if (SUPPORTED_LOCALES.includes(baseLanguage)) return baseLanguage;
    }
  } catch {
    // ignore and fall through to default
  }
  return DEFAULT_LOCALE;
}

// Auth-action emails (verify/reset-password/confirm-email-change) carry a
// `?lang=` query param on their link, set server-side from the locale the
// user had selected when they *triggered* the email (see app/auth.py,
// app/main.py), so opening the emailed link reopens the page in that same
// language even if this browser's stored/detected locale differs (e.g. a
// different device, or the user toggled languages again since). This is
// deliberately a one-time, non-persisted override for this page load only
// — it never overwrites the user's own stored `ffm_locale` preference —
// so clicking an old email link can't silently and permanently flip the
// language on a shared/returning device.
function readUrlLocale() {
  try {
    if (typeof window === 'undefined' || !window.location) return null;
    const value = new URLSearchParams(window.location.search).get('lang');
    return SUPPORTED_LOCALES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

/** Returns the active locale ('en' or 'de'), resolving it on first access. */
export function getLocale() {
  if (!currentLocale) {
    currentLocale = readUrlLocale() || readStoredLocale() || detectBrowserLocale();
  }
  return currentLocale;
}

/** Registers a callback invoked with the new locale whenever it changes. */
export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(locale) {
  const errors = [];
  for (const listener of listeners) {
    try {
      listener(locale);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'One or more locale-change listeners failed.');
  }
}

function applyDocumentLang(locale) {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = locale;
  }
}

/**
 * Sets the active locale, persists it (unless `persist: false`), updates
 * `<html lang>`, re-translates the DOM (if present), and notifies
 * listeners. Does not reload the page, so gameplay state is preserved.
 */
export function setLocale(locale, { persist = true } = {}) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    throw new RangeError(`Unsupported locale: ${locale}`);
  }
  currentLocale = locale;
  if (persist) writeStoredLocale(locale);
  applyDocumentLang(locale);
  translateDom();
  notifyListeners(locale);
  return locale;
}

/** Switches between 'en' and 'de'. */
export function toggleLocale() {
  return setLocale(getLocale() === 'de' ? 'en' : 'de');
}

/** Translates `key` into the active locale, substituting `{name}` vars. */
export function t(key, vars) {
  const entry = DICTIONARY[key];
  if (!entry) return key;
  const locale = getLocale();
  let text = entry[locale] ?? entry.en ?? key;
  if (vars) {
    for (const name of Object.keys(vars)) {
      text = text.split(`{${name}}`).join(String(vars[name]));
    }
  }
  return text;
}

/**
 * Translates a known backend error identifier/sentence. Unknown content
 * (arbitrary user/server text) is returned unchanged — we never guess at
 * content we don't control.
 */
export function translateServerMessage(message) {
  if (typeof message !== 'string') return message;
  const entry = SERVER_MESSAGES[message];
  if (!entry) {
    return /^[a-z][a-z0-9_]*$/.test(message) ? t('errors.unknownServerError') : message;
  }
  const locale = getLocale();
  return entry[locale] ?? entry.en ?? message;
}

/**
 * Applies translations to every element under `root` (defaults to
 * `document`) carrying a `data-i18n*` attribute. Safe to call repeatedly
 * (e.g. after dynamically inserting markup) and a no-op outside a DOM.
 */
export function translateDom(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return;

  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  scope.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}

/** Initializes locale on page load: resolves locale, sets `<html lang>`, translates DOM. */
export function initI18n() {
  const locale = getLocale();
  applyDocumentLang(locale);
  translateDom();
  return locale;
}

// Test-only helper: resets module-level locale cache so unrelated tests
// that run in the same process don't leak locale state into one another.
export function _resetForTests() {
  currentLocale = null;
  listeners.clear();
}
