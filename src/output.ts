import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface OutputStreams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

export const processStreams: OutputStreams = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

export function emit(streams: OutputStreams, json: boolean, value: unknown, human: () => string): void {
  streams.out(json ? `${JSON.stringify(value, replacer, 2)}\n` : `${human()}\n`);
}

// Binary output always lands in a file. Writing an image to stdout would push it straight into the
// context of whatever agent invoked the command.
export async function writeBinary(path: string, bytes: Uint8Array): Promise<string> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  return absolute;
}

// Epoch milliseconds are what the firmware gives; the readable form saves every caller a conversion.
export function isoTime(milliseconds: number | null): string | null {
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

export function table(rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return "";
  const widths = rows[0]?.map((_, column) => Math.max(...rows.map((row) => (row[column] ?? "").length))) ?? [];
  return rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join("  ").trimEnd()).join("\n");
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
  return value;
}
