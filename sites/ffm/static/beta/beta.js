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
  'beta.hero.kicker': { de: 'Offene Beta für iPhone und Android', en: 'Open beta for iPhone and Android' },
  'beta.hero.title': {
    de: 'Spiele Arithmo Slayer, bevor es alle tun',
    en: 'Play Arithmo Slayer before everyone else',
  },
  'beta.hero.sub': {
    de: 'Die offene Beta läuft auf iOS über TestFlight – und für Android sammeln wir gerade die Google-Adressen für den Play-Test-Track. Kostenlos, ohne Abo, mit direkter Rückmeldung an uns.',
    en: 'The open beta runs on iOS through TestFlight – and for Android we are collecting the Google addresses for the Play test track. Free of charge, no subscription, with direct feedback to us.',
  },
  'beta.hero.ctaIos': { de: 'iOS-Beta bei TestFlight starten', en: 'Start the iOS beta on TestFlight' },
  'beta.hero.ctaAndroid': { de: 'Android: auf die Warteliste', en: 'Android: join the waitlist' },
  'beta.hero.phoneCaption': { de: 'Titelbildschirm der App', en: "The app's title screen" },

  // Requirements strip
  'beta.strip.label': { de: 'Voraussetzungen', en: 'Requirements' },
  'beta.strip.osTitle': { de: 'iOS 15 oder neuer', en: 'iOS 15 or newer' },
  'beta.strip.osText': { de: 'iPhone und iPad', en: 'iPhone and iPad' },
  'beta.strip.testflightTitle': { de: 'Kostenlose TestFlight-App', en: 'Free TestFlight app' },
  'beta.strip.testflightText': { de: 'von Apple, aus dem App Store', en: 'from Apple, on the App Store' },
  'beta.strip.costTitle': { de: 'Kostenlos, kein Konto', en: 'Free, no account' },
  'beta.strip.costText': { de: 'lokale Profile, keine E-Mail', en: 'local profiles, no email' },

  // Section intro
  'beta.steps.kicker': { de: 'Zwei Wege in die Beta', en: 'Two ways into the beta' },
  'beta.steps.title': { de: 'So kommst du hinein', en: 'How to get in' },
  'beta.steps.lead': {
    de: 'iOS läuft über TestFlight und ist offen. Android läuft über den Test-Track von Google Play – dort sammeln wir zuerst die Google-Adressen, die eingeladen werden sollen.',
    en: "iOS runs through TestFlight and is open. Android runs through Google Play's test track – there we first collect the Google addresses to invite.",
  },

  // iOS track
  'beta.ios.badge': { de: 'Jetzt offen', en: 'Open now' },
  'beta.ios.title': { de: 'iOS über TestFlight', en: 'iOS via TestFlight' },
  'beta.ios.text': {
    de: 'Die iOS-Beta läuft als TestFlight-Build direkt von Apple. Du bekommst den Stand, an dem wir gerade arbeiten – samt der Baustellen, die noch offen sind.',
    en: 'The iOS beta runs as a TestFlight build straight from Apple. You get the build we are working on – including the rough edges that are still open.',
  },
  'beta.ios.deviceLabel': { de: 'Geräte', en: 'Devices' },
  'beta.ios.deviceValue': { de: 'iPhone und iPad mit iOS 15 oder neuer', en: 'iPhone and iPad with iOS 15 or newer' },
  'beta.ios.accessLabel': { de: 'Zugang', en: 'Access' },
  'beta.ios.accessValue': {
    de: 'Öffentlicher Link, keine E-Mail-Einladung nötig',
    en: 'Public link, no emailed invitation needed',
  },
  'beta.ios.costLabel': { de: 'Kosten', en: 'Cost' },
  'beta.ios.costValue': { de: 'Kostenlos, Level 1–2 bleiben gratis', en: 'Free, levels 1–2 stay free' },
  'beta.ios.oneTitle': { de: 'TestFlight installieren', en: 'Install TestFlight' },
  'beta.ios.oneText': {
    de: 'TestFlight ist Apples App für Beta-Versionen. Lade sie kostenlos aus dem App Store – ohne sie lässt sich die Beta nicht installieren.',
    en: "TestFlight is Apple's app for beta versions. Download it free from the App Store – without it you cannot install the beta.",
  },
  'beta.ios.oneLink': { de: 'TestFlight im App Store öffnen', en: 'Open TestFlight on the App Store' },
  'beta.ios.twoTitle': { de: 'Einladung annehmen', en: 'Accept the invitation' },
  'beta.ios.twoText': {
    de: 'Öffne den Einladungslink auf demselben Gerät. TestFlight zeigt Arithmo Slayer mit einem Annehmen-Knopf – ein Tipp genügt.',
    en: 'Open the invitation link on the same device. TestFlight shows Arithmo Slayer with an Accept button – one tap is enough.',
  },
  'beta.ios.twoLink': { de: 'Einladung öffnen', en: 'Open the invitation' },
  'beta.ios.threeTitle': { de: 'Installieren und losspielen', en: 'Install and play' },
  'beta.ios.threeText': {
    de: 'Tippe in TestFlight auf Installieren, starte die App und lege ein lokales Profil an. Level 1–2 spielst du sofort gratis.',
    en: 'Tap Install in TestFlight, start the app and create a local profile. Levels 1–2 are free right away.',
  },
  'beta.ios.threeMeta': { de: 'Spielbar offline · kein Login', en: 'Plays offline · no login' },
  'beta.ios.fourTitle': { de: 'Rückmeldung geben', en: 'Send feedback' },
  'beta.ios.fourText': {
    de: 'Was hakt, was fehlt, was ist unklar? Schreib uns – jede Meldung aus der Beta landet direkt bei uns.',
    en: 'Something broken, missing or unclear? Write to us – every beta report lands directly with us.',
  },
  'beta.ios.fourLink': { de: 'Mail schreiben', en: 'Write an email' },
  'beta.ios.note': {
    de: 'Der Link bleibt offen, solange die Beta läuft. TestFlight-Builds verfallen nach 90 Tagen – wir laden neue hoch, damit du durchspielen kannst.',
    en: 'The link stays open while the beta runs. TestFlight builds expire after 90 days – we upload new ones so you can play through.',
  },
  'beta.ios.unlockTitle': { de: 'Vollversion in der Beta', en: 'Full version in the beta' },
  'beta.ios.unlockText': {
    de: 'Auch die Vollversion kostet in der Beta nichts: Der Freischalten-Schritt bleibt Teil des Ablaufs, TestFlight berechnet aber keinen Betrag.',
    en: 'The full version costs nothing during the beta either: the unlock step stays part of the flow, but TestFlight never charges anything.',
  },
  'beta.ios.cta': { de: 'Einladung öffnen', en: 'Open the invitation' },

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
  'beta.faq.q1': { de: 'Was kostet die Beta?', en: 'What does the beta cost?' },
  'beta.faq.a1': {
    de: 'Nichts. Die Beta ist kostenlos, Level 1–2 bleiben auch danach gratis. Während der Beta ist auch die Vollversion kostenlos: auf iOS im TestFlight-Build, auf Android per Play-Promo-Code. Nach der Beta schaltest du Level 3–60 mit einem Einmalkauf frei.',
    en: 'Nothing. The beta is free, levels 1–2 stay free afterwards too. During the beta the full version is free as well: in the iOS TestFlight build, on Android via a Play promo code. After the beta you unlock levels 3–60 with a one-time purchase.',
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
    de: 'iOS 15 oder neuer – auf iPhone und iPad – plus die kostenlose TestFlight-App von Apple.',
    en: 'iOS 15 or newer – on iPhone and iPad – plus the free TestFlight app from Apple.',
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
    de: 'Die App selbst spielt ohne Konto, ohne Werbung und ohne Analyse-Tracking. TestFlight und der Play-Test-Track sind Dienste von Apple bzw. Google – was sie dabei erheben, steht in ihren Datenschutzhinweisen. Für die Android-Warteliste speichern wir nur die Adresse, die du einträgst.',
    en: "The app itself plays without an account, without ads and without analytics tracking. TestFlight and the Play test track are services run by Apple and Google – what they collect is described in their privacy notices. For the Android waitlist we store only the address you enter.",
  },
  'beta.faq.q7': { de: 'Was passiert nach der Beta?', en: 'What happens after the beta?' },
  'beta.faq.a7': {
    de: 'Dann erscheint Arithmo Slayer im App Store und bei Google Play. TestFlight-Builds laufen nach 90 Tagen ab; die Store-Version installierst du danach regulär.',
    en: 'Then Arithmo Slayer arrives on the App Store and on Google Play. TestFlight builds expire after 90 days; you install the store version afterwards as usual.',
  },
  'beta.faq.q8': { de: 'Wo melde ich einen Fehler?', en: 'Where do I report a bug?' },
  'beta.faq.a8': {
    de: 'Schreib an info@derschweigert.de und nenne Gerät, Systemversion und was du gerade gemacht hast. Screenshots helfen.',
    en: 'Write to info@derschweigert.de and mention your device, system version and what you were doing. Screenshots help.',
  },

  // Footer
  'beta.footer.tagline': {
    de: 'Kopfrechnen für Jung und Alt – im Browser, die App für iOS und Android ist in Vorbereitung.',
    en: 'Mental math for young and old – in the browser; the app for iOS and Android is in preparation.',
  },
  'beta.footer.play': { de: 'Zum Spiel', en: 'To the game' },
  'beta.footer.legalTitle': { de: 'Rechtliches', en: 'Legal' },
  'beta.footer.legalImpressum': { de: 'Impressum', en: 'Imprint' },
  'beta.footer.legalPrivacy': { de: 'Datenschutz', en: 'Privacy' },
  'beta.footer.legalPrivacyApp': { de: 'App-Datenschutz', en: 'App privacy' },
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
