import test from "node:test";
import assert from "node:assert";
import { selectOfflineVoices, hasOfflineVoice } from "../static/speech-offline-filter.mjs";

test("selectOfflineVoices: suitable offline de-DE voice is selected", () => {
  const voices = [
    {
      name: "German Voice",
      locale: "de-DE",
      networkRequired: false,
      notInstalled: false,
    },
  ];
  const result = selectOfflineVoices(voices, "de-DE");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, "German Voice");
});

test("selectOfflineVoices: network-required voice is excluded", () => {
  const voices = [
    {
      name: "Online German Voice",
      locale: "de-DE",
      networkRequired: true,
      notInstalled: false,
    },
  ];
  const result = selectOfflineVoices(voices, "de-DE");
  assert.strictEqual(result.length, 0);
});

test("selectOfflineVoices: not-installed voice is excluded", () => {
  const voices = [
    {
      name: "Missing German Voice",
      locale: "de-DE",
      networkRequired: false,
      notInstalled: true,
    },
  ];
  const result = selectOfflineVoices(voices, "de-DE");
  assert.strictEqual(result.length, 0);
});

test("selectOfflineVoices: non-German voice is excluded", () => {
  const voices = [
    {
      name: "English Voice",
      locale: "en-US",
      networkRequired: false,
      notInstalled: false,
    },
  ];
  const result = selectOfflineVoices(voices, "de-DE");
  assert.strictEqual(result.length, 0);
});

test("selectOfflineVoices: locale with underscore de_DE matches de language", () => {
  const voices = [
    {
      name: "German Voice",
      locale: "de_DE",
      networkRequired: false,
      notInstalled: false,
    },
  ];
  const result = selectOfflineVoices(voices, "de-DE");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, "German Voice");
});

test("selectOfflineVoices: exact de-DE voice is listed before de-AT when both are offline", () => {
  const voices = [
    {
      name: "Austrian Voice",
      locale: "de-AT",
      networkRequired: false,
      notInstalled: false,
    },
    {
      name: "German Voice",
      locale: "de-DE",
      networkRequired: false,
      notInstalled: false,
    },
  ];
  const result = selectOfflineVoices(voices, "de-DE");
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].name, "German Voice");
  assert.strictEqual(result[1].name, "Austrian Voice");
});

test("selectOfflineVoices: exact de-DE voice is listed first regardless of underscore/case", () => {
  const voices = [
    {
      name: "Swiss Voice",
      locale: "de-CH",
      networkRequired: false,
      notInstalled: false,
    },
    {
      name: "German Voice",
      locale: "DE_de",
      networkRequired: false,
      notInstalled: false,
    },
  ];
  const result = selectOfflineVoices(voices, "de");
  assert.strictEqual(result[0].name, "German Voice");
});

test("selectOfflineVoices: single offline voice keeps its position and is returned", () => {
  const voices = [
    {
      name: "Austrian Voice",
      locale: "de-AT",
      networkRequired: false,
      notInstalled: false,
    },
  ];
  const result = selectOfflineVoices(voices, "de-DE");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, "Austrian Voice");
});

test("selectOfflineVoices: never falls back to a network voice", () => {
  const voices = [
    {
      name: "Online German Voice",
      locale: "de-DE",
      networkRequired: true,
      notInstalled: false,
    },
    {
      name: "Offline Austrian Voice",
      locale: "de-AT",
      networkRequired: false,
      notInstalled: false,
    },
  ];
  const result = selectOfflineVoices(voices, "de-DE");
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].name, "Offline Austrian Voice");
});

test("hasOfflineVoice: returns true when offline voice exists", () => {
  const voices = [
    {
      name: "German Voice",
      locale: "de-DE",
      networkRequired: false,
      notInstalled: false,
    },
  ];
  const result = hasOfflineVoice(voices, "de-DE");
  assert.strictEqual(result, true);
});

test("hasOfflineVoice: returns false when no offline voice exists", () => {
  const voices = [
    {
      name: "Online German Voice",
      locale: "de-DE",
      networkRequired: true,
      notInstalled: false,
    },
  ];
  const result = hasOfflineVoice(voices, "de-DE");
  assert.strictEqual(result, false);
});
