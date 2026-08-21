import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openMirrorIndex, pageImagePath, type MirrorIndex } from "rmindex-ts";
import { z } from "zod";

import type { Command } from "../context.js";
import { mirrorDirectory } from "./mirror.js";

export const mcpServe: Command = {
  path: ["mcp", "serve"],
  summary: "Serve the local mirror to an MCP client, read-only",
  usage: "rmcli mcp serve --mirror-dir <dir>",
  options: ["mirror-dir"],
  positionals: [],
  interrupts: false,
  local: true,
  longLived: true,
  async run(context) {
    const root = mirrorDirectory(context);
    const index = openMirrorIndex(root);
    const server = buildServer(root, index);
    try {
      // stdout carries the protocol from here on, so nothing else may print to it.
      await server.connect(new StdioServerTransport());
      await new Promise<void>((resolve) => {
        process.once("SIGINT", resolve);
        process.once("SIGTERM", resolve);
        process.stdin.once("close", resolve);
      });
    } finally {
      await server.close().catch(() => undefined);
      index.close();
    }
  },
};

// Read-only by construction: every tool reads the local mirror, none of them opens a device
// connection, and there is deliberately no sync, write or delete tool and no escape hatch.
export function buildServer(mirrorRoot: string, index: MirrorIndex): McpServer {
  const server = new McpServer({ name: "rmcli-mirror", version: "0.2.0" });

  server.registerTool("search", {
    description: "Search the mirrored tablet by document name, folder path and typed page text.",
    inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(200).optional() },
  }, async ({ query, limit }) => json(index.search(query, limit === undefined ? {} : { limit }).map((hit) => ({
    documentId: hit.document.id,
    path: hit.document.path,
    pageNumber: hit.pageNumber,
    excerpt: hit.excerpt,
  }))));

  server.registerTool("list_documents", {
    description: "List every document and folder in the mirror, with its folder path.",
    inputSchema: {},
  }, async () => json(index.listDocuments()));

  server.registerTool("get_document", {
    description: "Details of one document in the mirror.",
    inputSchema: { documentId: z.string().min(1) },
  }, async ({ documentId }) => {
    const document = index.getDocument(documentId);
    return document === null ? failure(`The mirror has no document ${documentId}`) : json(document);
  });

  server.registerTool("get_page_image", {
    description: "The rendered image of one page, addressed by the page number the tablet prints.",
    inputSchema: { documentId: z.string().min(1), pageNumber: z.number().int().min(1) },
  }, async ({ documentId, pageNumber }) => {
    const path = pageImagePath(mirrorRoot, documentId, pageNumber);
    if (!existsSync(path)) return failure(`Page ${pageNumber} of ${documentId} has not been indexed yet`);
    const bytes = await readFile(path);
    return { content: [{ type: "image" as const, data: bytes.toString("base64"), mimeType: "image/png" }] };
  });

  server.registerTool("get_open_document", {
    description: "Which document the tablet had open at the last sync. This is mirrored state, not live.",
    inputSchema: {},
  }, async () => json(index.openDocument()));

  server.registerTool("mirror_status", {
    description: "How much the mirror holds and when it was last synced.",
    inputSchema: {},
  }, async () => {
    const documents = index.listDocuments();
    return json({
      documents: documents.filter((document) => document.type === "document").length,
      folders: documents.filter((document) => document.type === "folder").length,
      openDocument: index.openDocument(),
    });
  });

  return server;
}

function json(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function failure(message: string): { content: { type: "text"; text: string }[]; isError: true } {
  return { content: [{ type: "text", text: message }], isError: true };
}
