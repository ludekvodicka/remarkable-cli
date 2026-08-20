import type { Device, WebInterfaceClient } from "rmcommunication-ts";

import type { Options } from "./args.js";
import type { OutputStreams } from "./output.js";

export interface CliContext {
  readonly streams: OutputStreams;
  readonly json: boolean;
  readonly options: Options;
  readonly positionals: readonly string[];
  readonly withWeb: <T>(operation: (web: WebInterfaceClient) => Promise<T>) => Promise<T>;
  readonly withDevice: <T>(operation: (device: Device) => Promise<T>) => Promise<T>;
  readonly discoverFingerprint: () => Promise<{ readonly host: string; readonly fingerprint: string }>;
}

export interface Command {
  readonly path: readonly string[];
  readonly summary: string;
  readonly usage: string;
  readonly options: readonly string[];
  readonly positionals: readonly string[];
  /** True when the command stops and restarts Xochitl, which interrupts the tablet UI. */
  readonly interrupts: boolean;
  run(context: CliContext): Promise<void>;
}
