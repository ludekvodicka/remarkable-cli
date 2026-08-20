import { deviceProfile, readHostFingerprint, readSettings, withDevice, withWebInterface } from "./connection.js";
import { CliError } from "./errors.js";
import { withDeviceLock } from "./lock.js";
import { processStreams } from "./output.js";
import { helpText, run } from "./run.js";

const argv = process.argv.slice(2);

try {
  if (argv.length === 0 || argv.includes("--help") || argv[0] === "help") {
    processStreams.out(`${helpText()}\n`);
    process.exit(0);
  }
  const settings = readSettings(process.env);
  // Built on demand: `device fingerprint` is the one command that runs before a host key is pinned.
  const pinned = () => deviceProfile(settings, process.env);
  await withDeviceLock(settings.host, async () => await run(argv, {
    streams: processStreams,
    withWeb: async (operation) => await withWebInterface(pinned(), settings.requestTimeoutMs, operation),
    withDevice: async (operation) => await withDevice(pinned(), operation),
    discoverFingerprint: async () => await readHostFingerprint(settings, process.env),
  }));
} catch (error) {
  processStreams.err(`${message(error)}\n`);
  process.exit(1);
}

function message(error: unknown): string {
  if (error instanceof CliError) return error.message;
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
