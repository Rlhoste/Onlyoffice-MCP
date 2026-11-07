#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUID = "{7D8D56A4-C2B6-4A3D-9E25-9C67D88F5E31}";
const SOURCE_PLUGIN = path.join(ROOT, "plugin");
const TOKEN_FILE = process.env.BRIDGE_TOKEN_FILE || path.join(ROOT, "bridge-token");
const PLUGIN_ROOT = process.env.ONLYOFFICE_PLUGIN_ROOT ||
  path.join(os.homedir(), ".local", "share", "onlyoffice", "desktopeditors", "sdkjs-plugins");
const PLUGIN_DEST = path.join(PLUGIN_ROOT, GUID);
const ROTATE = process.argv.includes("--rotate-token");
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function writePrivate(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}

function getToken() {
  if (!ROTATE && fs.existsSync(TOKEN_FILE)) {
    const existing = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (!TOKEN_PATTERN.test(existing)) {
      throw new Error("Existing bridge-token is invalid; use --rotate-token to replace it");
    }
    fs.chmodSync(TOKEN_FILE, 0o600);
    return existing;
  }
  const generated = crypto.randomBytes(32).toString("hex");
  writePrivate(TOKEN_FILE, `${generated}\n`);
  return generated;
}

function install() {
  const token = getToken();
  fs.mkdirSync(PLUGIN_DEST, { recursive: true, mode: 0o700 });
  for (const file of ["config.json", "index.html", "code.js"]) {
    fs.copyFileSync(path.join(SOURCE_PLUGIN, file), path.join(PLUGIN_DEST, file));
  }
  writePrivate(
    path.join(PLUGIN_DEST, "token.js"),
    `window.ONLYOFFICE_BRIDGE_TOKEN = ${JSON.stringify(token)};\n`,
  );
  console.log(`ONLYOFFICE plugin installed in ${PLUGIN_DEST}`);
  console.log(`Private token stored in ${TOKEN_FILE}`);
  console.log("The token value was not printed. Restart ONLYOFFICE Desktop Editors to reload the plugin.");
}

install();
