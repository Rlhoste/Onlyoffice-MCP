import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUID = "{7D8D56A4-C2B6-4A3D-9E25-9C67D88F5E31}";

test("installer creates matching private secrets without printing them", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "oo-bridge-install-"));
  const tokenFile = path.join(temporary, "nested", "bridge-token");
  const pluginRoot = path.join(temporary, "plugins");

  try {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "install.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        BRIDGE_TOKEN_FILE: tokenFile,
        ONLYOFFICE_PLUGIN_ROOT: pluginRoot,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    const pluginTokenFile = path.join(pluginRoot, GUID, "token.js");
    const pluginToken = fs.readFileSync(pluginTokenFile, "utf8");

    assert.match(token, /^[a-f0-9]{64}$/);
    assert.ok(pluginToken.includes(JSON.stringify(token)));
    assert.ok(!result.stdout.includes(token));
    assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(pluginTokenFile).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
