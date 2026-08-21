# Changelog

## 0.2.1 - 2026-08-21

- Takes `rmcommunication-ts` 0.2.2 and `rmindex-ts` 0.1.1. Together they fix two things the first live
  run of the mirror found: `mirror index` failed on every page of a long scrolled note with
  `Input image exceeds pixel limit`, and it counted trashed documents, so it reported more of them than
  `mirror status` and `device status` did.

## 0.2.0 - 2026-08-21

- Adds the `mirror` command group: `sync` and `watch` keep a local copy of the tablet without
  interrupting it, `index` builds the catalog and renders changed pages, `search` finds documents by
  name, folder path and typed text, `page` copies a rendered page out, and `status` reports what the
  mirror holds.
- Adds `mcp serve`, a read-only MCP server over the local mirror with six tools and no sync, write or
  delete tool. It opens no device connection and needs no credentials.
- Runs mirror and MCP commands with no `RMCLI_HOST` or `RMCLI_FINGERPRINT` set: host settings are
  resolved on demand and a local command takes no device lock. A long-lived command takes the lock per
  iteration instead of holding it for its whole run.
- Drops the `esbuild` install-script approval: nothing needs it.

## 0.1.1 - 2026-08-20

- Consumes the published libraries instead of local `file:` links.
- Documents that the package is `remarkable-cli` on npm while the installed command stays `rmcli`, and
  links the three packages of the family to each other.
- Records the approved `esbuild` install script, which npm 12 otherwise skips.

## 0.1.0 - 2026-08-20

- Adds a command line over `rmscene-ts` and `rmcommunication-ts` that holds no domain logic of its own:
  each command parses arguments, calls one library function, and prints the result.
- Separates commands that leave Xochitl running from commands that run inside a guarded offline
  session; the latter refuse to run without an explicit `--service` flag.
- Adds live document listing, single-document lookup, verified rmdoc download, PDF and EPUB upload with
  optional `--folder`, page listing, and page rendering to SVG or PNG from the downloaded archive.
- Adds `documents current`, which reports the document and page the tablet has open right now, and
  accepts `current` as the document or page argument of `pages list` and `pages render`.
- Numbers pages from one, the way the tablet does, and keeps the raw file position visible as a separate
  `index` so a deleted page cannot silently shift either number.
- Adds `--archive` to `pages list` and `pages render` so more pages of the same document can be worked on
  without downloading it again, and `--raw` to opt into the per-page CRDT entry that used to be printed
  unconditionally.
- Reports the SVG and the PNG dimensions separately in `pages render --json`; the two were previously
  conflated into one pair that described neither the file on disk nor the requested `--width`.
- Rejects `--width` for SVG output instead of ignoring it, and prints ISO timestamps beside the raw
  epoch milliseconds.
- Adds service access to storage listing, raw page read, transactional page write, document snapshot,
  and mirror generations.
- Reads the SSH password from `RMCLI_PASSWORD`, or from the stdout of `RMCLI_PASSWORD_COMMAND`, through a provider function, so it is
  never a process argument and never appears in output or errors.
- Adds `device fingerprint`, the one command that runs before a host key is pinned. It refuses every
  offered key and reports the fingerprint so an operator can check it and pin it deliberately.
- Ships `SKILL.md`, the agent-facing guide to setup, command choice, and the operations to avoid.
- Writes stable JSON to stdout under `--json`, human errors to stderr, and binary output only to the
  file named by `--output`.
- Takes a per-host lock for the whole invocation, because upload targets the most recently listed
  container and that selection is global tablet state.
- Excludes document deletion: the tablet's Web Interface has no delete endpoint.
- Blocks publishing while the sibling libraries are still local `file:` dependencies.
- Takes over a device lock whose holder is gone. The lock file records the holder PID, and a run that
  was killed no longer blocks every later run until someone deletes the file by hand. A live holder is
  reported with its PID.
- Prints upload progress on stderr: connection, bytes sent, waiting for the tablet, and candidate
  verification. `--json` stdout stays machine-clean.
- Accepts `.png`, `.jpg` and `.jpeg` in `documents upload`. The image is wrapped into a one-page PDF
  the size of the Paper Pro screen, kept next to the backups as `<image>.wrapped.pdf`, and uploaded
  through the unchanged library gate. Adds the `pdf-lib` dependency for that.
- Resolves relative `<file>` and `--backup-dir` arguments to absolute paths before calling the
  libraries, which keep their strict absolute-path contract.
