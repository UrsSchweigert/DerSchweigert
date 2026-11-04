import { it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { isStripeRedirect } from './access-flow.js';
import { t, translateServerMessage, setLocale } from './i18n.js';

setLocale('en');

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const registration = source.match(/btnOpenPortal\.addEventListener\('click', async \(\) => \{[\s\S]*?\n\}\);/)?.[0];

for (const outcome of ['success', 'failure', 'invalid-url']) {
  it(`shows portal loading feedback and restores the button after ${outcome}`, async () => {
    assert.ok(registration, 'portal click handler must exist');
    let handler;
    let resolve;
    let reject;
    let calls = 0;
    const attributes = new Map();
    const button = {
      disabled: false,
      textContent: 'Manage Subscription',
      addEventListener(event, callback) {
        assert.equal(event, 'click');
        handler = callback;
      },
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); },
    };
    const pending = new Promise((res, rej) => { resolve = res; reject = rej; });
    const context = {
      btnOpenPortal: button,
      platform: {
        openBillingPortal() { calls++; return pending; },
        isStripeRedirect,
      },
      window: { location: { href: 'http://localhost/' } },
      billingStatusText: { textContent: '' },
      t,
      translateServerMessage,
    };
    vm.runInNewContext(registration, context);
    const first = handler();
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, t('billing.openingPortal'));
    assert.equal(attributes.get('aria-busy'), 'true');
    await handler();
    assert.equal(calls, 1);

    if (outcome === 'failure') reject(new Error('Portal unavailable'));
    else resolve({ url: outcome === 'success' ? 'https://billing.stripe.com/session/test' : 'https://example.com/' });
    await first;
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Manage Subscription');
    assert.equal(attributes.has('aria-busy'), false);
    if (outcome === 'success') {
      assert.equal(context.window.location.href, 'https://billing.stripe.com/session/test');
    } else {
      assert.equal(context.window.location.href, 'http://localhost/');
      assert.equal(context.billingStatusText.textContent,
        outcome === 'failure' ? 'Portal unavailable' : t('billing.invalidPortalUrl'));
    }
  });
}
