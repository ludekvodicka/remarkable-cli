import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const local = Object.entries(packageJson.dependencies ?? {})
  .filter(([, range]) => typeof range === "string" && range.startsWith("file:"));

if (local.length > 0)
  throw new Error(
    `Publish ${local.map(([name]) => name).join(" and ")} first, then replace the file: range(s) `
    + `with a published semver range and refresh package-lock.json`,
  );
