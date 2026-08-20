import { resolve } from "node:path";

import type { MirrorSyncResult } from "rmcommunication-ts";

import type { CliContext, Command } from "../context.js";
import { CliError } from "../errors.js";
import { emit, table } from "../output.js";

const MIN_INTERVAL_SECONDS = 5;
const MAX_INTERVAL_SECONDS = 86_400;

export const mirrorSync: Command = {
  path: ["mirror", "sync"],
  summary: "Mirror the tablet's storage locally without interrupting it",
  usage: "rmcli mirror sync --mirror-dir <dir> [--accept-wiped-device] [--json]",
  options: ["mirror-dir", "accept-wiped-device"],
  positionals: [],
  interrupts: false,
  async run(context) {
    const result = await syncOnce(context);
    emit(context.streams, context.json, result, () => describe(result));
  },
};

export const mirrorWatch: Command = {
  path: ["mirror", "watch"],
  summary: "Keep mirroring on an interval until interrupted",
  usage: "rmcli mirror watch --mirror-dir <dir> [--interval <seconds>] [--json]",
  options: ["mirror-dir", "interval"],
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
          emit(context.streams, context.json, result, () => describe(result));
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

async function syncOnce(context: CliContext): Promise<MirrorSyncResult> {
  const mirrorDirectory = resolve(context.options.require("mirror-dir"));
  const acceptWipedDevice = context.options.flag("accept-wiped-device");
  return await context.withDevice(async (device) =>
    await device.syncMirror(mirrorDirectory, acceptWipedDevice ? { acceptWipedDevice } : {}));
}

function describe(result: MirrorSyncResult): string {
  return table([
    ["downloaded", String(result.downloaded.length)],
    ["deleted", String(result.deleted.length)],
    ["unstable", String(result.skippedUnstable.length)],
    ["documents", String(result.changedDocumentIds.length)],
    ["templates", result.templatesSynced ? "synced" : "skipped"],
    ["open", result.openDocument.documentId ?? "-"],
    ["finished", result.finishedAt],
  ]);
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
