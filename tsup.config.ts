import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  platform: "node",
  target: "node22",
  external: ["rmcommunication-ts", "rmscene-ts", "sharp", "ssh2"],
  banner: { js: "#!/usr/bin/env node" },
  outExtension() {
    return { js: ".js" };
  },
});
