import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PDFDocument } from "pdf-lib";
import { afterEach, describe, expect, it } from "vitest";

import { wrapImageAsPdf } from "../src/image-wrap.js";
import { pngBytes } from "./support/png.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("image wrapping", () => {
  it("wraps a portrait PNG into one tablet-sized page", async () => {
    const directory = await temporaryRoot();
    const imagePath = join(directory, "shot.png");
    await writeFile(imagePath, pngBytes(40, 60));
    const pdfPath = join(directory, "nested", "shot.png.wrapped.pdf");

    const wrapped = await wrapImageAsPdf(imagePath, pdfPath);

    expect(wrapped).toEqual({ pdfPath, pageWidth: 1620, pageHeight: 2160 });
    const bytes = await readFile(pdfPath);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.subarray(-32).toString("latin1")).toContain("%%EOF");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    const page = parsed.getPage(0);
    expect([Math.round(page.getWidth()), Math.round(page.getHeight())]).toEqual([1620, 2160]);
  });

  it("turns the page for a landscape image", async () => {
    const directory = await temporaryRoot();
    const imagePath = join(directory, "wide.png");
    await writeFile(imagePath, pngBytes(80, 45));
    const pdfPath = join(directory, "wide.png.wrapped.pdf");

    const wrapped = await wrapImageAsPdf(imagePath, pdfPath);

    expect([wrapped.pageWidth, wrapped.pageHeight]).toEqual([2160, 1620]);
    const page = (await PDFDocument.load(await readFile(pdfPath))).getPage(0);
    expect([Math.round(page.getWidth()), Math.round(page.getHeight())]).toEqual([2160, 1620]);
  });

  it("refuses bytes that are not the image the extension claims", async () => {
    const directory = await temporaryRoot();
    const imagePath = join(directory, "broken.png");
    await writeFile(imagePath, Buffer.from("not a png at all"));

    await expect(wrapImageAsPdf(imagePath, join(directory, "broken.pdf")))
      .rejects.toThrow(/broken\.png is not a readable image/);
    await expect(readFile(join(directory, "broken.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a file that is not an image at all", async () => {
    const directory = await temporaryRoot();
    const path = join(directory, "notes.txt");
    await writeFile(path, "text");

    await expect(wrapImageAsPdf(path, join(directory, "notes.pdf"))).rejects.toThrow(".png, .jpg, .jpeg");
  });
});

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "rmcli-image-wrap-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
