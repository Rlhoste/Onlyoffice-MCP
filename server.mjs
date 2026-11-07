#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { createSerialQueue } from "./serial-queue.mjs";

const HOST = "127.0.0.1";
const PORT = 2021;
const TOKEN_FILE = new URL("./bridge-token", import.meta.url);
const REQUEST_TIMEOUT_MS = 10_000;

function readToken() {
  const token = fs.readFileSync(TOKEN_FILE, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error("bridge-token must contain exactly 32 random bytes encoded as lowercase hexadecimal");
  }
  return token;
}

const token = readToken();
let plugin = null;
let connectedAt = null;
const pending = new Map();
const enqueueCommand = createSerialQueue();

function closePending(message) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  pending.clear();
}

const httpServer = http.createServer((req, res) => {
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

httpServer.on("upgrade", (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, `http://${HOST}:${PORT}`);
  } catch {
    socket.destroy();
    return;
  }
  const supplied = url.searchParams.get("token") || "";
  const valid = url.pathname === "/plugin" && supplied.length === token.length &&
    crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
  if (!valid) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
});

wss.on("connection", ws => {
  if (plugin && plugin.readyState === WebSocket.OPEN) plugin.close(1008, "replaced");
  plugin = ws;
  connectedAt = new Date().toISOString();
  console.error("ONLYOFFICE presentation plugin connected");

  ws.on("message", raw => {
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      return;
    }
    if (!message || typeof message.id !== "string") return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(String(message.error)));
    else request.resolve(message.result);
  });

  ws.on("close", () => {
    if (plugin === ws) {
      plugin = null;
      connectedAt = null;
      closePending("ONLYOFFICE plugin disconnected");
    }
  });
  ws.on("error", error => console.error(`Plugin WebSocket error: ${error.message}`));
});

function sendCommandRaw(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!plugin || plugin.readyState !== WebSocket.OPEN) {
      reject(new Error("ONLYOFFICE plugin is not connected. Open a presentation after installing the bridge."));
      return;
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout while waiting for ONLYOFFICE method ${method}`));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    plugin.send(JSON.stringify({ id, method, params }), error => {
      if (!error) return;
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    });
  });
}

function sendCommand(method, params = {}) {
  return enqueueCommand(() => sendCommandRaw(method, params));
}

function result(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function failure(error) {
  return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
}

const mcp = new McpServer({ name: "onlyoffice-presentation-bridge", version: "0.1.0" });

mcp.registerTool("connection_status", {
  description: "Check whether the local ONLYOFFICE Desktop presentation plugin is connected. Read-only.",
  inputSchema: {},
}, async () => result({
  connected: Boolean(plugin && plugin.readyState === WebSocket.OPEN),
  connectedAt,
  endpoint: `ws://${HOST}:${PORT}/plugin`,
  mode: "read-write-confirmed",
}));

mcp.registerTool("presentation_inspect", {
  description: "Inspect the presentation currently open in ONLYOFFICE Desktop. Returns only metadata and drawing counts. Read-only.",
  inputSchema: {},
}, async () => {
  try { return result(await sendCommand("presentation_inspect")); }
  catch (error) { return failure(error); }
});

mcp.registerTool("slide_inspect", {
  description: "Inspect one slide in the presentation currently open in ONLYOFFICE Desktop. Uses a zero-based slide index. Read-only.",
  inputSchema: { slideIndex: z.number().int().min(0).optional().describe("Zero-based slide index; omit for the current slide") },
}, async ({ slideIndex }) => {
  try { return result(await sendCommand("slide_inspect", { slideIndex })); }
  catch (error) { return failure(error); }
});

mcp.registerTool("add_textbox", {
  description: "Add one editable text box to a slide in the presentation currently open in ONLYOFFICE Desktop. Requires confirm=true.",
  inputSchema: {
    text: z.string().min(1).max(5000),
    slideIndex: z.number().int().min(0).optional().describe("Zero-based slide index; omit for the current slide"),
    xMm: z.number().min(0).max(500).default(20),
    yMm: z.number().min(0).max(500).default(20),
    widthMm: z.number().positive().max(500).default(120),
    heightMm: z.number().positive().max(500).default(20),
    fontSizePt: z.number().min(6).max(96).default(24),
    confirm: z.literal(true).describe("Must be true to authorize this visible mutation"),
  },
}, async params => {
  try { return result(await sendCommand("add_textbox", params)); }
  catch (error) { return failure(error); }
});

mcp.registerTool("replace_shape_text", {
  description: "Replace the text of one existing shape in the open ONLYOFFICE presentation. Uses zero-based slide and drawing indexes and requires confirm=true.",
  inputSchema: {
    slideIndex: z.number().int().min(0),
    drawingIndex: z.number().int().min(0),
    text: z.string().min(1).max(5000),
    confirm: z.literal(true).describe("Must be true to authorize this visible mutation"),
  },
}, async params => {
  try { return result(await sendCommand("replace_shape_text", params)); }
  catch (error) { return failure(error); }
});

mcp.registerTool("delete_slide", {
  description: "Delete one slide from the open ONLYOFFICE presentation by zero-based index. Requires confirm=true.",
  inputSchema: {
    slideIndex: z.number().int().min(0),
    confirm: z.literal(true).describe("Must be true to authorize deletion of the slide"),
  },
}, async params => {
  try { return result(await sendCommand("delete_slide", params)); }
  catch (error) { return failure(error); }
});

mcp.registerTool("delete_drawing", {
  description: "Delete one drawing from the open ONLYOFFICE presentation only when its exact inspected geometry still matches. Uses zero-based indexes and requires confirm=true.",
  inputSchema: {
    slideIndex: z.number().int().min(0),
    drawingIndex: z.number().int().min(0),
    expectedX: z.number().finite(),
    expectedY: z.number().finite(),
    expectedWidth: z.number().finite().positive(),
    expectedHeight: z.number().finite().positive(),
    confirm: z.literal(true).describe("Must be true to authorize deletion of this exact drawing"),
  },
}, async params => {
  try { return result(await sendCommand("delete_drawing", params)); }
  catch (error) { return failure(error); }
});

mcp.registerTool("undo", {
  description: "Safely roll back the most recent object added by this bridge to the presentation currently open in ONLYOFFICE Desktop. Requires confirm=true.",
  inputSchema: { confirm: z.literal(true).describe("Must be true to authorize rollback of the latest bridge edit") },
}, async params => {
  try { return result(await sendCommand("undo", params)); }
  catch (error) { return failure(error); }
});

async function main() {
  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(PORT, HOST, resolve);
  });
  console.error(`ONLYOFFICE loopback bridge listening on ${HOST}:${PORT}`);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

function shutdown() {
  closePending("Bridge shutting down");
  if (plugin) plugin.close(1001, "server shutdown");
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
