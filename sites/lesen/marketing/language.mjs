const englishText = {
  skipLink: 'Skip to content',
  navLabel: 'Main navigation',
  navHow: 'How it works',
  navAdults: 'For parents',
  navApps: 'Explore the apps',
  heroEyebrow: 'Small steps. Big reading moments.',
  heroTitleLead: 'Learning to read —',
  heroTitleHighlight: 'one card at a time.',
  heroDescription: 'Buchstabenzeit turns reading practice into a shared moment of success. An adult guides the activity while the child reads at their own pace — and every little step counts.',
  heroButton: 'Apps for iOS & Android',
  heroNoteLabel: 'Good to know',
  heroNoAds: 'No ads',
  heroNoAccount: 'No account',
  heroLanguages: 'German & English',
  mascotAlt: 'The Buchstabenzeit owl reads a book, surrounded by colourful alphabet blocks.',
  appShotAlt: 'Screenshot of the Buchstabenzeit app: choosing the letters for the next reading practice.',
  trustLabel: 'At a glance',
  trustReading: 'Practise letters, syllables, words & sentences',
  trustTogether: 'Made for reading together with an adult',
  trustPace: 'At the child’s own pace, without pressure',
  featuresEyebrow: 'Practice that grows with your child',
  featuresTitle: 'Start simply. Keep learning together.',
  featuresIntro: 'From the first sounds to complete sentences: choose the right reading cards together and celebrate every little “I got it!” moment.',
  featureLettersTitle: 'Choose your letters',
  featureLettersText: 'Choose consonants, vowels and special letter groups together, to match what your child is learning.',
  featureSyllablesTitle: 'Discover syllables',
  featureSyllablesText: 'Short patterns such as “ma” and “am” help children see how letters come together.',
  featureWordsTitle: 'Read words & sentences',
  featureWordsText: 'Familiar words and short sentences help children put what they have learned into context.',
  featureRetryTitle: 'Try again, without pressure',
  featureRetryText: 'Cards that are still tricky come back later, giving each child the time they need.',
  featureSpeechTitle: 'Optional read-aloud support',
  featureSpeechText: 'A suitable voice already installed on the device can read words and sentences aloud. If one is not available, practice continues without audio.',
  featureProgressTitle: 'Keep track of progress',
  featureProgressText: 'The apps keep practice progress on the device. Save a parent report as a CSV file or share it using the device.',
  howEyebrow: 'How it works',
  howTitle: 'Three little steps to reading practice.',
  sampleCardAlt: 'Reading card from the app with two letters, a read-aloud button and the buttons “Practise again” and “Read correctly”',
  sampleNote: 'Original screenshot from the app',
  sampleCardLabel: 'Your reading card',
  stepChooseTitle: 'An adult chooses the cards',
  stepChooseText: 'Choose letters and a practice mode: syllable patterns, words, sentences, or familiar cards to review.',
  stepPracticeTitle: 'Read together, one card at a time',
  stepPracticeText: 'The child reads while an adult guides them and marks what went well and what to practise again.',
  stepCelebrateTitle: 'Every small success matters',
  stepCelebrateText: 'Short rounds, encouraging feedback and a clear overview help make practice something to look forward to.',
  parentsEyebrow: 'Peace of mind for parents',
  parentsTitle: 'Encourage, don’t judge.',
  parentsIntro: 'Buchstabenzeit is a guided reading activity — not a replacement for teaching or time spent reading together. You choose the cards, pace and breaks.',
  parentPrivacy: 'No account, advertising or analytics in the apps.',
  parentOffline: 'After installation, the reading exercises work offline.',
  parentProgress: 'Practice progress and the parent report stay on the device unless you choose to share them.',
  parentSpeech: 'Read-aloud is optional and depends on a suitable voice installed on the device.',
  parentReminders: 'Optional practice reminders are off by default and protected for adult use.',
  storesEyebrow: 'Take reading practice along',
  storesTitle: 'Buchstabenzeit is coming to Android & iPhone.',
  storesIntro: 'The apps are not available in the stores yet – they are planned for Google Play and the Apple App Store. We will add prices and direct store links at launch.',
  playDescription: 'The Android app brings reading cards and on-device practice progress to your phone or tablet.',
  appStoreDescription: 'The iPhone and iPad app offers the same guided reading practice, with no subscription or account.',
  storeComing: 'Store link coming soon',
  projectReference: 'See Buchstabenzeit on DerSchweigert',
  closingTitle: 'Growing together, one card at a time.',
  closingText: 'Buchstabenzeit is coming to Android and iPhone. We will send a short note as soon as it starts.',
  closingButton: 'Get notified at launch',
  footerTagline: 'A little reading progress, every day.',
  footerLabel: 'Legal information and contact',
  footerPrivacy: 'Privacy policy',
  footerTerms: 'Terms of use',
  footerImprint: 'Imprint',
  footerContact: 'Contact',
  mobileCtaNote: 'Coming to the stores',
  mobileCta: 'See the apps',
};

if (new URLSearchParams(window.location.search).get('lang') === 'en') {
  document.documentElement.lang = 'en';
  document.title = 'Buchstabenzeit — Learn to read together';

  const description = document.querySelector('meta[name="description"]');
  description.content = 'Buchstabenzeit helps children practise letters, syllables, words and sentences together with an adult — one small step at a time.';
  document.querySelector('meta[property="og:locale"]').content = 'en_US';
  document.querySelector('meta[property="og:title"]').content = document.title;
  document.querySelector('meta[property="og:description"]').content = description.content;

  for (const element of document.querySelectorAll('[data-i18n]')) {
    const key = element.dataset.i18n;
    if (!(key in englishText)) throw new Error(`Missing English marketing translation: ${key}`);
    element.textContent = englishText[key];
  }

  for (const element of document.querySelectorAll('[data-i18n-aria]')) {
    const key = element.dataset.i18nAria;
    if (!(key in englishText)) throw new Error(`Missing English marketing aria translation: ${key}`);
    element.setAttribute('aria-label', englishText[key]);
  }

  for (const element of document.querySelectorAll('[data-i18n-alt]')) {
    const key = element.dataset.i18nAlt;
    if (!(key in englishText)) throw new Error(`Missing English marketing alt translation: ${key}`);
    element.alt = englishText[key];
  }

  const skipLink = document.querySelector('.skip-link');
  skipLink.textContent = englishText.skipLink;

  const languageToggle = document.querySelector('#language-toggle');
  languageToggle.href = '/';
  languageToggle.lang = 'de';
  languageToggle.textContent = 'DE';
  languageToggle.setAttribute('aria-label', 'Diese Seite auf Deutsch anzeigen');

  document.querySelector('[data-i18n="footerPrivacy"]').href = 'https://lesen.derschweigert.de/datenschutz-en.html';
}
