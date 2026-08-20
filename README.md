# remarkable-cli

The `rmcli` command line over [`rmscene-ts`](https://github.com/ludekvodicka/rmscene-ts) and [`rmcommunication-ts`](https://github.com/ludekvodicka/rmcommunication-ts) for
reMarkable tablets in developer mode. It is a thin mapping of those libraries: every capability lives in
them, and `rmcli` only parses arguments, calls one library function, and prints the result.

## Install

```sh
npm install -g remarkable-cli
rmcli --help
```

The package is named `remarkable-cli` on npm because the shorter name is taken; the command it installs
is `rmcli`.

To work on it from a checkout instead:

```sh
npm install
npm run build
node dist/cli.js --help
```

Node 20.9 or newer.

`SKILL.md` in this package is the agent-facing guide: what to run for a given request, and what not
to do. Point an AI assistant at it rather than at this README.

## Configure

```sh
export RMCLI_HOST=<tablet-wifi-address>
export RMCLI_PASSWORD='...'
rmcli device fingerprint      # prints the tablet's host key and trusts nothing
export RMCLI_FINGERPRINT=SHA256:...
```

`device fingerprint` is the only command that runs before a host key is pinned. Check what it prints
against the tablet before exporting it; every other command then refuses to connect if the key
changes.

The SSH password is never a command argument. Set `RMCLI_PASSWORD` for a one-off run, or leave it unset
and set `RMCLI_PASSWORD_COMMAND` to a command whose stdout is the password, which is how a password
manager or a secret store supplies it:

```sh
export RMCLI_PASSWORD_COMMAND='pass show remarkable/root'
```

The command runs through the platform shell, `cmd.exe` on Windows and `/bin/sh` elsewhere, and only
its stdout is read.

Either way the value reaches the connection through a provider function and is never printed, not even
inside an error.

`RMCLI_TIMEOUT_MS` sets the Web Interface request timeout, default 180000.

## Commands that leave the tablet running

These go through a pinned WiFi SSH tunnel to the tablet's internal Web Interface. Xochitl keeps running
and the user is not interrupted.

```text
rmcli device status [--json]
rmcli device identity [--json]
rmcli device capabilities [--json]
rmcli device enable-wifi-ssh
rmcli documents current [--json]
rmcli documents list [--json]
rmcli documents get <documentId> [--json]
rmcli documents download <documentId> --backup-dir <dir> [--json]
rmcli documents upload <file.pdf|file.epub|image> --name <name> --backup-dir <dir> [--folder <folderId>] [--json]
rmcli pages list <documentId|current> --backup-dir <dir> | --archive <file.rmdoc> [--raw] [--json]
rmcli pages render <documentId|current> <page|current|pageId> --output <file.svg|file.png>
                   --backup-dir <dir> | --archive <file.rmdoc>
                   [--template <name>] [--background white|transparent] [--width <px>] [--json]
rmcli templates read <name> --output <file.json> [--json]
```

`documents current` reads `LastOpen` from the tablet's configuration and the open page from the
document's own content file. Both are plain reads and neither stops the tablet UI. It reports
`documentId: null` when the user is in the library list.

`pages render` downloads the document as a verified rmdoc backup and renders from that archive, which is
the only page source that does not stop the tablet UI. Pass `--archive` instead of `--backup-dir` to
reuse a download you already have. Pass `--template` to draw the ruled background; the template itself
is read over SFTP, which does not interrupt anything either.

## Page numbers

A document positional accepts `current`, meaning whatever the tablet has open. A page positional
accepts `current`, a page ID, or the **page number the tablet shows, counting from 1**.

`pages list` prints both `PAGE` and `INDEX`. `INDEX` is the raw position inside the document file and a
deleted page leaves a gap in it, so only `PAGE` is the number a person sees. `pages render --json`
reports `svg` and `png` sizes separately, because SVG user units and raster pixels are unrelated
numbers.

## Commands that interrupt the tablet

These run inside a guarded offline session: the library stops Xochitl, works, and starts it again. Each
one refuses to run until `--service` is added.

```text
rmcli service documents list --service [--json]
rmcli service page read <documentId> <pageId> --output <file.rm> --service
rmcli service page write <documentId> <pageId> --input <file.rm> --expected-revision <rev> --backup-dir <dir> --service
rmcli service snapshot <documentId> --backup-dir <dir> --service
rmcli service mirror --mirror-dir <dir> --service
```

## Output

`--json` writes stable JSON to stdout; without it the same data is printed as a table. Errors go to
stderr and the exit code is 1. Binary output always goes to the file named by `--output`, never to
stdout, so an image never lands in the context of the tool that invoked the command.

## There is no delete

The tablet's Web Interface exposes exactly three endpoints, `GET /documents/{folder}`, `POST /upload`
and `GET /download/{id}/{format}`. Deleting a document is a tablet-UI action.

## One run at a time

Upload targets the container listed most recently, and that selection is global tablet state rather
than per-connection. `rmcli` therefore takes a lock file per host for the whole invocation, so two runs
on this machine cannot interleave a folder selection with someone else's upload. Runs from different
machines are not covered; a single owning service is the real answer to that.

## The three packages

| Package | What it does |
| --- | --- |
| [`rmscene-ts`](https://github.com/ludekvodicka/rmscene-ts) ([npm](https://www.npmjs.com/package/rmscene-ts)) | Reads, writes and renders `.rm` version 6 scene files. No filesystem, no network, browser-safe. |
| [`rmcommunication-ts`](https://github.com/ludekvodicka/rmcommunication-ts) ([npm](https://www.npmjs.com/package/rmcommunication-ts)) | Talks to the tablet over pinned SSH: listings, verified rmdoc backups, page rendering, templates, PNG, PDF and EPUB import. |
| [`remarkable-cli`](https://github.com/ludekvodicka/rmcli) ([npm](https://www.npmjs.com/package/remarkable-cli)) | The `rmcli` command line over both libraries. |

None of them implements the reMarkable Cloud protocol.

## License and credits

MIT.

`rmcli` is a thin command line over [`rmcommunication-ts`](https://github.com/ludekvodicka/rmcommunication-ts)
and [`rmscene-ts`](https://github.com/ludekvodicka/rmscene-ts). The `.rm` scene format itself was worked
out by [`rmscene`](https://github.com/ricklupton/rmscene), the Python library that `rmscene-ts` was
rewritten from.
