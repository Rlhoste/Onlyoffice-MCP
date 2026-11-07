import test from "node:test";
import assert from "node:assert/strict";
import { finiteOrNull, normalizeJsonInput, sanitizeJson, extractText, previewJson } from "../inspect-core.mjs";

test("finiteOrNull rejects unsupported numeric values", () => {
  assert.equal(finiteOrNull(12.5), 12.5);
  assert.equal(finiteOrNull(Infinity), null);
  assert.equal(finiteOrNull("12"), null);
});

test("normalizeJsonInput decodes ONLYOFFICE ToJSON strings", () => {
  assert.deepEqual(normalizeJsonInput('{"x":12,"text":"Titre"}'), { x: 12, text: "Titre" });
  assert.equal(normalizeJsonInput("not-json"), "not-json");
});

test("sanitizeJson limits strings, arrays and circular references", () => {
  const source = { text: "abcdef", values: [1, 2, 3] };
  source.self = source;
  assert.deepEqual(sanitizeJson(source, { maxString: 3, maxArray: 2 }), {
    text: "abc…",
    values: [1, 2],
    self: "[circular]",
  });
});

test("extractText finds nested OOXML-like text fields and truncates", () => {
  const source = { body: { paragraphs: [{ runs: [{ t: "Bonjour" }, { text: "monde" }] }] } };
  assert.equal(extractText(source), "Bonjour monde");
  assert.equal(extractText({ text: "abcdefgh" }, 4), "abcd…");
});

test("previewJson never exposes functions and remains bounded", () => {
  const preview = previewJson({ text: "x".repeat(100), fn() {} }, 40);
  assert.ok(preview.length <= 41);
  assert.doesNotMatch(preview, /fn\(\)/);
});
