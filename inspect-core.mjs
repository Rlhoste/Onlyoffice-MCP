const TEXT_KEYS = /^(text|t|value|content)$/i;

export function normalizeJsonInput(value) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); }
  catch { return value; }
}

export function finiteOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sanitizeJson(value, options = {}) {
  value = normalizeJsonInput(value);
  const maxDepth = options.maxDepth ?? 6;
  const maxArray = options.maxArray ?? 40;
  const maxKeys = options.maxKeys ?? 80;
  const maxString = options.maxString ?? 500;
  const seen = new WeakSet();

  function walk(item, depth) {
    if (item === null || typeof item === "boolean") return item;
    if (typeof item === "number") return Number.isFinite(item) ? item : null;
    if (typeof item === "string") return item.length > maxString ? `${item.slice(0, maxString)}…` : item;
    if (typeof item !== "object" || depth >= maxDepth) return null;
    if (seen.has(item)) return "[circular]";
    seen.add(item);
    if (Array.isArray(item)) return item.slice(0, maxArray).map(entry => walk(entry, depth + 1));
    const output = {};
    for (const key of Object.keys(item).slice(0, maxKeys)) output[key] = walk(item[key], depth + 1);
    return output;
  }

  return walk(value, 0);
}

export function extractText(value, maxLength = 500) {
  const parts = [];
  const seen = new WeakSet();
  function walk(item, key = "", depth = 0) {
    if (parts.join(" ").length >= maxLength || depth > 10) return;
    if (typeof item === "string" && TEXT_KEYS.test(key) && item.trim()) {
      parts.push(item.trim());
      return;
    }
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) {
      for (const entry of item) walk(entry, key, depth + 1);
    } else {
      for (const childKey of Object.keys(item)) walk(item[childKey], childKey, depth + 1);
    }
  }
  walk(value);
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text ? (text.length > maxLength ? `${text.slice(0, maxLength)}…` : text) : null;
}

export function previewJson(value, maxLength = 3000) {
  try {
    const text = JSON.stringify(sanitizeJson(value));
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
  } catch {
    return null;
  }
}

export function validateDrawingFingerprint(actual, expected) {
  const fields = ["x", "y", "width", "height"];
  const mismatches = [];
  for (const field of fields) {
    if (!Number.isFinite(expected[field])) {
      mismatches.push(`${field}: invalid expected value`);
    } else if (actual[field] !== expected[field]) {
      mismatches.push(`${field}: expected ${expected[field]}, got ${actual[field]}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
