import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Device, WebImportProgress, WebInterfaceClient } from "rmcommunication-ts";
import { afterEach, describe, expect, it } from "vitest";

import { run, type Runtime } from "../src/run.js";
import { pngBytes } from "./support/png.js";

const DOCUMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff";
const PAGE_ID = "11111111-2222-4333-8444-555555555555";
const SECOND_PAGE_ID = "11111111-2222-4333-8444-666666666666";
const OBSERVED_AT = "2026-08-17T14:00:00.000Z";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("command dispatch", () => {
  it("prints the document listing as stable JSON", async () => {
    const { runtime, out } = harness();
    await run(["documents", "list", "--json"], runtime);
    expect(JSON.parse(out.join(""))).toEqual([
      {
        id: DOCUMENT_ID,
        name: "Sketches",
        type: "document",
        fileType: "notebook",
        parentId: null,
        bookmarked: false,
        currentPageNumber: 1,
        modifiedMs: 1_700_000_000_000,
        modified: "2023-11-14T22:13:20.000Z",
      },
    ]);
  });

  it("prints a human table when --json is absent", async () => {
    const { runtime, out } = harness();
    await run(["documents", "list"], runtime);
    expect(out.join("")).toContain("ID");
    expect(out.join("")).toContain("Sketches");
  });

  it("uploads with the requested folder and rejects an unsupported extension", async () => {
    const { runtime, uploads } = harness();
    await run([
      "documents", "upload", "deck.pdf",
      "--name", "Deck", "--backup-dir", "backups", "--folder", "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb", "--json",
    ], runtime);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      kind: "pdf",
      sourcePath: resolve("deck.pdf"),
      name: "Deck",
      backupDirectory: resolve("backups"),
      parentId: "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb",
    });

    await expect(run(["documents", "upload", "deck.txt", "--name", "x", "--backup-dir", "b"], harness().runtime))
      .rejects.toThrow("needs a .pdf, .epub or image (.png, .jpg, .jpeg) file");
  });

  it("wraps an image into a one-page PDF and uploads that", async () => {
    const directory = await temporaryRoot();
    const imagePath = join(directory, "shot.png");
    await writeFile(imagePath, pngBytes(30, 40));
    const backupDirectory = join(directory, "backups");
    const { runtime, uploads, err } = harness();

    await run(["documents", "upload", imagePath, "--name", "Shot", "--backup-dir", backupDirectory, "--json"], runtime);

    const wrappedPath = join(backupDirectory, "shot.png.wrapped.pdf");
    expect(uploads[0]).toMatchObject({ kind: "pdf", sourcePath: wrappedPath, name: "Shot" });
    expect((await readFile(wrappedPath)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(err.join("")).toContain("wrapped shot.png into");
    expect(err.join("")).toContain("1620 x 2160 pt");
  });

  it("prints upload progress on stderr and keeps JSON stdout clean", async () => {
    const { runtime, out, err } = harness();
    await run(["documents", "upload", "deck.pdf", "--name", "Deck", "--backup-dir", "backups", "--json"], runtime);

    expect(JSON.parse(out.join(""))).toMatchObject({ documentId: DOCUMENT_ID });
    expect(err.join("")).toBe([
      "connected to the tablet",
      "uploaded 500 of 1000 bytes",
      "uploaded 1000 of 1000 bytes",
      "waiting for the tablet to file the document",
      `verifying candidate ${DOCUMENT_ID}`,
      "",
    ].join("\n"));
  });

  it("hands the library absolute paths even when the caller passes relative ones", async () => {
    const { runtime, downloads } = harness();
    await run(["documents", "download", DOCUMENT_ID, "--backup-dir", "./backups", "--json"], runtime);
    expect(downloads).toEqual([{ documentId: DOCUMENT_ID, backupDirectory: resolve("./backups") }]);
  });

  it("writes a template to the requested file instead of stdout", async () => {
    const directory = await temporaryRoot();
    const output = join(directory, "nested", "template.json");
    const { runtime, out } = harness();
    await run(["templates", "read", "Blank", "--output", output], runtime);
    expect(JSON.parse(await readFile(output, "utf8"))).toEqual({ items: [] });
    expect(out.join("")).toContain(output);
  });

  it("refuses a service command until --service is repeated", async () => {
    const { runtime } = harness();
    await expect(run(["service", "mirror", "--mirror-dir", "out"], runtime)).rejects.toThrow("interrupts the tablet UI");
    await run(["service", "mirror", "--mirror-dir", "out", "--service", "--json"], runtime);
  });

  it("rejects an unknown command and an unknown option", async () => {
    const { runtime } = harness();
    await expect(run(["documents", "purge"], runtime)).rejects.toThrow("Unknown command: documents purge");
    await expect(run(["documents", "list", "--verbose"], runtime)).rejects.toThrow("Unknown option: --verbose");
  });

  it("validates the render output extension before connecting", async () => {
    const { runtime, downloads } = harness();
    await expect(run(["pages", "render", DOCUMENT_ID, PAGE_ID, "--output", "page.jpg", "--backup-dir", "b"], runtime))
      .rejects.toThrow("must end in .svg or .png");
    expect(downloads).toEqual([]);
  });

  it("lists pages numbered from one while index keeps its gap", async () => {
    const { runtime, out, downloads } = harness();
    await run(["pages", "list", DOCUMENT_ID, "--backup-dir", "backups", "--json"], runtime);
    expect(downloads).toEqual([{ documentId: DOCUMENT_ID, backupDirectory: resolve("backups") }]);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.downloaded).toBe(true);
    expect(parsed.pages).toEqual([
      {
        id: PAGE_ID,
        number: 1,
        index: 0,
        idx: "ba",
        template: "Blank",
        modifiedMs: 1_700_000_000_000,
        modified: "2023-11-14T22:13:20.000Z",
      },
      { id: SECOND_PAGE_ID, number: 2, index: 2, idx: "bc", template: "Grid", modifiedMs: null, modified: null },
    ]);
  });

  it("keeps the raw CRDT entry out of the listing unless --raw is given", async () => {
    const { runtime, out } = harness();
    await run(["pages", "list", DOCUMENT_ID, "--backup-dir", "backups", "--raw", "--json"], runtime);
    expect(JSON.parse(out.join("")).pages[0].raw).toEqual({ id: PAGE_ID });
  });

  it("resolves `current` to the document the tablet has open", async () => {
    const { runtime, downloads } = harness();
    await run(["pages", "list", "current", "--backup-dir", "backups", "--json"], runtime);
    expect(downloads).toEqual([{ documentId: DOCUMENT_ID, backupDirectory: resolve("backups") }]);
  });

  it("reports what the tablet has open", async () => {
    const { runtime, out } = harness();
    await run(["documents", "current", "--json"], runtime);
    expect(JSON.parse(out.join(""))).toEqual({
      documentId: DOCUMENT_ID,
      name: "Sketches",
      pageId: SECOND_PAGE_ID,
      pageNumber: 2,
      pageIndex: 2,
      pageCount: 2,
      observedAt: OBSERVED_AT,
    });
  });

  it("rejects a page that does not exist and an unreadable page token", async () => {
    const { runtime } = harness();
    await expect(run(["pages", "render", DOCUMENT_ID, "9", "--output", "p.png", "--backup-dir", "b"], runtime))
      .rejects.toThrow("so page 9 does not exist");
    await expect(run(["pages", "render", DOCUMENT_ID, "nonsense", "--output", "p.png", "--backup-dir", "b"], harness().runtime))
      .rejects.toThrow("Give a page number from 1 to 2");
    await expect(run(["pages", "render", OTHER_ID, "current", "--output", "p.png", "--backup-dir", "b"], harness().runtime))
      .rejects.toThrow("has no current page there");
  });

  it("refuses --width for SVG output and refuses two archive sources", async () => {
    const { runtime, downloads } = harness();
    await expect(run(["pages", "render", DOCUMENT_ID, "1", "--output", "p.svg", "--backup-dir", "b", "--width", "100"], runtime))
      .rejects.toThrow("only applies to a .png output");
    await expect(run(["pages", "list", DOCUMENT_ID, "--backup-dir", "b", "--archive", "a.rmdoc"], harness().runtime))
      .rejects.toThrow("either --archive or --backup-dir");
    await expect(run(["pages", "list", DOCUMENT_ID, "--json"], harness().runtime)).rejects.toThrow("Missing --backup-dir");
    expect(downloads).toEqual([]);
  });

  it("reads an existing archive instead of downloading again", async () => {
    const { runtime, downloads } = harness();
    await expect(run(["pages", "list", DOCUMENT_ID, "--archive", "missing.rmdoc", "--json"], runtime)).rejects.toThrow();
    expect(downloads).toEqual([]);
  });

  it("reports the host fingerprint without pinning it", async () => {
    const { runtime, out } = harness();
    await run(["device", "fingerprint"], runtime);
    expect(out.join("")).toContain(`SHA256:${"A".repeat(43)}`);
    expect(out.join("")).toContain("Check this against the tablet");
  });

  it("prints help without touching the device", async () => {
    const { runtime, out } = harness();
    await run(["--help"], runtime);
    expect(out.join("")).toContain("Commands that stop and restart Xochitl");
  });
});

