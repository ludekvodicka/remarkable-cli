---
name: rmcli
description: "Work with a reMarkable tablet from the command line: see which document and page it has open right now, render a handwritten page to an image you can look at, list and download documents, and upload a PDF, EPUB or image into a folder, without interrupting the tablet. Use when asked what is on the tablet or open on it, to read a sketch someone drew, or to put a document on the device. TRIGGER 'reMarkable', 'na tabletu', 'co mam otevrene', 'co jsem nakreslil', 'nahraj do tabletu', 'render the page'."
---

# rmcli

`rmcli` reaches the tablet over SSH and its own internal Storage Web Interface. Handwriting is an
image: the only way to read a sketch is to render it to a file and look at that file.

There is **no delete, move or rename**. The tablet exposes no such endpoint. When something must be
removed, say it has to be done on the tablet itself.

## Setup, once per tablet

The tablet must be in developer mode, have SSH over WiFi enabled, and have its Storage Web Interface
switched on. On a Paper Pro the internal interface also needs a one-time network bootstrap; the
script and its instructions ship with the `rmcommunication-ts` package.

1. **Address.** Read the tablet's WiFi address from its network settings.
2. **Host key.** Ask the tablet for it, check it, then pin it:

```sh
export RMCLI_HOST=<tablet-wifi-address>
export RMCLI_PASSWORD='...'        # the developer-mode password shown on the tablet
rmcli device fingerprint
```

   It prints one `SHA256:...` line and trusts nothing. Compare it with the tablet, then

```sh
export RMCLI_FINGERPRINT=SHA256:...
```

Every other command refuses to run until `RMCLI_FINGERPRINT` is set, and aborts if the key ever
changes. Never put the password in a command argument, a prompt or a file you write. Leaving
`RMCLI_PASSWORD` unset makes `rmcli` run `RMCLI_PASSWORD_COMMAND` through the platform shell and read
the password from its stdout, which is where a password manager or a secret store plugs in.

`RMCLI_TIMEOUT_MS` raises the request timeout past its 180000 default for a slow link.

## Pick the command

| The user wants | Command |
| --- | --- |
| the page they are looking at now | `rmcli pages render current current …`, below |
| what is open on the tablet | `rmcli documents current --json` |
| what is on the tablet | `rmcli documents list --json` |
| one document's details | `rmcli documents get <documentId> --json` |
| to see a sketch or wireframe | `pages list` then `pages render`, below |
| a local copy | `rmcli documents download <documentId> --backup-dir <dir> --json` |
| a PDF, EPUB or image on the tablet | `rmcli documents upload <file> --name <name> --backup-dir <dir> [--folder <id>] --json` |
| device and connection state | `rmcli device status --json` |
| a local copy of everything, kept fresh | `rmcli mirror sync --mirror-dir <dir> --index --json`, below |
| to find a document by what is written in it | `rmcli mirror search <query> --mirror-dir <dir> --json` |

Pass `--json` whenever you will decide something from the output. Read the plain table only when
showing it to a person.

## What is open right now

```sh
rmcli documents current --json
```

It answers from the tablet, live. `documentId` is `null` when the user is in the library list rather
than inside a document, which is an answer, not a failure. `pageNumber` is the number the tablet
prints; `observedAt` says when it was read.

Do not answer this from a mirror or a cache. A local mirror reports its own last sync, which can be
days old and can name a document the user closed long ago. `rmcli` is the live truth.

Never guess the open document from timestamps in `documents list`. `currentPageNumber` there is only
as fresh as the last save.

## Reading handwriting

The page the user is looking at, in one command:

```sh
rmcli pages render current current --output <dir>/page.png --backup-dir <dir> --json
```

Any other page:

```sh
rmcli pages list <documentId> --backup-dir <dir> --json
rmcli pages render <documentId> <page> --output <dir>/page.png --backup-dir <dir> --json
```

Then open the PNG with your file-reading tool. `--width <px>` sets the raster size and applies to PNG
only, `--template <name>` draws the ruled background, and `--background transparent` drops the white
fill. The image only ever goes to `--output`; never try to print it.

Send the rendered file to the user and give the full path before discussing what is on it.

### Naming a document and a page

Both positionals take `current`, meaning whatever the tablet has open. The page also takes the **page
number the tablet shows, counting from 1**, or a page ID. Talk to people in page numbers; pass page
IDs between commands.

`pages list` also prints `index`, the raw position inside the document file. It is not the page
number: a deleted page leaves a gap in `index` while `number` stays contiguous. Never show `index` to
a user and never add one to it.

### Reuse a download

`pages list` and `pages render` print `archivePath`. Pass it back as `--archive <file.rmdoc>` instead
of `--backup-dir` to work on more pages of the same document without downloading it again. That
matters: the link drops as soon as the tablet sleeps.

## Uploading

`.pdf` and `.epub` up to 100 MB, and `.png`, `.jpg`, `.jpeg` images. `--backup-dir` is required: the
command verifies the upload by fetching the document back and keeps that archive.

- **An image is wrapped, not imported.** The tablet has no image import, so the CLI first turns the
  picture into a one-page PDF the size of the Paper Pro screen, 1620 x 2160 points, on a turned page
  when the image is wider than it is tall. That file is written to
  `<backup-dir>/<image>.wrapped.pdf` and kept, because `receipt.sourceSha256` refers to it and not to
  the image. Wrapping happens before anything reaches the tablet, so a broken image fails locally.
