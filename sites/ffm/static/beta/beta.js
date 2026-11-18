// beta.js — open-beta invite page (/beta/).
//
// The locale layer, the reveal observer and the hero parallax are the same
// code the landing page runs, so this module imports /promo/promo.js instead
// of copying them: one storage key (ffm_locale), one set of locale rules.
// It contributes the page's dictionary, the language toggle wiring and the
// Android waitlist form; nothing else.
//
// Everything that touches `document`, `window` or `localStorage` stays behind
// a guard so node:test can import this module without a DOM.

import { getLocale, onLocaleChange, registerDictionary, t, toggleLocale } from '../promo/promo.js';

const TOGGLE_ID = 'beta-lang-toggle';
const WAITLIST_FORM_ID = 'android-waitlist-form';
const WAITLIST_STATUS_ID = 'android-waitlist-status';
const WAITLIST_ENDPOINT = '/api/beta/android-waitlist';

// key -> { de, en }. Every German value is byte-identical to the markup in
// index.html (beta.test.js enforces that, so copy can never drift). The keys
// are prefixed so they can never collide with the landing page's dictionary.
export const DICTIONARY = {
  // Accessibility / navigation chrome
  'beta.a11y.skip': { de: 'Zum Inhalt springen', en: 'Skip to content' },
  'beta.a11y.mainNav': { de: 'Hauptnavigation', en: 'Main navigation' },
  'beta.nav.steps': { de: 'Ablauf', en: 'How it works' },
  'beta.nav.ios': { de: 'iOS', en: 'iOS' },
  'beta.nav.android': { de: 'Android', en: 'Android' },
  'beta.nav.faq': { de: 'FAQ', en: 'FAQ' },
  'beta.nav.langToggle': { de: 'Sprache wechseln: Englisch', en: 'Switch language: German' },
  'beta.nav.play': { de: 'Jetzt spielen', en: 'Play now' },

  // Hero
  'beta.hero.kicker': { de: 'iOS-Beta abgeschlossen · Android-Beta offen', en: 'iOS beta concluded · Android beta open' },
  'beta.hero.title': {
    de: 'Die iOS-Beta ist abgeschlossen – danke!',
    en: 'The iOS beta is concluded – thank you!',
  },
  'beta.hero.sub': {
    de: 'Danke an alle, die mitgetestet haben: Euer Feedback steckt in der Version, die jetzt im App Store steht. Für Android sammeln wir weiter Google-Adressen für den Play-Test-Track – kostenlos, ohne Abo, mit direkter Rückmeldung an uns.',
    en: 'Thank you to everyone who tested with us: your feedback is in the version that is now on the App Store. For Android we keep collecting Google addresses for the Play test track – free of charge, no subscription, with direct feedback to us.',
  },
  'beta.appStoreLink': { de: 'Arithmo Slayer im App Store laden', en: 'Download Arithmo Slayer on the App Store' },
  'beta.hero.ctaAndroid': { de: 'Android: auf die Warteliste', en: 'Android: join the waitlist' },
  'beta.hero.phoneCaption': { de: 'Titelbildschirm der App', en: "The app's title screen" },

  // Requirements strip
  'beta.strip.label': { de: 'Voraussetzungen', en: 'Requirements' },
  'beta.strip.osTitle': { de: 'iOS 15 oder neuer', en: 'iOS 15 or newer' },
  'beta.strip.osText': { de: 'iPhone und iPad – im App Store', en: 'iPhone and iPad – on the App Store' },
  'beta.strip.androidTitle': { de: 'Android 7.0 oder neuer', en: 'Android 7.0 or newer' },
  'beta.strip.androidText': { de: 'Beta-Warteliste offen', en: 'Beta waitlist open' },
  'beta.strip.costTitle': { de: 'Kostenlos, kein Konto', en: 'Free, no account' },
  'beta.strip.costText': { de: 'lokale Profile, keine E-Mail', en: 'local profiles, no email' },

  // Section intro
  'beta.steps.kicker': { de: 'iOS abgeschlossen · Android offen', en: 'iOS concluded · Android open' },
  'beta.steps.title': { de: 'So geht es weiter', en: 'What happens next' },
  'beta.steps.lead': {
    de: 'Die öffentliche iOS-Beta ist beendet, die App steht im App Store. Wer auf Android mittesten will, trägt seine Google-Adresse ein – wir laden sie in den Play-Test-Track ein, sobald der Build dort liegt.',
    en: 'The public iOS beta has concluded and the app is on the App Store. If you want to test on Android, enter your Google address – we invite it to the Play test track as soon as the build is there.',
  },

  // iOS track
  'beta.ios.badge': { de: 'Abgeschlossen', en: 'Concluded' },
  'beta.ios.title': { de: 'iOS-Beta abgeschlossen', en: 'iOS beta concluded' },
  'beta.ios.text': {
    de: 'Die öffentliche Beta auf iOS ist beendet. Die TestFlight-Builds sind eingestellt; die fertige App steht im App Store – samt allem, was wir aus eurem Feedback gelernt haben.',
    en: 'The public beta on iOS has concluded. The TestFlight builds are discontinued; the finished app is on the App Store – including everything we learned from your feedback.',
  },
  'beta.ios.deviceLabel': { de: 'Geräte', en: 'Devices' },
  'beta.ios.deviceValue': { de: 'iPhone und iPad mit iOS 15 oder neuer', en: 'iPhone and iPad with iOS 15 or newer' },
  'beta.ios.accessLabel': { de: 'Zugang', en: 'Access' },
  'beta.ios.accessValue': {
    de: 'Im App Store – TestFlight ist nicht mehr nötig',
    en: 'On the App Store – TestFlight is no longer needed',
  },
  'beta.ios.costLabel': { de: 'Kosten', en: 'Cost' },
  'beta.ios.costValue': { de: 'Level 1–2 gratis, der Rest als Einmalkauf', en: 'Levels 1–2 free, the rest as a one-time purchase' },
  'beta.ios.note': {
    de: 'Danke an alle, die mitgetestet haben: Jede Meldung aus der Beta haben wir gelesen, und vieles davon steckt jetzt in der Store-Version. Fehler oder Wünsche? Schreib uns weiter an info@derschweigert.de.',
    en: 'Thank you to everyone who tested with us: we read every beta report, and much of it is in the store version now. Something broken or missing? Keep writing to info@derschweigert.de.',
  },
  'beta.ios.unlockTitle': { de: 'Vollversion nach der Beta', en: 'Full version after the beta' },
  'beta.ios.unlockText': {
    de: 'Der kostenlose Beta-Zugang ist vorbei. Level 1–2 bleiben gratis; Level 3–60 schaltest du im App Store mit einem Einmalkauf frei – kein Abo, keine Verlängerung.',
    en: 'The free beta access is over. Levels 1–2 stay free; you unlock levels 3–60 on the App Store with a one-time purchase – no subscription, no renewal.',
  },

  // Android track
  'beta.android.badge': { de: 'In Vorbereitung', en: 'In preparation' },
  'beta.android.title': { de: 'Android über Google Play', en: 'Android via Google Play' },
  'beta.android.text': {
    de: 'Die Android-Fassung ist in Arbeit und noch nicht im Play-Test-Track freigegeben. Trag deine Google-Adresse ein – wir laden sie ein, sobald der erste Build dort liegt.',
    en: "The Android version is in the works and not yet released on Google Play's test track. Enter your Google address – we will invite it as soon as the first build is there.",
  },
  'beta.android.deviceLabel': { de: 'Geräte', en: 'Devices' },
  'beta.android.deviceValue': { de: 'Android 7.0 oder neuer', en: 'Android 7.0 or newer' },
  'beta.android.accessLabel': { de: 'Zugang', en: 'Access' },
  'beta.android.accessValue': {
    de: 'Play-Test-Track per Einladung an deine Google-Adresse',
    en: 'Play test track by invitation to your Google address',
  },
  'beta.android.costLabel': { de: 'Kosten', en: 'Cost' },
  'beta.android.costValue': { de: 'Kostenlos, Level 1–2 bleiben gratis', en: 'Free, levels 1–2 stay free' },
  'beta.android.oneTitle': { de: 'Google-Adresse eintragen', en: 'Enter your Google address' },
  'beta.android.oneText': {
    de: 'Trag die Adresse deines Google-Kontos in das Formular ein – mehr brauchen wir nicht, kein Passwort und kein Profil.',
    en: 'Enter the address of your Google account in the form – that is all we need, no password and no profile.',
  },
  'beta.android.twoTitle': { de: 'Einladung abwarten', en: 'Wait for the invitation' },
  'beta.android.twoText': {
    de: 'Sobald der Test-Track offen ist, laden wir deine Adresse in der Play Console ein. Du bekommst dann eine Mail von Google Play.',
    en: 'As soon as the test track opens, we invite your address in the Play Console. You then get an email from Google Play.',
  },
  'beta.android.threeTitle': { de: 'Beitreten und installieren', en: 'Join and install' },
  'beta.android.threeText': {
    de: 'Öffne die Mail, tritt dem Test bei und installiere Arithmo Slayer aus dem Play Store.',
    en: 'Open the email, join the test and install Arithmo Slayer from the Play Store.',
  },
  'beta.android.threeMeta': { de: 'Spielbar offline · kein Login', en: 'Plays offline · no login' },
  'beta.android.fourTitle': { de: 'Rückmeldung geben', en: 'Send feedback' },
  'beta.android.fourText': {
    de: 'Was hakt, was fehlt, was ist unklar? Schreib uns – jede Meldung aus der Beta landet direkt bei uns.',
    en: 'Something broken, missing or unclear? Write to us – every beta report lands directly with us.',
  },
  'beta.android.fourLink': { de: 'Mail schreiben', en: 'Write an email' },
  'beta.android.formTitle': { de: 'Auf die Android-Warteliste', en: 'Join the Android waitlist' },
  'beta.android.formLabel': { de: 'Google-Konto (Gmail-Adresse)', en: 'Google account (Gmail address)' },
  'beta.android.formPlaceholder': { de: 'name@gmail.com', en: 'name@gmail.com' },
  'beta.android.formSubmit': { de: 'Auf die Warteliste', en: 'Join the waitlist' },
  'beta.android.formHint': {
    de: 'Nur Gmail- oder Googlemail-Adressen – mit einer Workspace-Adresse kann Google Play dich nicht einladen.',
    en: 'Gmail or Googlemail addresses only – Google Play cannot invite a Workspace address.',
  },
  'beta.android.formFallback': { de: 'Ohne JavaScript schreib uns eine Mail:', en: 'Without JavaScript, email us:' },
  'beta.android.note': {
    de: 'Wir nutzen die Adresse nur für diese Einladung – kein Newsletter, keine Weitergabe. Auf Wunsch löschen wir sie jederzeit wieder.',
    en: 'We use the address only for this invitation – no newsletter, no sharing. We delete it at any time on request.',
  },
  'beta.android.unlockTitle': { de: 'Vollversion in der Beta', en: 'Full version in the beta' },
  'beta.android.unlockText': {
    de: 'Kostenlos per Play-Promo-Code: Fordere ihn per Mail bei uns an – wir schicken dir den Code, du löst ihn im Play Store ein.',
    en: 'Free via a Play promo code: request it from us by email – we send you the code and you redeem it in the Play Store.',
  },
  'beta.android.unlockLink': { de: 'Promo-Code anfordern', en: 'Request a promo code' },

  // Waitlist form feedback (written by script, so never present in the markup)
  'beta.waitlist.sending': { de: 'Wird gesendet …', en: 'Sending …' },
  'beta.waitlist.registered': {
    de: 'Danke! Deine Adresse steht auf der Beta-Liste. Wir laden sie ein, sobald der Play-Test-Track offen ist.',
    en: 'Thank you! Your address is on the beta list. We will invite it as soon as the Play test track opens.',
  },
  'beta.waitlist.already': {
    de: 'Diese Adresse steht bereits auf der Beta-Liste – du musst nichts weiter tun.',
    en: 'This address is already on the beta list – there is nothing else to do.',
  },
  'beta.waitlist.invalid': {
    de: 'Bitte gib eine gültige Google-Adresse ein.',
    en: 'Please enter a valid Google address.',
  },
  'beta.waitlist.needsGmail': {
    de: 'Bitte nutze eine Gmail- oder Googlemail-Adresse – nur damit kann Google Play dich einladen.',
    en: 'Please use a Gmail or Googlemail address – only then can Google Play invite you.',
  },
  'beta.waitlist.rateLimited': {
    de: 'Zu viele Versuche in kurzer Zeit. Bitte warte eine Minute und versuche es erneut.',
    en: 'Too many attempts in a short time. Please wait a minute and try again.',
  },
  'beta.waitlist.error': {
    de: 'Das hat nicht geklappt. Bitte versuche es später erneut oder schreib uns eine Mail.',
    en: 'That did not work. Please try again later or send us an email.',
  },

  // Art
  'beta.art.kicker': { de: 'Ein Blick auf die Bühne', en: 'A look at the stage' },
  'beta.art.title': { de: 'Papier, Licht und ein Drache', en: 'Paper, light and a dragon' },
  'beta.art.lead': {
    de: 'Sechs gemalte Akte, 60 Level und 36 Feinde – dieselbe Kunst erwartet dich in der App.',
    en: 'Six painted acts, 60 levels and 36 fiends – the same art awaits you in the app.',
  },
  'beta.art.captionFight': { de: 'Nahkampf – der Hieb sitzt.', en: 'Melee – the swing lands.' },
  'beta.art.captionForest': { de: 'Akt 3 · Der erinnernde Wald', en: 'Act 3 · The Remembering Wood' },
  'beta.art.captionStorm': { de: 'Die Blitzkugel als Combo-Finale.', en: 'The lightning ball as the combo finale.' },

  // FAQ
  'beta.faq.kicker': { de: 'FAQ', en: 'FAQ' },
  'beta.faq.title': { de: 'Häufige Fragen zur Beta', en: 'Frequently asked questions about the beta' },
  'beta.faq.q1': { de: 'Was kostet die App?', en: 'What does the app cost?' },
  'beta.faq.a1': {
    de: 'Level 1–2 sind gratis, auch nach der Beta. Level 3–60 schaltest du im App Store mit einem Einmalkauf frei – kein Abo. In der laufenden Android-Beta ist die Vollversion per Play-Promo-Code kostenlos.',
    en: 'Levels 1–2 are free, after the beta too. You unlock levels 3–60 on the App Store with a one-time purchase – no subscription. In the running Android beta the full version is free via a Play promo code.',
  },
  'beta.faq.q2': {
    de: 'Brauche ich ein Konto oder eine E-Mail-Adresse?',
    en: 'Do I need an account or an email address?',
  },
  'beta.faq.a2': {
    de: 'Nein. Die App legt lokale Profile auf dem Gerät an – ohne E-Mail und ohne Passwort. Eine Mail brauchst du nur, wenn du uns schreiben möchtest.',
    en: 'No. The app creates local profiles on the device – no email, no password. You only need an email if you want to write to us.',
  },
  'beta.faq.q3': { de: 'Welche iOS-Version brauche ich?', en: 'Which iOS version do I need?' },
  'beta.faq.a3': {
    de: 'iOS 15 oder neuer – auf iPhone und iPad. Die App steht im App Store; TestFlight brauchst du nicht mehr.',
    en: 'iOS 15 or newer – on iPhone and iPad. The app is on the App Store; you no longer need TestFlight.',
  },
  'beta.faq.q4': { de: 'Wann kommt Android?', en: 'When is Android coming?' },
  'beta.faq.a4': {
    de: 'Sobald der Play-Test-Track offen ist. Wer auf der Warteliste steht, bekommt die Einladung von Google Play per Mail an die eingetragene Google-Adresse.',
    en: 'As soon as the Play test track opens. Everyone on the waitlist gets the invitation from Google Play by email to the address they entered.',
  },
  'beta.faq.q5': { de: 'Läuft die App offline?', en: 'Does the app work offline?' },
  'beta.faq.a5': {
    de: 'Ja. Das Spiel läuft ohne Internet; nur Kauf und Wiederherstellung brauchen eine Verbindung.',
    en: 'Yes. The game runs without internet; only purchase and restore need a connection.',
  },
  'beta.faq.q6': { de: 'Welche Daten erhebt die Beta?', en: 'What data does the beta collect?' },
  'beta.faq.a6Link': {
    de: 'Datenschutzerklärung der App lesen',
    en: 'Read the app privacy policy',
  },
  'beta.faq.a6': {
    de: 'Die App selbst spielt ohne Konto, ohne Werbung und ohne Analyse-Tracking. Die iOS-Beta lief über TestFlight, die Android-Warteliste gehört zum Play-Test-Track – Dienste von Apple bzw. Google, deren Datenschutzhinweise gelten. Für die Android-Warteliste speichern wir nur die Adresse, die du einträgst.',
    en: 'The app itself plays without an account, without ads and without analytics tracking. The iOS beta ran through TestFlight, the Android waitlist belongs to the Play test track – services run by Apple and Google, whose privacy notices apply. For the Android waitlist we store only the address you enter.',
  },
  'beta.faq.q7': { de: 'Was passiert nach der Beta?', en: 'What happens after the beta?' },
  'beta.faq.a7': {
    de: 'Die iOS-App ist im App Store erhältlich – installier sie dort regulär. Die Android-Beta läuft noch; danach erscheint Arithmo Slayer auch bei Google Play.',
    en: 'The iOS app is available on the App Store – install it there as usual. The Android beta is still running; after it, Arithmo Slayer arrives on Google Play too.',
  },
  'beta.faq.q8': { de: 'Wo melde ich einen Fehler?', en: 'Where do I report a bug?' },
  'beta.faq.a8': {
    de: 'Schreib an info@derschweigert.de und nenne Gerät, Systemversion und was du gerade gemacht hast. Screenshots helfen.',
    en: 'Write to info@derschweigert.de and mention your device, system version and what you were doing. Screenshots help.',
  },

  // Footer
  'beta.footer.tagline': {
    de: 'Kopfrechnen für Jung und Alt – im Browser, die iPhone-App im App Store, die Android-Beta offen.',
    en: 'Mental math for young and old – in the browser, the iPhone app on the App Store, the Android beta open.',
  },
  'beta.footer.play': { de: 'Zum Spiel', en: 'To the game' },
  'beta.footer.legalTitle': { de: 'Rechtliches', en: 'Legal' },
  'beta.footer.legalImpressum': { de: 'Impressum', en: 'Imprint' },
  'beta.footer.legalPrivacy': { de: 'Datenschutz', en: 'Privacy' },
  'beta.footer.legalPrivacyApp': { de: 'App-Datenschutz', en: 'App privacy' },
  'beta.footer.legalTermsApp': { de: 'AGB der App', en: 'App terms' },
  'beta.footer.legalTerms': { de: 'AGB', en: 'Terms' },
  'beta.footer.legalImpressumEn': { de: 'Imprint (EN)', en: 'Imprint (EN)' },
  'beta.footer.legalPrivacyEn': { de: 'Privacy (EN)', en: 'Privacy (EN)' },
  'beta.footer.legalTermsEn': { de: 'Terms (EN)', en: 'Terms (EN)' },
  'beta.footer.supportTitle': { de: 'Support', en: 'Support' },
  'beta.footer.supportText': {
    de: 'Fragen, Wünsche oder ein Fehler gefunden? Schreib uns.',
    en: 'Questions, wishes or found a bug? Write to us.',
  },
  'beta.footer.copyright': { de: '© 2026 Der Schweigert · Arithmo Slayer', en: '© 2026 Der Schweigert · Arithmo Slayer' },
};

