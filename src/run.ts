import type { Device, WebInterfaceClient } from "rmcommunication-ts";

import { Options, parseArgs } from "./args.js";
import {
  documentsCurrent,
  documentsDownload,
  documentsGet,
  documentsList,
  documentsUpload,
} from "./commands/documents.js";
import {
  deviceCapabilities,
  deviceEnableWifiSsh,
  deviceFingerprint,
  deviceIdentity,
  deviceStatus,
  templatesRead,
} from "./commands/device.js";
import { mcpServe } from "./commands/mcp.js";
import { mirrorIndex, mirrorPage, mirrorSearch, mirrorStatus, mirrorSync, mirrorWatch } from "./commands/mirror.js";
import { pagesList, pagesRender } from "./commands/pages.js";
import {
  serviceDocumentsList,
  serviceMirror,
  servicePageRead,
  servicePageWrite,
  serviceSnapshot,
} from "./commands/service.js";
import type { Command } from "./context.js";
import { CliError } from "./errors.js";
import { table, type OutputStreams } from "./output.js";

export const COMMANDS: readonly Command[] = [
  deviceStatus,
  deviceFingerprint,
  deviceIdentity,
  deviceCapabilities,
  deviceEnableWifiSsh,
  documentsCurrent,
  documentsList,
  documentsGet,
  documentsDownload,
  documentsUpload,
  mirrorSync,
  mirrorWatch,
  mirrorIndex,
  mirrorSearch,
  mirrorPage,
  mirrorStatus,
  mcpServe,
  pagesList,
  pagesRender,
  templatesRead,
  serviceDocumentsList,
  servicePageRead,
  servicePageWrite,
  serviceSnapshot,
  serviceMirror,
];

export interface Runtime {
  readonly streams: OutputStreams;
  readonly withWeb: <T>(operation: (web: WebInterfaceClient) => Promise<T>) => Promise<T>;
  readonly withDevice: <T>(operation: (device: Device) => Promise<T>) => Promise<T>;
  readonly discoverFingerprint: () => Promise<{ readonly host: string; readonly fingerprint: string }>;
  readonly withLock: <T>(operation: () => Promise<T>) => Promise<T>;
}

export function resolveCommand(tokens: readonly string[]): { readonly command: Command; readonly positionals: readonly string[] } {
  for (let length = 3; length >= 1; length--) {
    const prefix = tokens.slice(0, length);
    const command = COMMANDS.find((candidate) => candidate.path.length === length
      && candidate.path.every((segment, index) => segment === prefix[index]));
    if (command !== undefined) return { command, positionals: tokens.slice(length) };
  }
  throw new CliError(`Unknown command: ${tokens.join(" ") || "(none)"}\n\n${helpText()}`);
}

export async function run(argv: readonly string[], runtime: Runtime): Promise<void> {
  const { tokens, options } = parseArgs(argv);
  if (tokens.length === 0 || options.has("help") || tokens[0] === "help") {
    runtime.streams.out(`${helpText()}\n`);
    return;
  }
  const { command, positionals } = resolveCommand(tokens);
  const parsed = new Options(options);
  parsed.rejectUnknown(command.options);
  if (command.interrupts && !parsed.flag("service"))
    throw new CliError(
      `${command.path.join(" ")} stops and restarts Xochitl, which interrupts the tablet UI.`
      + ` Repeat the command with --service if that is intended.`,
    );
  const passThrough = async <T>(operation: () => Promise<T>): Promise<T> => await operation();
  const context = {
    streams: runtime.streams,
    json: parsed.flag("json"),
    options: parsed,
    positionals,
    withWeb: runtime.withWeb,
    withDevice: runtime.withDevice,
    discoverFingerprint: runtime.discoverFingerprint,
    // A watch loop would otherwise hold the per-host lock for as long as it runs.
    withLock: command.longLived === true ? runtime.withLock : passThrough,
  };
  if (command.longLived === true || command.local === true) await command.run(context);
  else await runtime.withLock(async () => await command.run(context));
}

export function helpText(): string {
  const live = COMMANDS.filter((command) => !command.interrupts);
  const service = COMMANDS.filter((command) => command.interrupts);
  return [
    "rmcli, command line over rmscene-ts, rmcommunication-ts and rmindex-ts",
    "",
    "Commands that leave the tablet running:",
    table(live.map((command) => [`  ${command.path.join(" ")}`, command.summary])),
    "",
    "Commands that stop and restart Xochitl, each requiring --service:",
    table(service.map((command) => [`  ${command.path.join(" ")}`, command.summary])),
    "",
    "Usage:",
    ...COMMANDS.map((command) => `  ${command.usage}`),
    "",
    "Environment:",
    "  RMCLI_HOST         tablet WiFi address, required",
    "  RMCLI_FINGERPRINT  pinned SSH host key, required by every command except device fingerprint",
    "  RMCLI_PASSWORD     tablet password; leave unset to use RMCLI_PASSWORD_COMMAND",
    "  RMCLI_PASSWORD_COMMAND  command whose stdout is the tablet password",
    "  RMCLI_TIMEOUT_MS   Web Interface request timeout, default 180000",
  ].join("\n");
}