- `--name` is a **request, not the stored name**. An EPUB is named from its own internal title, and a
  PDF keeps its `.pdf` extension, wrapped images included. Read `name` from the output before telling
  anyone what it is called.
- `--folder` needs an existing folder ID from `documents list`. A wrong or non-folder ID fails before
  anything is sent.
- Keep the receipt: `documentId`, `parentId` and `receipt.archivePath`. Report the `documentId`.
- Progress goes to stderr: connection, bytes sent, waiting for the tablet, candidate verification.
  Stdout stays machine-clean under `--json`. A transfer that stops printing is a transfer that is
  stuck; a slow one keeps counting.

**On an ambiguous import, do not upload again.** The document may already be on the tablet. List the
documents, look for one matching the source, and report what you found. The same holds for an upload
that failed loudly: the tablet may have filed the document anyway.

## Mirroring

```sh
rmcli mirror sync --mirror-dir <dir> --json
rmcli mirror watch --mirror-dir <dir> --interval 300
```

`mirror sync` keeps `<dir>/xochitl` a byte copy of the tablet's storage and `<dir>/templates` a copy of
its templates, then writes `<dir>/state.json` with the open document and the run's counters. It reads
only: nothing is stopped, nothing is written to the tablet, so it is safe while someone is writing on
it. A file that changes mid-download keeps its previous copy and lands in `skippedUnstable`, healed by
the next run. `mirror watch` is the same run on an interval until Ctrl-C.

Deletions on the tablet delete the local copy too, because this is a mirror. A run that would empty the
mirror, or one where the tablet lists no `.metadata` file at all, stops with a `mirror-guard` error
instead; pass `--accept-wiped-device` only when the tablet really was wiped.

### Searching the mirror

```sh
rmcli mirror index --mirror-dir <dir> --json
rmcli mirror search "architecture" --mirror-dir <dir> --json
rmcli mirror page <documentId> <page> --mirror-dir <dir> --output <dir>/page.png
rmcli mirror status --mirror-dir <dir> --json
```

`mirror index` builds the catalog, renders the pages that changed and extracts typed text, so `search`
matches document names, folder paths and what is typed on a page. Add `--index` to `mirror sync` or
`mirror watch` to do it in the same run. These four commands and `mcp serve` read the local mirror
only: they need no tablet, no `RMCLI_HOST` and no `RMCLI_FINGERPRINT`, and they never take the device
lock.

**The mirror is a snapshot, not the tablet.** `mirror status` prints when it was last synced. For what
is open right now, ask the tablet with `documents current`.

This is not the same thing as `rmcli service mirror`, which stops Xochitl to take a verified
point-in-time generation. Use `mirror sync` for the continuous copy, the service command for a backup
taken before something risky.

## Serving the mirror to an agent

```sh
rmcli mcp serve --mirror-dir <dir>
```

Speaks MCP over stdio with six read-only tools: `search`, `list_documents`, `get_document`,
`get_page_image`, `get_open_document`, `mirror_status`. It opens no device connection and needs no
credentials, so it can keep answering while the tablet sleeps. There is deliberately no sync, write or
delete tool: syncing is `rmcli mirror sync`, and nothing here can change the tablet.

## Paths

`<file>` and `--backup-dir` may be relative; the CLI resolves them against the working directory. The
libraries themselves require absolute paths, so anything calling them directly has to resolve first.

## When it fails

| Symptom | Meaning |
| --- | --- |
| SSH connection timeout | The tablet is asleep and off WiFi. Ask the user to wake it and hold it awake, then run the command once more. Do not retry in a loop. |
| nothing is open on the tablet | The user is in the library list. Ask which document they mean, or list the documents. |
| host key changed | Stop. Something is answering that is not the tablet you pinned, or the tablet was reset. |
| `Another rmcli run (PID N) holds the lock` | One run at a time per tablet, and that PID is alive. Wait for it. Never delete the lock file: a lock whose holder is gone is taken over automatically. |
| HTTP request fails while SSH works | The Storage Web Interface listener is down, usually after the tablet UI restarted. The user has to toggle Storage Web Interface off and on. |
| an upload fails or is interrupted | It may still have filed the document. List the documents, compare against the source, and report what you found. Never repeat the upload to find out. |
| missing `RMCLI_FINGERPRINT` | Setup was never finished. See above. |

## Diagnosing

Probe the tablet with this CLI: `rmcli device status --json` for SSH and the device, `rmcli documents
list --json` for the Web Interface. Both go through the library's own SSH tunnel, which is what every
other command uses.

Do not diagnose through a hand-rolled tunnel. A `plink -L` forward built by hand once answered
`{"success":false,"error":"not found"}` on every path and produced a confident, wrong conclusion that
the Web Interface was down, while the library's tunnel was returning 200 at the same moment.

## Do not

- Do not run any `rmcli service ...` command. They stop and restart the tablet UI, interrupting
  whatever the user is doing, and exist for maintenance. Only run one when the user asks for that
  specific operation, and then it also needs `--service`.
- Do not overwrite existing content. Create a new document instead.
- Do not pass the password, the fingerprint or any token through a prompt or a command argument.
