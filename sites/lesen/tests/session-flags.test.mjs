import test from "node:test";
import assert from "node:assert";
import {
  shouldShowTtsDisclaimer,
  markTtsDisclaimerShown,
  consumeTtsDisclaimerFlag,
} from "../static/session-flags.mjs";

/** Minimal in-memory stand-in for sessionStorage. */
function createFakeStore() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  };
}

test("shouldShowTtsDisclaimer: true on a fresh store", () => {
  const store = createFakeStore();
  assert.strictEqual(shouldShowTtsDisclaimer(store), true);
});

test("shouldShowTtsDisclaimer: false after markTtsDisclaimerShown", () => {
  const store = createFakeStore();
  markTtsDisclaimerShown(store);
  assert.strictEqual(shouldShowTtsDisclaimer(store), false);
});

test("markTtsDisclaimerShown: does not affect an unrelated store instance", () => {
  const storeA = createFakeStore();
  const storeB = createFakeStore();
  markTtsDisclaimerShown(storeA);
  assert.strictEqual(shouldShowTtsDisclaimer(storeA), false);
  assert.strictEqual(shouldShowTtsDisclaimer(storeB), true);
});

test("consumeTtsDisclaimerFlag: returns true once, then false for the rest of the session", () => {
  const store = createFakeStore();
  assert.strictEqual(consumeTtsDisclaimerFlag(store), true);
  assert.strictEqual(consumeTtsDisclaimerFlag(store), false);
  assert.strictEqual(consumeTtsDisclaimerFlag(store), false);
  assert.strictEqual(shouldShowTtsDisclaimer(store), false);
});

test("shouldShowTtsDisclaimer: defaults to true when store is missing", () => {
  assert.strictEqual(shouldShowTtsDisclaimer(null), true);
  assert.strictEqual(shouldShowTtsDisclaimer(undefined), true);
});

test("markTtsDisclaimerShown: does not throw when store is missing", () => {
  assert.doesNotThrow(() => markTtsDisclaimerShown(null));
  assert.doesNotThrow(() => markTtsDisclaimerShown(undefined));
});

test("consumeTtsDisclaimerFlag: tolerates a store whose methods throw", () => {
  const throwingStore = {
    getItem() {
      throw new Error("storage disabled");
    },
    setItem() {
      throw new Error("storage disabled");
    },
  };
  assert.strictEqual(consumeTtsDisclaimerFlag(throwingStore), true);
  // With storage unavailable it is safe (and expected) to show it again.
  assert.strictEqual(consumeTtsDisclaimerFlag(throwingStore), true);
});
