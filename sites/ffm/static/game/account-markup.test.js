import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');

it('uses paginated title sections instead of a scrolling title screen', () => {
  const screen = css.match(/^\.splash-screen\s*\{([^}]*)\}/m)?.[1];
  const content = css.match(/^\.splash-content\s*\{([^}]*)\}/m)?.[1];
  assert.ok(screen);
  assert.ok(content);
  assert.match(screen, /justify-content:\s*flex-start;/);
  assert.match(screen, /overflow-y:\s*hidden;/);
  assert.match(content, /flex-shrink:\s*1;/);
  assert.match(content, /margin:\s*0 auto;/);
  for (const page of ['play', 'progress', 'family', 'history', 'legal']) {
    assert.ok(html.includes(`data-title-page="${page}"`), page);
  }
});

it('keeps the top bar behind and inactive until both account and auth panels close', () => {
  const helpers = ['setAccountModalVisible', 'setAuthModalVisible', 'updateTopBarModalState'].map(name => {
    const helper = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
    assert.ok(helper, `${name} must exist`);
    return helper;
  }).join('\n');
  const classes = new Set();
  const context = {
    accountModal: { style: { display: 'none' } },
    authModal: { style: { display: 'none' } },
    topBar: {
      inert: false,
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
    },
  };
  vm.runInNewContext(`${helpers}\nsetAccountModalVisible(true);`, context);
  assert.equal(context.accountModal.style.display, 'flex');
  assert.equal(context.topBar.inert, true);
  assert.ok(classes.has('behind-modal'));
  vm.runInNewContext('setAuthModalVisible(true); setAccountModalVisible(false);', context);
  assert.equal(context.authModal.style.display, 'flex');
  assert.equal(context.topBar.inert, true);
  assert.ok(classes.has('behind-modal'));
  vm.runInNewContext('setAccountModalVisible(true); setAuthModalVisible(false);', context);
  assert.equal(context.authModal.style.display, 'none');
  assert.equal(context.topBar.inert, true);
  vm.runInNewContext('setAccountModalVisible(false);', context);
  assert.equal(context.accountModal.style.display, 'none');
  assert.equal(context.topBar.inert, false);
  assert.equal(classes.has('behind-modal'), false);
  vm.runInNewContext('setAuthModalVisible(true);', context);
  assert.equal(context.topBar.inert, true);
  vm.runInNewContext('setAuthModalVisible(false);', context);
  assert.equal(context.topBar.inert, false);
  assert.equal(classes.has('behind-modal'), false);
  assert.equal(source.match(/accountModal\.style\.display\s*=/g)?.length, 1,
    'every opening and closing path must use the shared helper');
  assert.equal(source.match(/authModal\.style\.display\s*=/g)?.length, 1,
    'every auth opening and closing path must use the shared helper');
  assert.match(css, /#top-bar\.behind-modal\s*\{[^}]*z-index:\s*99;[^}]*pointer-events:\s*none;/);
  assert.match(css, /\.overlay\s*\{[^}]*z-index:\s*100;/);
});

it('lets translated account tabs wrap', () => {
  assert.match(css, /#account-tabs\s*\{[^}]*flex-wrap:\s*wrap;/);
  assert.match(css, /#account-tabs \.tab-btn\s*\{[^}]*flex:\s*1 1 110px;[^}]*min-width:\s*0;/);
});

it('bounds ordinary overlay cards to the usable viewport without scrolling', () => {
  const card = css.match(/^\.overlay-card\s*\{([^}]*)\}/m)?.[1];
  assert.ok(card, 'shared overlay card styles must exist');
  assert.match(card, /box-sizing:\s*border-box;/);
  assert.match(card, /width:\s*calc\(100% - 32px\);/);
  assert.match(card, /max-height:\s*100%;/);
  assert.match(card, /overflow-y:\s*hidden;/);
  assert.match(card, /overscroll-behavior:\s*contain;/);
  assert.match(card, /overflow-wrap:\s*anywhere;/);
  for (const name of ['auth-modal', 'account-modal', 'checkout-modal', 'auth-status-modal', 'level-clear', 'game-over']) {
    assert.match(html, new RegExp(`<div id="${name}"[^>]*>\\s*<div class="overlay-card">`), name);
  }
});

it('provides a separate panel for every account tab', () => {
  for (const name of ['profile', 'password', 'scores', 'billing', 'danger']) {
    assert.equal(
      html.match(new RegExp(`id="account-${name}-panel"`, 'g'))?.length,
      1,
      `missing or duplicate ${name} panel`,
    );
    assert.ok(html.includes(`id="tab-account-${name}"`));
  }
});

it('keeps account deletion inside its initially hidden panel', () => {
  assert.match(
    html,
    /<div id="account-danger-panel" style="display:none">\s*<form id="account-delete-form">[\s\S]*?<\/form>\s*<\/div>/,
  );
});

it('uses the scrollable layout and readable notices on billing legal pages', () => {
  const legalCss = fs.readFileSync(new URL('../legal.css', import.meta.url), 'utf8');
  assert.match(legalCss, /\.warning\s*\{[^}]*color:\s*#332701;/, 'legal.css');
  for (const name of ['cancel.html', 'terms.html', 'terms.en.html']) {
    const page = fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    assert.match(page, /<body class="legal-body">/, name);
  }
  const cancel = fs.readFileSync(new URL('../cancel.html', import.meta.url), 'utf8');
  assert.match(cancel, /\.warning\s*\{[^}]*color:\s*#332701;/, 'cancel.html');
});

it('restyles the web terms pages with the app legal stylesheet', () => {
  const legalCss = fs.readFileSync(new URL('../legal.css', import.meta.url), 'utf8');
  assert.match(legalCss, /--brass-light|--legal-brass-light/, 'brass headings');
  assert.match(legalCss, /min-height:\s*44px/, '44px footer targets');
  for (const name of ['terms.html', 'terms.en.html']) {
    const page = fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    const shared = page.indexOf('href="styles.css"');
    const legal = page.indexOf('href="legal.css"');
    assert.ok(shared >= 0, `${name} keeps the shared stylesheet`);
    assert.ok(legal > shared, `${name} loads legal.css after styles.css`);
    assert.match(page, /<div class="legal-page"><div class="legal-content">/, name);
    assert.match(page, /<p class="legal-footer-nav">/, name);
    assert.doesNotMatch(page, /<style>|<div class="container">/, name);
  }
});

it('makes cancellation navigation available from the title and cancellation page', () => {
  const splashLinks = html.match(/<p class="splash-legal-links">([\s\S]*?)<\/p>/)?.[1];
  assert.ok(splashLinks?.includes('href="cancel.html"'));
  const page = fs.readFileSync(new URL('../cancel.html', import.meta.url), 'utf8');
  assert.match(page, /<a class="cancel-button" href="\/\?account=billing">/);
});

it('pairs the checkout consent links in the same language as the English UI', () => {
  const checkoutForm = html.match(/<form id="checkout-form">([\s\S]*?)<\/form>/)?.[1];
  assert.match(checkoutForm, /href="\/terms\.en\.html"/, 'checkout terms link should point to the English terms');
  assert.match(checkoutForm, /href="\/datenschutz\.en\.html"/, 'checkout privacy link should point to the English privacy policy');
  assert.ok(!checkoutForm.includes('href="/terms.html"'), 'checkout should not mix in the German terms link');
});

it('does not overstate facts in the legal drafts (terms, privacy, cancellation)', () => {
  for (const name of ['terms.html', 'terms.en.html']) {
    const page = fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
    assert.ok(!/charge\.succeeded/.test(page), `${name} should not claim charge.succeeded is a processed webhook event`);
    assert.ok(!/charge\.failed/.test(page), `${name} should not claim charge.failed is a processed webhook event`);
    assert.ok(!/lebenslangen kostenlosen Zugang|lifetime free access/.test(page), `${name} should not promise lifetime free access`);
    assert.ok(!/verschlüsselt\)|password \(encrypted\)/.test(page), `${name} should describe passwords as hashed, not just "encrypted"`);
    assert.ok(/bcrypt/.test(page), `${name} should mention bcrypt password hashing`);
    assert.ok(!/lokal auf Ihrem Gerät|stored locally on your device/.test(page), `${name} should not claim scores are stored only on-device`);
    assert.match(page, /mailto:info@derschweigert\.de/, `${name} should provide a real contact address instead of a nonexistent in-account contact flow`);
  }
  const cancelPage = fs.readFileSync(new URL('../cancel.html', import.meta.url), 'utf8');
  assert.ok(!/Kalendermonaate|Kontoddaten|letzteZahlunge/.test(cancelPage), 'cancel.html should not contain known typos');
  assert.match(cancelPage, /Ihr Spielfortschritt und Ihre Kontodaten/, 'cancel.html should use correct German grammar for retained data');
});
