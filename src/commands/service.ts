import { readFile } from "node:fs/promises";

import { requirePositionals } from "../args.js";
import type { Command } from "../context.js";
import { emit, table, writeBinary } from "../output.js";

// Every command here runs inside a guarded offline session, which stops and restarts Xochitl. They
// exist because the libraries expose them, not because they belong in routine use, so each one is
// behind the explicit --service flag checked in the runner.
export const serviceDocumentsList: Command = {
  path: ["service", "documents", "list"],
  summary: "List documents straight from Xochitl storage over SFTP",
  usage: "rmcli service documents list --service [--json]",
  options: ["service"],
  positionals: [],
  interrupts: true,
  async run(context) {
    const entries = await context.withDevice(async (device) => await device.listDocuments());
    emit(context.streams, context.json, entries, () => table([
      ["ID", "TYPE", "FILE", "PARENT", "NAME"],
      ...entries.map((entry) => [entry.id, entry.type, entry.fileType ?? "-", entry.parentId ?? "root", entry.name]),
    ]));
  },
};

export const servicePageRead: Command = {
  path: ["service", "page", "read"],
  summary: "Read one raw .rm page from Xochitl storage",
  usage: "rmcli service page read <documentId> <pageId> --output <file.rm> --service [--json]",
  options: ["output", "service"],
  positionals: ["documentId", "pageId"],
  interrupts: true,
  async run(context) {
    const [documentId, pageId] = requirePositionals(context.positionals, ["documentId", "pageId"]) as [string, string];
    const output = context.options.require("output");
    const page = await context.withDevice(async (device) => await device.readPage(documentId, pageId));
    const path = await writeBinary(output, page.bytes);
    emit(context.streams, context.json, { documentId, pageId, revision: page.revision, outputPath: path }, () =>
      `${path}\n${page.bytes.byteLength} bytes, revision ${page.revision}`);
  },
};

export const servicePageWrite: Command = {
  path: ["service", "page", "write"],
  summary: "Replace one existing .rm page inside a write transaction",
  usage: "rmcli service page write <documentId> <pageId> --input <file.rm> --expected-revision <rev>"
    + " --backup-dir <dir> --service [--json]",
  options: ["input", "expected-revision", "backup-dir", "service"],
  positionals: ["documentId", "pageId"],
  interrupts: true,
  async run(context) {
    const [documentId, pageId] = requirePositionals(context.positionals, ["documentId", "pageId"]) as [string, string];
    const bytes = await readFile(context.options.require("input"));
    const request = {
      documentId,
      pageId,
      bytes,
      expectedRevision: context.options.require("expected-revision"),
      backupDirectory: context.options.require("backup-dir"),
    };
    const receipt = await context.withDevice(async (device) => await device.writePage(request));
    emit(context.streams, context.json, receipt, () => JSON.stringify(receipt, null, 2));
  },
};

export const serviceSnapshot: Command = {
  path: ["service", "snapshot"],
  summary: "Take a verified snapshot of one document bundle",
  usage: "rmcli service snapshot <documentId> --backup-dir <dir> --service [--json]",
  options: ["backup-dir", "service"],
  positionals: ["documentId"],
  interrupts: true,
  async run(context) {
    const [documentId] = requirePositionals(context.positionals, ["documentId"]) as [string];
    const backupDirectory = context.options.require("backup-dir");
    const snapshot = await context.withDevice(async (device) => await device.snapshotDocument(documentId, backupDirectory));
    emit(context.streams, context.json, snapshot, () => JSON.stringify(snapshot, null, 2));
  },
};

export const serviceMirror: Command = {
  path: ["service", "mirror"],
  summary: "Mirror the whole document store into a new local generation",
  usage: "rmcli service mirror --mirror-dir <dir> --service [--json]",
  options: ["mirror-dir", "service"],
  positionals: [],
  interrupts: true,
  async run(context) {
    const mirrorDirectory = context.options.require("mirror-dir");
    const result = await context.withDevice(async (device) => await device.mirrorDocuments(mirrorDirectory));
    emit(context.streams, context.json, result, () => JSON.stringify(result, null, 2));
  },
};
