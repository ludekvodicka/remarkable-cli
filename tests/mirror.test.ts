import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Device } from "rmcommunication-ts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { run, type Runtime } from "../src/run.js";

const OBSERVED_AT = "2026-08-20T18:00:00.000Z";
const DOCUMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

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

describe("mirror commands over a local mirror", () => {
  it("indexes, searches, reports status and copies a page without any device environment", async () => {
    const root = await fixtureMirror();
    const indexing = harness();
    await run(["mirror", "index", "--mirror-dir", root, "--json"], indexing.runtime);
    expect(JSON.parse(indexing.out.join(""))).toMatchObject({ documents: 1, folders: 0 });
    // A local command must never reach for the per-host lock, which is what needs RMCLI_HOST.
    expect(indexing.locks).toEqual([]);

    const searching = harness();
    await run(["mirror", "search", "poznamky", "--mirror-dir", root, "--json"], searching.runtime);
    expect(JSON.parse(searching.out.join(""))[0]).toMatchObject({ path: "Poznámky" });

    const status = harness();
    await run(["mirror", "status", "--mirror-dir", root, "--json"], status.runtime);
    expect(JSON.parse(status.out.join(""))).toMatchObject({
      documents: 1,
      openDocument: { lastSyncAt: "2026-08-21T06:00:00.000Z" },
    });

    await mkdir(join(root, "derived", "pages", DOCUMENT_ID), { recursive: true });
    await writeFile(join(root, "derived", "pages", DOCUMENT_ID, "1.png"), PNG);
    const copying = harness();
    const output = join(root, "out", "page.png");
    await run(["mirror", "page", DOCUMENT_ID, "1", "--mirror-dir", root, "--output", output, "--json"], copying.runtime);
    expect(await readFile(output)).toEqual(PNG);
  });

  it("explains that a page has to be indexed before it can be copied", async () => {
    const root = await fixtureMirror();
    const { runtime } = harness();
    await expect(run(["mirror", "page", DOCUMENT_ID, "2", "--mirror-dir", root, "--output", join(root, "p.png")], runtime))
      .rejects.toThrow("Run rmcli mirror index first");
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

async function fixtureMirror(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rmcli-mirror-test-"));
  temporaryDirectories.push(directory);
  const root = join(directory, "mirror");
  await mkdir(join(root, "xochitl"), { recursive: true });
  await writeFile(join(root, "xochitl", `${DOCUMENT_ID}.metadata`), JSON.stringify({
    visibleName: "Poznámky",
    type: "DocumentType",
    parent: "",
    lastModified: "1700000000000",
  }));
  await writeFile(join(root, "xochitl", `${DOCUMENT_ID}.content`), JSON.stringify({ fileType: "notebook", cPages: { pages: [] } }));
  await writeFile(join(root, "state.json"), JSON.stringify({
    schemaVersion: 1,
    finishedAt: "2026-08-21T06:00:00.000Z",
    openDocument: { documentId: DOCUMENT_ID, pageNumber: 1 },
  }));
  return root;
}
