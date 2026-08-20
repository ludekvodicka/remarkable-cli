import { requirePositionals } from "../args.js";
import type { Command } from "../context.js";
import { emit, table, writeBinary } from "../output.js";

export const deviceStatus: Command = {
  path: ["device", "status"],
  summary: "Report tablet identity, runtime state and live document count",
  usage: "rmcli device status [--json]",
  options: [],
  positionals: [],
  interrupts: false,
  async run(context) {
    const runtime = await context.withDevice(async (device) => ({
      identity: await device.identity(),
      runtime: await device.runtimeObservation(),
    }));
    const documents = await context.withWeb(async (web) => (await web.listDocuments()).length);
    const status = { ...runtime, documents };
    emit(context.streams, context.json, status, () => table([
      ["xochitl", `${runtime.runtime.xochitlService} (pid ${runtime.runtime.xochitlPid ?? "-"})`],
      ["uptime", `${runtime.runtime.uptimeSeconds} s`],
      ["documents", String(documents)],
    ]));
  },
};

export const deviceFingerprint: Command = {
  path: ["device", "fingerprint"],
  summary: "Read the tablet's SSH host key so it can be pinned",
  usage: "rmcli device fingerprint [--json]",
  options: [],
  positionals: [],
  interrupts: false,
  async run(context) {
    const found = await context.discoverFingerprint();
    emit(context.streams, context.json, found, () =>
      `${found.fingerprint}\n\nCheck this against the tablet, then set RMCLI_FINGERPRINT to it.`);
  },
};

export const deviceIdentity: Command = {
  path: ["device", "identity"],
  summary: "Read the tablet identity over SSH",
  usage: "rmcli device identity [--json]",
  options: [],
  positionals: [],
  interrupts: false,
  async run(context) {
    const identity = await context.withDevice(async (device) => await device.identity());
    emit(context.streams, context.json, identity, () => JSON.stringify(identity, null, 2));
  },
};

export const deviceCapabilities: Command = {
  path: ["device", "capabilities"],
  summary: "Probe which remote capabilities are available",
  usage: "rmcli device capabilities [--json]",
  options: [],
  positionals: [],
  interrupts: false,
  async run(context) {
    const capabilities = await context.withDevice(async (device) => await device.probeCapabilities());
    emit(context.streams, context.json, capabilities, () => JSON.stringify(capabilities, null, 2));
  },
};

export const deviceEnableWifiSsh: Command = {
  path: ["device", "enable-wifi-ssh"],
  summary: "Enable SSH over WiFi on the tablet",
  usage: "rmcli device enable-wifi-ssh [--json]",
  options: [],
  positionals: [],
  interrupts: false,
  async run(context) {
    await context.withDevice(async (device) => await device.enableWifiSsh());
    emit(context.streams, context.json, { enabled: true }, () => "WiFi SSH enabled");
  },
};

export const templatesRead: Command = {
  path: ["templates", "read"],
  summary: "Read one stock template as JSON",
  usage: "rmcli templates read <name> --output <file.json> [--json]",
  options: ["output"],
  positionals: ["name"],
  interrupts: false,
  async run(context) {
    const [name] = requirePositionals(context.positionals, ["name"]) as [string];
    const output = context.options.require("output");
    const template = await context.withDevice(async (device) => await device.readTemplate(name));
    const path = await writeBinary(output, new TextEncoder().encode(`${JSON.stringify(template, null, 2)}\n`));
    emit(context.streams, context.json, { name, outputPath: path }, () => path);
  },
};
