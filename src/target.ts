import { resolve } from "node:path";

import { inspectRmdoc, type DocumentPage, type OpenDocument } from "rmcommunication-ts";

import type { CliContext } from "./context.js";
import { CliError } from "./errors.js";

export interface ResolvedDocument {
  readonly documentId: string;
  /** Carried so a `current` page token does not ask the tablet a second time. */
  readonly open: OpenDocument | null;
}

export interface ResolvedArchive {
  readonly archivePath: string;
  readonly pages: readonly DocumentPage[];
  readonly downloaded: boolean;
}

export async function resolveDocument(context: CliContext, token: string): Promise<ResolvedDocument> {
  if (token !== "current") return { documentId: token, open: null };
  const open = await context.withDevice(async (device) => await device.readOpenDocument());
  if (open.documentId === null)
    throw new CliError("Nothing is open on the tablet; it is showing the library list");
  return { documentId: open.documentId, open };
}

export async function resolveArchive(context: CliContext, documentId: string): Promise<ResolvedArchive> {
  const archive = context.options.optional("archive");
  const backupDirectory = context.options.optional("backup-dir");
  if (archive !== null && backupDirectory !== null) throw new CliError("Give either --archive or --backup-dir, not both");
  if (archive !== null) {
    const inspection = await inspectRmdoc(archive, documentId);
    return { archivePath: resolve(archive), pages: inspection.document.pages, downloaded: false };
  }
  if (backupDirectory === null)
    throw new CliError("Missing --backup-dir, or pass --archive <file.rmdoc> to reuse a download you already have");
  const backup = await context.withWeb(async (web) =>
    await web.downloadDocument({ documentId, backupDirectory: resolve(backupDirectory) }));
  return { archivePath: backup.archivePath, pages: backup.document.pages, downloaded: true };
}

// A page is named the way a person would say it: the number printed on the tablet, the word `current`,
// or the page ID that machines pass around.
export async function resolvePage(
  context: CliContext,
  document: ResolvedDocument,
  pages: readonly DocumentPage[],
  token: string,
): Promise<DocumentPage> {
  if (token === "current") return await currentPage(context, document, pages);
  if (/^[0-9]+$/.test(token)) {
    const page = pages.find((candidate) => candidate.number === Number(token));
    if (page === undefined) throw new CliError(`The document has ${pages.length} page(s), so page ${token} does not exist`);
    return page;
  }
  const page = pages.find((candidate) => candidate.id === token);
  if (page === undefined)
    throw new CliError(
      `Give a page number from 1 to ${pages.length}, the word current, or a page ID from \`rmcli pages list\`; got ${token}`,
    );
  return page;
}

async function currentPage(
  context: CliContext,
  document: ResolvedDocument,
  pages: readonly DocumentPage[],
): Promise<DocumentPage> {
  const open = document.open ?? await context.withDevice(async (device) => await device.readOpenDocument());
  if (open.documentId !== document.documentId)
    throw new CliError(
      `The tablet has ${open.documentId ?? "no document"} open, not ${document.documentId}, so it has no current page there`,
    );
  if (open.pageId === null) throw new CliError("The tablet did not report which page is open");
  const page = pages.find((candidate) => candidate.id === open.pageId);
  if (page === undefined)
    throw new CliError(`The open page ${open.pageId} is not in the downloaded copy; download the document again`);
  return page;
}
