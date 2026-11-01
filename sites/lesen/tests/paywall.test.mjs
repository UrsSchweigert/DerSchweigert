import test from "node:test";
import assert from "node:assert";
import { t, DE, EN } from "../static/i18n.mjs";

test("paywall i18n: all paywall keys exist in both German and English", () => {
  const paywallKeys = [
    'dialog.paywall.title',
    'dialog.paywall.intro',
    'dialog.paywall.cta',
    'dialog.paywall.gate.question',
    'dialog.paywall.gate.error',
    'dialog.paywall.gate.success',
    'dialog.paywall.error',
    'dialog.paywall.unlock_button',
    'dialog.paywall.restore_button',
    'dialog.paywall.close',
  ];

  for (const key of paywallKeys) {
    const deTrans = t("de", key);
    const enTrans = t("en", key);
    assert.ok(!(deTrans === key), `${key} should have a German translation`);
    assert.ok(!(enTrans === key), `${key} should have an English translation`);
    assert.ok(deTrans.length > 0, `${key} German translation should not be empty`);
    assert.ok(enTrans.length > 0, `${key} English translation should not be empty`);
  }
});

test("paywall i18n: gate.question has placeholder substitution pattern", () => {
  const deQuestion = t("de", "dialog.paywall.gate.question");
  const enQuestion = t("en", "dialog.paywall.gate.question");
  
  // Both should contain {a} and {b} placeholders for substitution
  assert.ok(deQuestion.includes('{a}'), "German gate question should have {a} placeholder");
  assert.ok(deQuestion.includes('{b}'), "German gate question should have {b} placeholder");
  assert.ok(enQuestion.includes('{a}'), "English gate question should have {a} placeholder");
  assert.ok(enQuestion.includes('{b}'), "English gate question should have {b} placeholder");
});

test("paywall i18n: no key collision between paywall and existing keys", () => {
  const paywallKeys = Object.keys(DE).filter(k => k.startsWith('dialog.paywall'));
  const aboutKeys = Object.keys(DE).filter(k => k.startsWith('dialog.about'));
  const confirmKeys = Object.keys(DE).filter(k => k.startsWith('dialog.confirm'));
  
  const allDialogKeys = [...paywallKeys, ...aboutKeys, ...confirmKeys];
  const uniqueKeys = new Set(allDialogKeys);
  
  assert.strictEqual(
    allDialogKeys.length,
    uniqueKeys.size,
    "No key should appear in multiple dialog sections"
  );
});

test("paywall i18n: all paywall keys in DE exist in EN", () => {
  const dePaywallKeys = Object.keys(DE).filter(k => k.startsWith('dialog.paywall'));
  
  for (const key of dePaywallKeys) {
    assert.ok(key in EN, `${key} exists in EN dictionary`);
  }
});

test("paywall i18n: all paywall keys in EN exist in DE", () => {
  const enPaywallKeys = Object.keys(EN).filter(k => k.startsWith('dialog.paywall'));
  
  for (const key of enPaywallKeys) {
    assert.ok(key in DE, `${key} exists in DE dictionary`);
  }
});

test("paywall i18n: button text is appropriate and concise", () => {
  const unlockDe = t("de", "dialog.paywall.unlock_button");
  const restoreDe = t("de", "dialog.paywall.restore_button");
  const closeDe = t("de", "dialog.paywall.close");
  
  const unlockEn = t("en", "dialog.paywall.unlock_button");
  const restoreEn = t("en", "dialog.paywall.restore_button");
  const closeEn = t("en", "dialog.paywall.close");
  
  // All buttons should be short and clear
  assert.ok(unlockDe.length < 30, "German unlock button text should be concise");
  assert.ok(restoreDe.length < 30, "German restore button text should be concise");
  assert.ok(closeDe.length < 30, "German close button text should be concise");
  
  assert.ok(unlockEn.length < 30, "English unlock button text should be concise");
  assert.ok(restoreEn.length < 30, "English restore button text should be concise");
  assert.ok(closeEn.length < 30, "English close button text should be concise");
});

test("paywall i18n: error and success messages are clear", () => {
  const errorDe = t("de", "dialog.paywall.gate.error");
  const successDe = t("de", "dialog.paywall.gate.success");
  
  const errorEn = t("en", "dialog.paywall.gate.error");
  const successEn = t("en", "dialog.paywall.gate.success");
  
  // Messages should be present and not empty
  assert.ok(errorDe.length > 0, "German error message should not be empty");
  assert.ok(successDe.length > 0, "German success message should not be empty");
  assert.ok(errorEn.length > 0, "English error message should not be empty");
  assert.ok(successEn.length > 0, "English success message should not be empty");
  
  // Error message should not be pushy or use ALL CAPS
  assert.ok(!errorDe.includes('MUST'), "Error should not use ALL CAPS");
  assert.ok(!errorEn.includes('MUST'), "Error should not use ALL CAPS");
});

test("paywall: website build never shows paywall dialog (adapter kind is 'web')", async () => {
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const path = await import("node:path");

  const htmlPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../static/index.html",
  );
  const html = await readFile(htmlPath, "utf8");

  // Assert that showPaywallDialog() function exists
  assert.ok(html.includes("function showPaywallDialog()"), "showPaywallDialog function should exist");
  
  // Check that the guard checks for kind !== 'native' early in the function
  const guardExists = html.includes("window.__entitlement.kind !== 'native'");
  assert.ok(guardExists, "showPaywallDialog should check window.__entitlement.kind !== 'native'");
  
  // Find the showPaywallDialog function and verify structure
  const funcStart = html.indexOf("function showPaywallDialog()");
  // Look for the next closing brace that matches
  let braceCount = 0;
  let endPos = funcStart;
  for (let i = html.indexOf("{", funcStart); i < html.length; i++) {
    if (html[i] === "{") braceCount++;
    else if (html[i] === "}") {
      braceCount--;
      if (braceCount === 0) {
        endPos = i + 1;
        break;
      }
    }
  }
  
  const funcBody = html.substring(funcStart, endPos);
  
  // Verify the guard and showModal are in the function
  assert.ok(funcBody.includes("window.__entitlement.kind !== 'native'"), 
    "kind check should appear in showPaywallDialog");
  assert.ok(funcBody.includes("showModal()"), 
    "showPaywallDialog should call showModal()");
  
  // Verify guard appears before showModal call
  const guardPos = funcBody.indexOf("window.__entitlement.kind");
  const showModalPos = funcBody.indexOf("showModal()");
  assert.ok(guardPos > -1 && showModalPos > -1 && guardPos < showModalPos, 
    "kind check should appear before showModal() call");

  // Check that cap-rejection branch calls showPaywallDialog()
  assert.ok(html.includes("if (!added)") && html.includes("showPaywallDialog()"), 
    "cap-rejection branch should call showPaywallDialog()");
});




