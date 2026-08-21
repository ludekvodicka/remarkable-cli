import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { MirrorSyncResult } from "rmcommunication-ts";
import { derivePages, openMirrorIndex, pageImagePath } from "rmindex-ts";

import { requirePositionals } from "../args.js";
import type { CliContext, Command } from "../context.js";
import { CliError } from "../errors.js";
import { emit, table } from "../output.js";

const MIN_INTERVAL_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 86_400;

export const mirrorSync: Command = {
  path: ["mirror", "sync"],
  summary: "Mirror the tablet's storage locally without interrupting it",
  usage: "rmcli mirror sync --mirror-dir <dir> [--index] [--accept-wiped-device] [--json]",
  options: ["mirror-dir", "accept-wiped-device", "index"],
  positionals: [],
  interrupts: false,
  async run(context) {
    const result = await syncOnce(context);
    const index = context.options.flag("index") ? await updateIndex(mirrorDirectory(context)) : null;
    emit(context.streams, context.json, index === null ? result : { ...result, index }, () => describe(result, index));
  },
};

export const mirrorWatch: Command = {
  path: ["mirror", "watch"],
  summary: "Keep mirroring on an interval until interrupted",
  usage: "rmcli mirror watch --mirror-dir <dir> [--interval <seconds>] [--index] [--json]",
  options: ["mirror-dir", "interval", "index"],
  positionals: [],
  interrupts: false,
  longLived: true,
  async run(context) {
    const interval = intervalSeconds(context);
    const stop = new AbortController();
    const onSignal = (): void => stop.abort();
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
      while (!stop.signal.aborted) {
        // The tablet leaves WiFi seconds after it sleeps, so an unreachable device is the normal case
        // here, not a reason to stop watching.
        try {
          const result = await context.withLock(async () => await syncOnce(context));
          const index = context.options.flag("index") ? await updateIndex(mirrorDirectory(context)) : null;
          emit(context.streams, context.json, index === null ? result : { ...result, index }, () => describe(result, index));
        } catch (error) {
          context.streams.err(`${message(error)}\n`);
        }
        await sleep(interval * 1000, stop.signal);
      }
    } finally {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  },
};

export const mirrorIndex: Command = {
  path: ["mirror", "index"],
  summary: "Index the local mirror: catalog, search and page images",
  usage: "rmcli mirror index --mirror-dir <dir> [--force] [--json]",
  options: ["mirror-dir", "force"],
  positionals: [],
  interrupts: false,
  local: true,
  async run(context) {
    const result = await updateIndex(mirrorDirectory(context), { force: context.options.flag("force") });
    emit(context.streams, context.json, result, () => table([
      ["documents", String(result.documents)],
      ["folders", String(result.folders)],
      ["pages rendered", String(result.pagesRendered)],
      ["pages reused", String(result.pagesReused)],
      ["skipped", String(result.skipped.length)],
      ["failed", String(result.failed.length)],
    ]));
  },
};

export const mirrorSearch: Command = {
  path: ["mirror", "search"],
  summary: "Search the indexed mirror by name, folder path and typed text",
  usage: "rmcli mirror search <query> --mirror-dir <dir> [--limit <n>] [--json]",
  options: ["mirror-dir", "limit"],
  positionals: ["query"],
  interrupts: false,
  local: true,
  async run(context) {
    const [query] = requirePositionals(context.positionals, ["query"]) as [string];
    const limit = numberOption(context, "limit", 20, 1, 200);
    const index = openMirrorIndex(mirrorDirectory(context));
    try {
      const hits = index.search(query, { limit }).map((hit) => ({
        documentId: hit.document.id,
        path: hit.document.path,
        pageNumber: hit.pageNumber,
        excerpt: hit.excerpt,
      }));
      emit(context.streams, context.json, hits, () => hits.length === 0
        ? `Nothing in the mirror matches ${query}`
        : table([
          ["PATH", "PAGE", "EXCERPT"],
          ...hits.map((hit) => [hit.path, hit.pageNumber === null ? "-" : String(hit.pageNumber), hit.excerpt]),
        ]));
    } finally {
      index.close();
    }
  },
};

