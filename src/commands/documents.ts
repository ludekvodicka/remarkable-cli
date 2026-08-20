import { basename, extname, join, resolve } from "node:path";

import type { WebDocumentEntry, WebImportProgress } from "rmcommunication-ts";

import { requirePositionals } from "../args.js";
import type { Command } from "../context.js";
import { CliError } from "../errors.js";
import { IMAGE_EXTENSIONS, isImageExtension, wrapImageAsPdf } from "../image-wrap.js";
import { emit, isoTime, table, type OutputStreams } from "../output.js";

// One line per 500 ms is enough to show life without flooding a log.
const PROGRESS_INTERVAL_MS = 500;

export const documentsCurrent: Command = {
  path: ["documents", "current"],
  summary: "Show which document and page the tablet has open right now",
  usage: "rmcli documents current [--json]",
  options: [],
  positionals: [],
  interrupts: false,
  async run(context) {
    const open = await context.withDevice(async (device) => await device.readOpenDocument());
    emit(context.streams, context.json, open, () => open.documentId === null
      ? `Nothing is open; the tablet is showing the library list (observed ${open.observedAt})`
      : table([
        ["documentId", open.documentId],
        ["name", open.name ?? "-"],
        ["page", open.pageNumber === null ? "-" : `${open.pageNumber} of ${open.pageCount ?? "?"}`],
        ["pageId", open.pageId ?? "-"],
        ["observedAt", open.observedAt],
      ]));
  },
};

export const documentsList: Command = {
  path: ["documents", "list"],
  summary: "List every document and folder on the tablet",
  usage: "rmcli documents list [--json]",
  options: [],
  positionals: [],
  interrupts: false,
  async run(context) {
    const entries = await context.withWeb(async (web) => await web.listDocuments());
    emit(context.streams, context.json, entries.map(describeEntry), () => table([
      ["ID", "TYPE", "FILE", "PARENT", "NAME"],
      ...entries.map((entry) => [
        entry.id,
        entry.type,
        entry.fileType ?? "-",
        entry.parentId ?? "root",
        entry.name,
      ]),
    ]));
  },
};

export const documentsGet: Command = {
  path: ["documents", "get"],
  summary: "Show one document entry from the live listing",
  usage: "rmcli documents get <documentId> [--json]",
  options: [],
  positionals: ["documentId"],
  interrupts: false,
  async run(context) {
    const [documentId] = requirePositionals(context.positionals, ["documentId"]) as [string];
    const entry = describeEntry(await context.withWeb(async (web) => findDocument(await web.listDocuments(), documentId)));
    emit(context.streams, context.json, entry, () => table([
      ["id", entry.id],
      ["name", entry.name],
      ["type", entry.type],
      ["fileType", entry.fileType ?? "-"],
      ["parent", entry.parentId ?? "root"],
      ["currentPageNumber", entry.currentPageNumber === null ? "-" : String(entry.currentPageNumber)],
      ["modified", entry.modified ?? "-"],
    ]));
  },
};

export const documentsDownload: Command = {
  path: ["documents", "download"],
  summary: "Download and verify a document as an rmdoc backup",
  usage: "rmcli documents download <documentId> --backup-dir <dir> [--json]",
  options: ["backup-dir"],
  positionals: ["documentId"],
  interrupts: false,
  async run(context) {
    const [documentId] = requirePositionals(context.positionals, ["documentId"]) as [string];
    const backupDirectory = resolve(context.options.require("backup-dir"));
    const backup = await context.withWeb(async (web) => await web.downloadDocument({ documentId, backupDirectory }));
    const summary = {
      documentId,
      name: backup.document.name,
      parentId: backup.document.parentId,
      fileType: backup.document.fileType,
      pages: backup.document.pages.length,
      revision: backup.revision,
      source: backup.source,
      archivePath: backup.archivePath,
      archiveBytes: backup.archiveBytes,
      archiveSha256: backup.archiveSha256,
    };
    emit(context.streams, context.json, summary, () =>
      `${backup.archivePath}\n${backup.archiveBytes} bytes, sha256 ${backup.archiveSha256}, ${summary.pages} page(s)`);
  },
};

