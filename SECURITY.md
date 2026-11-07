# Security policy

## Intended use

This bridge is designed for a single-user workstation. It is not a network
service and must not be exposed through a reverse proxy, port forwarding,
container port publication or a non-loopback bind address.

## Trust boundary

The following components are trusted:

- the local operating-system user;
- the configured MCP client;
- ONLYOFFICE Desktop Editors and the installed bridge plugin;
- the npm dependencies locked by `package-lock.json`.

A process running as the same user can read user-owned files and is therefore
outside the protection this bridge can provide. File permissions prevent other
local users from reading the token, but not processes owned by the same user.

## Secrets

`bridge-token` and the installed `token.js` are generated locally with 32
cryptographically random bytes and stored with mode `0600`. They must never be
committed, logged, pasted into an issue, or included in a release archive.

Rotate an exposed token with:

```bash
npm run rotate-token
```

Then restart the MCP server and ONLYOFFICE Desktop Editors.

## Mutation safety

All mutating tools require explicit `confirm: true`. This is an authorization
guard, not a substitute for reviewing the requested change. The bridge edits
the presentation currently open in ONLYOFFICE, so verify the active document
before invoking a mutation.

`delete_drawing` also requires the position and dimensions returned by a recent
inspection. It refuses deletion if the object changed.

## Reporting a vulnerability

Do not open a public issue containing tokens, documents, local paths or other
sensitive information. Revoke exposed credentials first, then report only a
minimal reproduction with secrets removed.
