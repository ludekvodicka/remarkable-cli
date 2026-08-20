import { resolve } from "node:path";

import type { Device } from "rmcommunication-ts";
import { describe, expect, it, vi } from "vitest";

import { run, type Runtime } from "../src/run.js";

const OBSERVED_AT = "2026-08-20T18:00:00.000Z";

describe("mirror commands", () => {
  it("syncs once with the resolved directory and prints the result as JSON", async () => {
    const { runtime, syncs, out } = harness();

    await run(["mirror", "sync", "--mirror-dir", "./mirror", "--json"], runtime);

    expect(syncs).toEqual([{ mirrorDirectory: resolve("./mirror") }]);
    expect(JSON.parse(out.join(""))).toMatchObject({ downloaded: ["doc.metadata"], templatesSynced: true });
  });

  it("passes the wiped-device override only when the flag is given", async () => {
    const first = harness();
    await run(["mirror", "sync", "--mirror-dir", "m", "--accept-wiped-device", "--json"], first.runtime);
    expect(first.syncs[0]).toMatchObject({ acceptWipedDevice: true });

    const second = harness();
    await run(["mirror", "sync", "--mirror-dir", "m", "--json"], second.runtime);
    expect(second.syncs[0]).not.toHaveProperty("acceptWipedDevice");
  });

  it("rejects an interval outside the allowed range", async () => {
    const { runtime } = harness();
    await expect(run(["mirror", "watch", "--mirror-dir", "m", "--interval", "1"], runtime))
      .rejects.toThrow("--interval must be an integer");
  });

  it("keeps watching after a failed iteration and takes the lock once per iteration", async () => {
    const { runtime, syncs, locks, err } = harness({ failFirstSync: true });
    vi.useFakeTimers();
    try {
      const watching = run(["mirror", "watch", "--mirror-dir", "m", "--interval", "5", "--json"], runtime);
      await vi.advanceTimersByTimeAsync(1);
      expect(syncs).toHaveLength(1);
      expect(err.join("")).toContain("device is asleep");

      await vi.advanceTimersByTimeAsync(5_000);
      expect(syncs).toHaveLength(2);

      process.emit("SIGINT");
      await vi.advanceTimersByTimeAsync(5_000);
      await watching;

      expect(locks.filter((entry) => entry === "acquired")).toHaveLength(2);
      expect(locks.filter((entry) => entry === "released")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

interface Harness {
  readonly runtime: Runtime;
  readonly syncs: Record<string, unknown>[];
  readonly locks: string[];
  readonly out: string[];
  readonly err: string[];
}

function harness(options: { readonly failFirstSync?: boolean } = {}): Harness {
  const syncs: Record<string, unknown>[] = [];
  const locks: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const device = {
    syncMirror: async (mirrorDirectory: string, syncOptions: Record<string, unknown>) => {
      syncs.push({ mirrorDirectory, ...syncOptions });
      if (options.failFirstSync === true && syncs.length === 1) throw new Error("device is asleep");
      return {
        downloaded: ["doc.metadata"],
        deleted: [],
        skippedUnstable: [],
        changedDocumentIds: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
        openDocument: {
          documentId: null, name: null, pageId: null, pageNumber: null,
          pageIndex: null, pageCount: null, observedAt: OBSERVED_AT,
        },
        templatesSynced: true,
        finishedAt: OBSERVED_AT,
        localDurability: "file-and-directory" as const,
      };
    },
  } as unknown as Device;
  return {
    syncs,
    locks,
    out,
    err,
    runtime: {
      streams: { out: (text) => out.push(text), err: (text) => err.push(text) },
      withWeb: async () => { throw new Error("mirror commands never use the Web Interface"); },
      withDevice: async (operation) => await operation(device),
      discoverFingerprint: async () => ({ host: "10.0.0.1", fingerprint: `SHA256:${"A".repeat(43)}` }),
      withLock: async (operation) => {
        locks.push("acquired");
        try {
          return await operation();
        } finally {
          locks.push("released");
        }
      },
    },
  };
}