function harness(): {
  readonly runtime: Runtime;
  readonly out: string[];
  readonly err: string[];
  readonly uploads: unknown[];
  readonly downloads: unknown[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const uploads: unknown[] = [];
  const downloads: unknown[] = [];
  const backup = {
    archivePath: "backups/fixture.rmdoc",
    archiveBytes: 1234,
    archiveSha256: "a".repeat(64),
    revision: "b".repeat(64),
    source: { fileType: "pdf", size: 950, sha256: "c".repeat(64) },
    document: {
      id: DOCUMENT_ID,
      name: "Sketches",
      parentId: null,
      fileType: "notebook",
      // The second page carries index 2 because a deleted page sits between them; `number` stays contiguous.
      pages: [
        { id: PAGE_ID, index: 0, number: 1, idx: "ba", template: "Blank", modifiedMs: 1_700_000_000_000, raw: { id: PAGE_ID } },
        { id: SECOND_PAGE_ID, index: 2, number: 2, idx: "bc", template: "Grid", modifiedMs: null, raw: { id: SECOND_PAGE_ID } },
      ],
    },
  };
  const web = {
    listDocuments: async () => [
      {
        id: DOCUMENT_ID,
        name: "Sketches",
        type: "document",
        fileType: "notebook",
        parentId: null,
        bookmarked: false,
        currentPage: 0,
        modifiedMs: 1_700_000_000_000,
      },
    ],
    downloadDocument: async (request: { documentId: string; backupDirectory: string }) => {
      downloads.push({ documentId: request.documentId, backupDirectory: request.backupDirectory });
      return backup;
    },
    importPdf: async (request: Record<string, unknown>) => {
      uploads.push({ kind: "pdf", ...request });
      reportScriptedProgress(request);
      return { documentId: DOCUMENT_ID, name: "Deck", parentId: null, pages: [], receipt: { archivePath: "x" } };
    },
    importEpub: async (request: Record<string, unknown>) => {
      uploads.push({ kind: "epub", ...request });
      reportScriptedProgress(request);
      return { documentId: DOCUMENT_ID, name: "Book", parentId: null, pages: [], receipt: { archivePath: "x" } };
    },
  } as unknown as WebInterfaceClient;
  const device = {
    identity: async () => ({ deviceId: "RM02" }),
    runtimeObservation: async () => ({ uptimeSeconds: 1, xochitlPid: 422, xochitlService: "active" }),
    probeCapabilities: async () => ({ read: true }),
    enableWifiSsh: async () => undefined,
    readOpenDocument: async () => ({
      documentId: DOCUMENT_ID,
      name: "Sketches",
      pageId: SECOND_PAGE_ID,
      pageNumber: 2,
      pageIndex: 2,
      pageCount: 2,
      observedAt: OBSERVED_AT,
    }),
    listDocuments: async () => [],
    readPage: async () => ({ documentId: DOCUMENT_ID, pageId: PAGE_ID, bytes: new Uint8Array([1]), revision: "r" }),
    readTemplate: async () => ({ items: [] }),
    snapshotDocument: async () => ({ documentId: DOCUMENT_ID }),
    mirrorDocuments: async () => ({ generation: "1" }),
    writePage: async () => ({ documentId: DOCUMENT_ID }),
  } as unknown as Device;
  return {
    out,
    err,
    uploads,
    downloads,
    runtime: {
      streams: { out: (text) => out.push(text), err: (text) => err.push(text) },
      withWeb: async (operation) => await operation(web),
      withDevice: async (operation) => await operation(device),
      discoverFingerprint: async () => ({ host: "10.0.0.1", fingerprint: `SHA256:${"A".repeat(43)}` }),
    },
  };
}

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rmcli-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

// The library reports these phases while it uploads; the CLI turns them into stderr lines.
function reportScriptedProgress(request: Record<string, unknown>): void {
  const onProgress = request.onProgress;
  if (typeof onProgress !== "function") return;
  const report = onProgress as (progress: WebImportProgress) => void;
  report({ phase: "connected" });
  report({ phase: "uploading", sentBytes: 500, totalBytes: 1000 });
  report({ phase: "uploading", sentBytes: 1000, totalBytes: 1000 });
  report({ phase: "processing" });
  report({ phase: "verifying", candidateId: DOCUMENT_ID });
}
