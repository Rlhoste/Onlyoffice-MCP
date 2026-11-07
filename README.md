# ONLYOFFICE Presentation MCP Bridge

**Let an AI assistant work directly inside the presentation you have open in
ONLYOFFICE.**

Most presentation agents generate a new `.pptx` file every time they make a
change. That workflow is slow, creates duplicate files, and can overwrite work
you have already refined by hand. ONLYOFFICE Presentation MCP Bridge takes a
different approach: it connects an MCP-compatible assistant to the presentation
currently open in ONLYOFFICE Desktop Editors.

The assistant can inspect the deck, understand its slide structure, and make
targeted changes to native presentation objects. You keep working in the same
editor and remain in control of every mutation.

The bridge runs entirely on your computer. It does not upload your presentation
to a separate document service, and it never gives the assistant an arbitrary
JavaScript execution endpoint.

> **Project status:** early preview. Live inspection and targeted editing work,
> but automatic saving and general undo are still limited by the ONLYOFFICE 9
> plugin API. Use a disposable copy for your first tests.

## Why use it?

- **Work on the open presentation** instead of generating another copy.
- **Preserve manual edits** by changing only the requested slide objects.
- **Keep slides editable** with native text boxes and presentation elements.
- **Inspect before changing** with slide and object metadata exposed through MCP.
- **Stay local** with a loopback-only, authenticated connection.
- **Keep control** because every mutating tool requires explicit confirmation.

## What can it do today?

- Inspect the open presentation and its slide structure.
- Inspect individual drawings with their geometry and limited semantic data.
- Add editable text boxes.
- Replace text inside an existing shape.
- Delete a slide.
- Delete an inspected drawing with an exact geometry safety check.
- Roll back the latest object added by the bridge.

It is designed for MCP clients such as OpenCode, but the server follows the
Model Context Protocol and can be connected to other compatible clients.

## Security model

- The WebSocket listens only on `127.0.0.1:2021`.
- A random 256-bit token authenticates the ONLYOFFICE plugin.
- The token is generated locally and is never part of the repository.
- The plugin exposes a fixed allowlist. It cannot execute arbitrary JavaScript.
- Mutating MCP tools require `confirm: true`.
- Commands are serialized and have a 10-second timeout.
- Drawing deletion additionally checks the object's exact inspected geometry.

The MCP client and every process running as the same operating-system user are
inside the trust boundary. See [SECURITY.md](SECURITY.md) for limitations.

## Requirements

- Linux desktop
- Node.js 20 or newer
- ONLYOFFICE Desktop Editors 9 (tested with 9.0.3)
- An MCP client such as OpenCode

## Installation

```bash
npm ci
npm test
npm run check
npm run install:plugin
```

Register the server in OpenCode:

```bash
opencode mcp add onlyoffice-presentation --global -- node "$PWD/server.mjs"
```

Restart ONLYOFFICE Desktop Editors after installing the plugin, then open a
presentation. The MCP server itself is started by the MCP client.

## Token rotation

If the token is exposed, rotate it and restart both the MCP server and
ONLYOFFICE Desktop Editors:

```bash
npm run rotate-token
```

Never commit `bridge-token` or `plugin/token.js`.

## Development

```bash
npm test
npm run check
npm audit --omit=dev
```

The test suite covers JSON sanitization, serialized command execution, drawing
fingerprint validation, and isolated plugin installation without secret
disclosure. Test presentation mutations on a disposable file before using them
on important documents.

## Current limitations

- The bridge acts on the presentation currently open in ONLYOFFICE. It does not
  yet bind mutations to an expected document path or fingerprint.
- Saving plugin-created changes is not fully reliable in ONLYOFFICE 9.0.3.
- `undo` only rolls back the latest object added by this bridge.
- Semantic text extraction from some presentation objects is incomplete.

## License

GNU General Public License v3.0 only. You may use, study, modify and
redistribute this project under the terms of the GPL. Distributed derivative
works must remain available under the same license. See [LICENSE](LICENSE).
