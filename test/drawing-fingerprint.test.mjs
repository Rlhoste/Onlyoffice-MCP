import test from "node:test";
import assert from "node:assert/strict";
import { validateDrawingFingerprint } from "../inspect-core.mjs";

test("accepts an exact drawing geometry fingerprint", () => {
  assert.deepEqual(
    validateDrawingFingerprint(
      { x: 10, y: 20, width: 30, height: 40 },
      { x: 10, y: 20, width: 30, height: 40 },
    ),
    { ok: true, mismatches: [] },
  );
});

test("rejects a shifted or malformed drawing fingerprint", () => {
  const result = validateDrawingFingerprint(
    { x: 11, y: 20, width: 30, height: 40 },
    { x: 10, y: 20, width: Number.NaN, height: 40 },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    "x: expected 10, got 11",
    "width: invalid expected value",
  ]);
});
