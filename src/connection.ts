import { exec } from "node:child_process";
import { promisify } from "node:util";

import { connectDevice, connectWebInterfaceOverSsh, UnknownHostKeyError, wifiProfile } from "rmcommunication-ts";
import type { ConnectionProfile, Device, WebInterfaceClient } from "rmcommunication-ts";

import { CliError } from "./errors.js";

export interface DeviceSettings {
  readonly host: string;
  /** Null until the operator has pinned one; only `device fingerprint` may run without it. */
  readonly fingerprint: string | null;
  readonly requestTimeoutMs: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 180_000;
const run = promisify(exec);

export function readSettings(env: NodeJS.ProcessEnv): DeviceSettings {
  const host = required(env, "RMCLI_HOST");
  const fingerprint = env.RMCLI_FINGERPRINT ?? null;
  if (fingerprint !== null && !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint))
    throw new CliError(`RMCLI_FINGERPRINT must be a base64 SHA256 host key, got ${fingerprint}`);
  const timeout = env.RMCLI_TIMEOUT_MS === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : Number(env.RMCLI_TIMEOUT_MS);
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 600_000)
    throw new CliError("RMCLI_TIMEOUT_MS must be an integer from 1000 to 600000");
  return { host, fingerprint, requestTimeoutMs: timeout };
}

export function deviceProfile(settings: DeviceSettings, env: NodeJS.ProcessEnv): ConnectionProfile {
  if (settings.fingerprint === null)
    throw new CliError(
      "Missing RMCLI_FINGERPRINT. Run `rmcli device fingerprint` to read the tablet's host key,"
      + " check it against the tablet, then export it.",
    );
  return wifiProfile({
    host: settings.host,
    authentication: { kind: "password", password: passwordProvider(env) },
    hostKey: { kind: "pinned", fingerprint: settings.fingerprint },
  });
}

// Refusing every offered key turns the connection into a read of the host key: `verifyHost` raises
// UnknownHostKeyError carrying the fingerprint, and nothing is ever trusted implicitly.
export async function readHostFingerprint(
  settings: DeviceSettings,
  env: NodeJS.ProcessEnv,
): Promise<{ readonly host: string; readonly fingerprint: string }> {
  const profile = wifiProfile({
    host: settings.host,
    authentication: { kind: "password", password: passwordProvider(env) },
    hostKey: { kind: "confirmUnknown", confirm: () => false },
  });
  try {
    const device = await connectDevice(profile);
    await device.close();
  } catch (error) {
    if (error instanceof UnknownHostKeyError) return { host: error.host, fingerprint: error.fingerprint };
    throw error;
  }
  throw new CliError(`The tablet at ${settings.host} accepted a connection without offering a host key`);
}

// The password reaches the profile through a provider so it is never a process argument and never
// part of a printed error. RMCLI_PASSWORD_COMMAND lets a password manager supply it instead: its
// stdout is read here and nowhere else.
function passwordProvider(env: NodeJS.ProcessEnv): () => Promise<string> {
  let cached: string | null = env.RMCLI_PASSWORD ?? null;
  const command = env.RMCLI_PASSWORD_COMMAND ?? null;
  delete env.RMCLI_PASSWORD;
  return async () => {
    cached ??= await commandPassword(command);
    return cached;
  };
}

export async function withDevice<T>(profile: ConnectionProfile, operation: (device: Device) => Promise<T>): Promise<T> {
  const device = await connectDevice(profile);
  try {
    return await operation(device);
  } finally {
    await device.close();
  }
}

export async function withWebInterface<T>(
  profile: ConnectionProfile,
  requestTimeoutMs: number,
  operation: (web: WebInterfaceClient) => Promise<T>,
): Promise<T> {
  const web = await connectWebInterfaceOverSsh({ ssh: profile, requestTimeoutMs });
  try {
    return await operation(web);
  } finally {
    await web.close();
  }
}

async function commandPassword(command: string | null): Promise<string> {
  if (command === null)
    throw new CliError(
      "Missing RMCLI_PASSWORD. Set it, or set RMCLI_PASSWORD_COMMAND to a command that prints the"
      + " tablet password on stdout.",
    );
  let stdout: string;
  try {
    ({ stdout } = await run(command, { encoding: "utf8", maxBuffer: 64 * 1024 }));
  } catch {
    // The command line can carry credentials of its own, so it stays out of the message.
    throw new CliError("RMCLI_PASSWORD_COMMAND failed. Set RMCLI_PASSWORD instead.");
  }
  const password = stdout.trim();
  if (password.length === 0) throw new CliError("RMCLI_PASSWORD_COMMAND printed no password");
  return password;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value.length === 0) throw new CliError(`Missing ${name}`);
  return value;
}
