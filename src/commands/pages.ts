import { extname } from "node:path";

import { renderRmdocPage, svgToPng } from "rmcommunication-ts";
import type { DocumentPage, PageSvgOptions } from "rmcommunication-ts";

import { requirePositionals } from "../args.js";
import type { CliContext, Command } from "../context.js";
import { CliError } from "../errors.js";
import { emit, isoTime, table, writeBinary } from "../output.js";
import { resolveArchive, resolveDocument, resolvePage } from "../target.js";

export const pagesList: Command = {
  path: ["pages", "list"],
  summary: "List the pages of a document, numbered the way the tablet numbers them",
  usage: "rmcli pages list <documentId|current> --backup-dir <dir> | --archive <file.rmdoc> [--raw] [--json]",
  options: ["backup-dir", "archive", "raw"],
  positionals: ["documentId"],
  interrupts: false,
  async run(context) {
    const [token] = requirePositionals(context.positionals, ["documentId"]) as [string];
    const document = await resolveDocument(context, token);
    const archive = await resolveArchive(context, document.documentId);
    const raw = context.options.flag("raw");
    const summary = {
      documentId: document.documentId,
      archivePath: archive.archivePath,
      downloaded: archive.downloaded,
      pages: archive.pages.map((page) => describePage(page, raw)),
    };
    emit(context.streams, context.json, summary, () =>
      table([
        ["PAGE", "INDEX", "PAGE ID", "TEMPLATE"],
        ...archive.pages.map((page) => [String(page.number), String(page.index), page.id, page.template ?? "-"]),
      ]));
  },
};

export const pagesRender: Command = {
  path: ["pages", "render"],
  summary: "Render one page to SVG or PNG without interrupting the tablet",
  usage: "rmcli pages render <documentId|current> <page|current|pageId> --output <file.svg|file.png>"
    + " --backup-dir <dir> | --archive <file.rmdoc>"
    + " [--template <name>] [--background white|transparent] [--width <px>] [--json]",
  options: ["output", "backup-dir", "archive", "template", "background", "width"],
  positionals: ["documentId", "page"],
  interrupts: false,
  async run(context) {
    const [documentToken, pageToken] = requirePositionals(context.positionals, ["documentId", "page"]) as [string, string];
    const output = context.options.require("output");
    const extension = extname(output).toLowerCase();
    if (extension !== ".svg" && extension !== ".png")
      throw new CliError(`--output must end in .svg or .png, got ${extension === "" ? output : extension}`);
    const background = context.options.optional("background") ?? "white";
    if (background !== "white" && background !== "transparent")
      throw new CliError(`--background must be white or transparent, got ${background}`);
    const width = context.options.optional("width");
    if (width !== null && extension === ".svg")
      throw new CliError("--width sets the raster size and only applies to a .png output");
    const templateName = context.options.optional("template");

    const document = await resolveDocument(context, documentToken);
    const archive = await resolveArchive(context, document.documentId);
    const page = await resolvePage(context, document, archive.pages, pageToken);
    const options: PageSvgOptions = {
      background,
      ...(templateName === null
        ? {}
        : { template: await readTemplate(context, templateName) }),
    };
    const rendered = await renderRmdocPage(archive.archivePath, document.documentId, page.id, options);
    const png = extension === ".png"
      ? await svgToPng(rendered.svg, width === null ? {} : { width: pixels(width) })
      : null;
    const bytes = png === null ? new TextEncoder().encode(rendered.svg) : png.bytes;
    const path = await writeBinary(output, bytes);
    const summary = {
      documentId: document.documentId,
      pageId: page.id,
      pageNumber: page.number,
      template: rendered.page.template,
      revision: rendered.page.revision,
      // SVG user units and raster pixels are unrelated numbers, so neither may stand in for the other.
      svg: { width: rendered.width, height: rendered.height },
      ...(png === null ? {} : { png: { width: png.width, height: png.height } }),
      templateWarnings: rendered.templateWarnings,
      archivePath: archive.archivePath,
      outputPath: path,
      outputBytes: bytes.byteLength,
    };
    emit(context.streams, context.json, summary, () =>
      `${path}\npage ${page.number}, ${bytes.byteLength} bytes`
      + (png === null ? "" : `, ${png.width}x${png.height} px`));
  },
};

async function readTemplate(context: CliContext, name: string) {
  return await context.withDevice(async (device) => await device.readTemplate(name));
}

function describePage(page: DocumentPage, raw: boolean): unknown {
  const described = {
    id: page.id,
    number: page.number,
    index: page.index,
    idx: page.idx,
    template: page.template,
    modifiedMs: page.modifiedMs,
    modified: isoTime(page.modifiedMs),
  };
  // The raw CRDT entry is several times the size of everything else and no caller reads it by default.
  return raw ? { ...described, raw: page.raw } : described;
}

function pixels(value: string): number {
  const width = Number(value);
  if (!Number.isInteger(width) || width < 1) throw new CliError(`--width must be a positive integer, got ${value}`);
  return width;
}
