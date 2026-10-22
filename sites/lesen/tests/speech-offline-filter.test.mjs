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