export const documentsUpload: Command = {
  path: ["documents", "upload"],
  summary: "Upload a PDF, EPUB or image without interrupting the tablet",
  usage: "rmcli documents upload <file> --name <name> --backup-dir <dir> [--folder <folderId>] [--json]",
  options: ["name", "backup-dir", "folder"],
  positionals: ["file"],
  interrupts: false,
  async run(context) {
    const [fileArgument] = requirePositionals(context.positionals, ["file"]) as [string];
    // The library keeps its strict absolute-path contract, which protects every other caller. Making
    // a relative path work is the CLI's job, where the working directory is known.
    const file = resolve(fileArgument);
    const extension = extname(file).toLowerCase();
    const name = context.options.require("name");
    const backupDirectory = resolve(context.options.require("backup-dir"));
    const folder = context.options.optional("folder");
    let sourcePath = file;
    let kind: "pdf" | "epub";
    if (extension === ".pdf") kind = "pdf";
    else if (extension === ".epub") kind = "epub";
    else if (isImageExtension(extension)) {
      // The wrapped PDF is kept: the receipt's source hash refers to it, not to the image.
      const wrapped = await wrapImageAsPdf(file, join(backupDirectory, `${basename(file)}.wrapped.pdf`));
      context.streams.err(
        `wrapped ${basename(file)} into ${wrapped.pdfPath} (${wrapped.pageWidth} x ${wrapped.pageHeight} pt)\n`,
      );
      sourcePath = wrapped.pdfPath;
      kind = "pdf";
    } else
      throw new CliError(
        `Upload needs a .pdf, .epub or image (${IMAGE_EXTENSIONS.join(", ")}) file, got ${extension === "" ? file : extension}`,
      );
    const request = {
      sourcePath,
      name,
      backupDirectory,
      ...(folder === null ? {} : { parentId: folder }),
      onProgress: uploadProgressPrinter(context.streams),
    };
    const result = await context.withWeb(async (web) => {
      if (kind === "pdf") return await web.importPdf(request);
      else if (kind === "epub") return await web.importEpub(request);
      else
        throw new Error(`Unknown upload kind: ${JSON.stringify(kind)}`);
    });
    emit(context.streams, context.json, result, () =>
      `${result.documentId}\nname ${result.name}, parent ${result.parentId ?? "root"}, ${result.pages.length} page(s)\n` +
      `backup ${result.receipt.archivePath}`);
  },
};

// An upload can take minutes on a slow link. Without these lines a dead transfer looks exactly like a
// slow one. They go to stderr so `--json` stdout stays machine-clean.
function uploadProgressPrinter(streams: OutputStreams): (progress: WebImportProgress) => void {
  let reportedAt = 0;
  return (progress) => {
    if (progress.phase === "connected") streams.err("connected to the tablet\n");
    else if (progress.phase === "uploading") {
      const now = Date.now();
      if (progress.sentBytes < progress.totalBytes && now - reportedAt < PROGRESS_INTERVAL_MS) return;
      reportedAt = now;
      streams.err(`uploaded ${progress.sentBytes} of ${progress.totalBytes} bytes\n`);
    } else if (progress.phase === "processing") streams.err("waiting for the tablet to file the document\n");
    else if (progress.phase === "verifying") streams.err(`verifying candidate ${progress.candidateId}\n`);
    else
      throw new Error(`Unknown import progress: ${JSON.stringify(progress)}`);
  };
}

// The firmware's CurrentPage is 0-based and only as fresh as the last save, so it is presented as the
// number the tablet prints and `documents current` stays the authoritative answer for what is open.
function describeEntry(entry: WebDocumentEntry) {
  return {
    id: entry.id,
    name: entry.name,
    type: entry.type,
    fileType: entry.fileType,
    parentId: entry.parentId,
    bookmarked: entry.bookmarked,
    currentPageNumber: entry.currentPage === null ? null : entry.currentPage + 1,
    modifiedMs: entry.modifiedMs,
    modified: isoTime(entry.modifiedMs),
  };
}

function findDocument(entries: readonly WebDocumentEntry[], documentId: string): WebDocumentEntry {
  const entry = entries.find((candidate) => candidate.id === documentId);
  if (entry === undefined) throw new CliError(`The tablet has no document ${documentId}`);
  return entry;
}
