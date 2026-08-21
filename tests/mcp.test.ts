import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { openMirrorIndex } from "rmindex-ts";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../src/commands/mcp.js";

const DOCUMENT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("mcp server over the mirror", () => {
  it("exposes exactly the read-only tool set", async () => {
    const { client, close } = await connected();
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name).sort();
      expect(names).toEqual([
        "get_document",
        "get_open_document",
        "get_page_image",
        "list_documents",
        "mirror_status",
        "search",
      ]);
    } finally {
      await close();
    }
  });

  it("answers search and get_document from the mirror", async () => {
    const { client, close } = await connected();
    try {
      const hits = JSON.parse(textOf(await client.callTool({ name: "search", arguments: { query: "poznamky" } })));
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ documentId: DOCUMENT_ID, path: "Poznámky" });

      const document = JSON.parse(textOf(await client.callTool({
        name: "get_document",
        arguments: { documentId: DOCUMENT_ID },
      })));
      expect(document).toMatchObject({ id: DOCUMENT_ID, name: "Poznámky", type: "document" });

      const missing = await client.callTool({ name: "get_document", arguments: { documentId: "no-such-id" } });
      expect(missing.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("returns a page image only for a page that was rendered", async () => {
    const { client, close, root } = await connected();
    try {
      const absent = await client.callTool({
        name: "get_page_image",
        arguments: { documentId: DOCUMENT_ID, pageNumber: 9 },
      });
      expect(absent.isError).toBe(true);

      await mkdir(join(root, "derived", "pages", DOCUMENT_ID), { recursive: true });
      await writeFile(join(root, "derived", "pages", DOCUMENT_ID, "1.png"), PNG);
      const image = await client.callTool({
        name: "get_page_image",
        arguments: { documentId: DOCUMENT_ID, pageNumber: 1 },
      });
      const content = (image.content as { type: string; mimeType?: string; data?: string }[])[0];
      expect(content?.type).toBe("image");
      expect(content?.mimeType).toBe("image/png");
      expect(Buffer.from(content?.data ?? "", "base64")).toEqual(PNG);
    } finally {
      await close();
    }
  });

  it("refuses a document id that tries to walk out of the mirror", async () => {
    const { client, close } = await connected();
    try {
      const escaped = await client.callTool({
        name: "get_page_image",
        arguments: { documentId: "../../etc", pageNumber: 1 },
      });
      expect(escaped.isError).toBe(true);
    } finally {
      await close();
    }
  });
});

function textOf(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content.map((entry) => entry.text ?? "").join("");
}

async function connected(): Promise<{
  readonly client: Client;
  readonly root: string;
  readonly close: () => Promise<void>;
}> {
  const root = await fixtureMirror();
  const index = openMirrorIndex(root);
  index.rebuild();
  const server = buildServer(root, index);
  const client = new Client({ name: "test", version: "0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    root,
    close: async () => {
      await client.close();
      await server.close();
      index.close();
    },
  };
}

async function fixtureMirror(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rmcli-mcp-test-"));
  temporaryDirectories.push(directory);
  const root = join(directory, "mirror");
  await mkdir(join(root, "xochitl"), { recursive: true });
  await writeFile(join(root, "xochitl", `${DOCUMENT_ID}.metadata`), JSON.stringify({
    visibleName: "Poznámky",
    type: "DocumentType",
    parent: "",
    lastModified: "1700000000000",
  }));
  await writeFile(join(root, "xochitl", `${DOCUMENT_ID}.content`), JSON.stringify({
    fileType: "notebook",
    cPages: { pages: [{ id: "page-1" }] },
  }));
  await writeFile(join(root, "state.json"), JSON.stringify({
    schemaVersion: 1,
    finishedAt: "2026-08-21T06:00:00.000Z",
    openDocument: { documentId: DOCUMENT_ID, pageNumber: 1 },
  }));
  return root;
}