// Has to run at import time: promo.js translates the DOM in its own
// DOMContentLoaded boot, which fires after every module has been evaluated.
registerDictionary(DICTIONARY);

/** Updates the toggle button: "EN" while German is active, "DE" while English is. */
function syncToggle() {
  if (typeof document === 'undefined' || !document) return;
  const button = document.getElementById(TOGGLE_ID);
  if (!button) return;
  const code = button.querySelector('.lang-toggle-code');
  if (code) code.textContent = getLocale() === 'de' ? 'EN' : 'DE';
}

// --- Android waitlist -------------------------------------------------

/**
 * Last feedback shown in the waitlist form, so a language switch can
 * re-render it instead of leaving a German sentence in an English page.
 * `state` drives the styling, `key` the translation.
 */
let waitlistFeedback = null;

function renderWaitlistStatus(status) {
  if (!status || !waitlistFeedback) return;
  status.textContent = t(waitlistFeedback.key);
  status.dataset.state = waitlistFeedback.state;
}

function initWaitlistForm() {
  const form = document.getElementById(WAITLIST_FORM_ID);
  if (!form) return;
  const status = document.getElementById(WAITLIST_STATUS_ID);
  const input = form.querySelector('input[type="email"]');
  const button = form.querySelector('button[type="submit"]');

  const setFeedback = (key, state) => {
    waitlistFeedback = { key, state };
    renderWaitlistStatus(status);
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    // The markup keeps native validation (type=email, required), so this only
    // catches browsers that let an invalid value through.
    if (!form.checkValidity()) {
      setFeedback('beta.waitlist.invalid', 'error');
      if (typeof form.reportValidity === 'function') form.reportValidity();
      return;
    }

    setFeedback('beta.waitlist.sending', 'pending');
    if (button) button.disabled = true;
    try {
      const response = await fetch(WAITLIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.value, locale: getLocale() }),
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        setFeedback(
          data.status === 'already_registered' ? 'beta.waitlist.already' : 'beta.waitlist.registered',
          'ok',
        );
        input.value = '';
      } else if (response.status === 429) {
        setFeedback('beta.waitlist.rateLimited', 'error');
      } else if (response.status === 400) {
        const data = await response.json().catch(() => ({}));
        setFeedback(
          data.error === 'google_mail_required' ? 'beta.waitlist.needsGmail' : 'beta.waitlist.invalid',
          'error',
        );
      } else {
        setFeedback('beta.waitlist.error', 'error');
      }
    } catch {
      setFeedback('beta.waitlist.error', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  });

  onLocaleChange(() => renderWaitlistStatus(status));
}

function boot() {
  const button = document.getElementById(TOGGLE_ID);
  if (button) {
    button.addEventListener('click', () => toggleLocale());
  }
  onLocaleChange(syncToggle);
  syncToggle();
  initWaitlistForm();
}

if (typeof document !== 'undefined' && document && typeof document.querySelectorAll === 'function') {
  if (document.readyState === 'complete') {
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }
}
