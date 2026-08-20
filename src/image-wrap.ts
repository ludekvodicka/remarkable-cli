import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";

import { PDFDocument, type PDFImage } from "pdf-lib";

import { CliError } from "./errors.js";

// The Paper Pro screen is 1620 x 2160. PDF points are arbitrary units the firmware rasterizes, so a
// page of those dimensions has exactly the display aspect and the image fills it without bands.
const PAGE_SHORT_SIDE = 1620;
const PAGE_LONG_SIDE = 2160;

export const IMAGE_EXTENSIONS: readonly string[] = [".png", ".jpg", ".jpeg"];

export interface WrappedImage {
  readonly pdfPath: string;
  readonly pageWidth: number;
  readonly pageHeight: number;
}

export function isImageExtension(extension: string): boolean {
  return IMAGE_EXTENSIONS.includes(extension);
}

// The tablet imports only PDF and EPUB, so an image becomes a one-page PDF first. This is local file
// preparation: it finishes before anything reaches the device, and the produced file passes the
// library source gate like any other PDF.
export async function wrapImageAsPdf(imagePath: string, pdfPath: string): Promise<WrappedImage> {
  const extension = extname(imagePath).toLowerCase();
  if (!isImageExtension(extension))
    throw new CliError(`Wrapping needs one of ${IMAGE_EXTENSIONS.join(", ")}, got ${extension === "" ? imagePath : extension}`);
  const bytes = await readFile(imagePath);
  const document = await PDFDocument.create();
  let image: PDFImage;
  try {
    if (extension === ".png") image = await document.embedPng(bytes);
    else if (extension === ".jpg" || extension === ".jpeg") image = await document.embedJpg(bytes);
    else
      throw new Error(`Unknown image extension: ${JSON.stringify(extension)}`);
  } catch (error) {
    throw new CliError(`${imagePath} is not a readable image: ${error instanceof Error ? error.message : String(error)}`);
  }
  const landscape = image.width > image.height;
  const pageWidth = landscape ? PAGE_LONG_SIDE : PAGE_SHORT_SIDE;
  const pageHeight = landscape ? PAGE_SHORT_SIDE : PAGE_LONG_SIDE;
  const page = document.addPage([pageWidth, pageHeight]);
  const scale = Math.min(pageWidth / image.width, pageHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height });
  await mkdir(dirname(pdfPath), { recursive: true });
  await writeFile(pdfPath, await document.save());
  return { pdfPath, pageWidth, pageHeight };
}
