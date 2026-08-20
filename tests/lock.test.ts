import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { withDeviceLock } from "../src/lock.js";

const lockFiles: string[] = [];

afterEach(async () => {
  for (const path of lockFiles.splice(0)) await rm(path, { force: true });
});

describe("device lock", () => {
  it("takes over the lock of a run that is gone", async () => {
    const host = uniqueHost();
    const dead = await exitedProcessId();
    await writeLock(host, `${dead}\n`);

    await expect(withDeviceLock(host, async () => "ran")).resolves.toBe("ran");
    await expect(readFile(lockPath(host), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("takes over a lock file that never got a PID", async () => {
    const host = uniqueHost();
    await writeLock(host, "");

    await expect(withDeviceLock(host, async () => "ran")).resolves.toBe("ran");
  });

  it("reports a live holder with its PID and leaves the lock alone", async () => {
    const host = uniqueHost();
    await writeLock(host, `${process.pid}\n`);

    await expect(withDeviceLock(host, async () => "ran")).rejects.toThrow(`PID ${process.pid}`);
    expect(await readFile(lockPath(host), "utf8")).toContain(String(process.pid));
  });

  it("serializes two runs on the same host and releases afterwards", async () => {
    const host = uniqueHost();
    let inner: unknown = null;
    await withDeviceLock(host, async () => {
      inner = await withDeviceLock(host, async () => "nested").catch((error: unknown) => error);
    });

    expect(inner).toBeInstanceOf(Error);
    expect((inner as Error).message).toContain(`PID ${process.pid}`);
    await expect(withDeviceLock(host, async () => "ran")).resolves.toBe("ran");
  });
});

function uniqueHost(): string {
  const host = `192.0.2.${Math.floor(Math.random() * 250) + 1}-${process.pid}-${lockFiles.length}`;
  lockFiles.push(lockPath(host));
  return host;
}

function lockPath(host: string): string {
  return join(tmpdir(), "rmcli-locks", `${host.replaceAll(/[^A-Za-z0-9._-]/g, "_")}.lock`);
}

async function writeLock(host: string, contents: string): Promise<void> {
  await mkdir(join(tmpdir(), "rmcli-locks"), { recursive: true });
  await writeFile(lockPath(host), contents, "utf8");
}

async function exitedProcessId(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("Test child process has no PID");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return pid;
}
