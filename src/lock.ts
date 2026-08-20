import { mkdir, open, readFile, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CliError } from "./errors.js";

// A holder that is created but not yet written gets this long to write its PID before its lock counts
// as abandoned.
const PID_WRITE_GRACE_MS = 100;

// Folder targeting is global tablet state: the selecting listing and the upload must not be
// interleaved by another process. One lock per host serializes invocations on this machine.
// Races between machines are not covered and remain the backend's job.
export async function withDeviceLock<T>(host: string, operation: () => Promise<T>): Promise<T> {
  const directory = join(tmpdir(), "rmcli-locks");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${host.replaceAll(/[^A-Za-z0-9._-]/g, "_")}.lock`);
  const handle = await acquire(path, host);
  try {
    await handle.writeFile(`${process.pid}\n`, "utf8");
    return await operation();
  } finally {
    await handle.close();
    await rm(path, { force: true });
  }
}

// A run that is killed cannot release its lock, and a lock nobody holds used to block every later run
// until someone deleted the file by hand. The holder PID decides: alive means wait, gone means take over.
async function acquire(path: string, host: string): Promise<FileHandle> {
  try {
    return await open(path, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const holder = await readHolder(path);
  if (holder !== null && isRunning(holder)) throw heldError(host, holder);
  await rm(path, { force: true });
  try {
    return await open(path, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw heldError(host, await readHolder(path));
  }
}

async function readHolder(path: string): Promise<number | null> {
  const first = parsePid(await readLockFile(path));
  if (first !== null) return first;
  await delay(PID_WRITE_GRACE_MS);
  return parsePid(await readLockFile(path));
}

async function readLockFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function parsePid(contents: string): number | null {
  const pid = Number.parseInt(contents.trim(), 10);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM is a live process this user may not signal. Only ESRCH proves the holder is gone.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function heldError(host: string, pid: number | null): CliError {
  return new CliError(
    `Another rmcli run${pid === null ? "" : ` (PID ${pid})`} holds the lock for ${host}. Wait for it to finish.`,
  );
}