export const mirrorPage: Command = {
  path: ["mirror", "page"],
  summary: "Copy an indexed page image out of the mirror",
  usage: "rmcli mirror page <documentId> <page> --mirror-dir <dir> --output <file.png> [--json]",
  options: ["mirror-dir", "output"],
  positionals: ["documentId", "page"],
  interrupts: false,
  local: true,
  async run(context) {
    const [documentId, page] = requirePositionals(context.positionals, ["documentId", "page"]) as [string, string];
    const pageNumber = Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 1)
      throw new CliError(`Give the page number the tablet prints, counting from 1, got ${page}`);
    const source = pageImagePath(mirrorDirectory(context), documentId, pageNumber);
    if (!existsSync(source))
      throw new CliError(`Page ${pageNumber} of ${documentId} is not in the mirror index. Run rmcli mirror index first.`);
    const output = resolve(context.options.require("output"));
    if (!output.toLowerCase().endsWith(".png")) throw new CliError("--output must end in .png");
    await mkdir(dirname(output), { recursive: true });
    await copyFile(source, output);
    emit(context.streams, context.json, { documentId, pageNumber, output }, () => output);
  },
};

export const mirrorStatus: Command = {
  path: ["mirror", "status"],
  summary: "Report what the local mirror holds and when it was last synced",
  usage: "rmcli mirror status --mirror-dir <dir> [--json]",
  options: ["mirror-dir"],
  positionals: [],
  interrupts: false,
  local: true,
  async run(context) {
    const index = openMirrorIndex(mirrorDirectory(context));
    try {
      const documents = index.listDocuments();
      const open = index.openDocument();
      const status = {
        documents: documents.filter((document) => document.type === "document").length,
        folders: documents.filter((document) => document.type === "folder").length,
        openDocument: open,
      };
      emit(context.streams, context.json, status, () => table([
        ["documents", String(status.documents)],
        ["folders", String(status.folders)],
        ["last sync", open.lastSyncAt ?? "never"],
        ["open on tablet", open.name ?? "-"],
      ]));
    } finally {
      index.close();
    }
  },
};

export interface IndexUpdate {
  readonly documents: number;
  readonly folders: number;
  readonly pagesRendered: number;
  readonly pagesReused: number;
  readonly skipped: readonly string[];
  readonly failed: readonly string[];
}

// One pass over the mirror: rebuild the catalog, render what changed, and hand the page text back to
// the index. Each step is a single library call; the CLI only sequences them.
export async function updateIndex(
  mirrorRoot: string,
  options: { readonly force?: boolean } = {},
): Promise<IndexUpdate> {
  const index = openMirrorIndex(mirrorRoot);
  try {
    const catalog = index.rebuild();
    const derived = await derivePages(mirrorRoot, options.force === true ? { force: true } : {});
    for (const page of derived.rendered) index.recordPageText(page.documentId, page.pageNumber, page.text);
    return {
      documents: catalog.documents,
      folders: catalog.folders,
      pagesRendered: derived.rendered.length - derived.reused,
      pagesReused: derived.reused,
      skipped: catalog.skipped,
      failed: derived.failed,
    };
  } finally {
    index.close();
  }
}

async function syncOnce(context: CliContext): Promise<MirrorSyncResult> {
  const acceptWipedDevice = context.options.flag("accept-wiped-device");
  return await context.withDevice(async (device) =>
    await device.syncMirror(mirrorDirectory(context), acceptWipedDevice ? { acceptWipedDevice } : {}));
}

function describe(result: MirrorSyncResult, index: IndexUpdate | null): string {
  return table([
    ["downloaded", String(result.downloaded.length)],
    ["deleted", String(result.deleted.length)],
    ["unstable", String(result.skippedUnstable.length)],
    ["documents", String(result.changedDocumentIds.length)],
    ["templates", result.templatesSynced ? "synced" : "skipped"],
    ["open", result.openDocument.documentId ?? "-"],
    ["finished", result.finishedAt],
    ...(index === null ? [] : [["indexed", `${index.documents} documents, ${index.pagesRendered} pages rendered`]]),
  ]);
}

export function mirrorDirectory(context: CliContext): string {
  return resolve(context.options.require("mirror-dir"));
}

function numberOption(context: CliContext, name: string, fallback: number, min: number, max: number): number {
  const given = context.options.optional(name);
  if (given === null) return fallback;
  const value = Number(given);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new CliError(`--${name} must be an integer from ${min} to ${max}`);
  return value;
}

function intervalSeconds(context: CliContext): number {
  const given = context.options.optional("interval");
  if (given === null) return 60;
  const seconds = Number(given);
  if (!Number.isInteger(seconds) || seconds < MIN_INTERVAL_SECONDS || seconds > MAX_INTERVAL_SECONDS)
    throw new CliError(`--interval must be an integer from ${MIN_INTERVAL_SECONDS} to ${MAX_INTERVAL_SECONDS} seconds`);
  return seconds;
}

async function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolveSleep) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolveSleep();
    }, milliseconds);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolveSleep();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function message(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
