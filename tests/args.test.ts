import { describe, expect, it } from "vitest";

import { Options, parseArgs, requirePositionals } from "../src/args.js";

describe("argument parsing", () => {
  it("separates positionals from both option spellings", () => {
    const parsed = parseArgs(["documents", "upload", "a.pdf", "--name", "Deck", "--folder=abc", "--json"]);
    expect(parsed.tokens).toEqual(["documents", "upload", "a.pdf"]);
    expect([...parsed.options]).toEqual([["name", "Deck"], ["folder", "abc"], ["json", true]]);
  });

  it("treats an option followed by another option as a flag", () => {
    const parsed = parseArgs(["service", "mirror", "--service", "--mirror-dir", "out"]);
    expect(parsed.options.get("service")).toBe(true);
    expect(parsed.options.get("mirror-dir")).toBe("out");
  });

  it("reports missing values, missing options and unknown options", () => {
    const options = new Options(new Map<string, string | true>([["name", true], ["folder", "abc"], ["stray", "x"]]));
    expect(() => options.require("name")).toThrow("--name needs a value");
    expect(() => options.require("output")).toThrow("Missing --output");
    expect(() => options.flag("folder")).toThrow("--folder is a flag");
    expect(() => options.rejectUnknown(["name", "folder"])).toThrow("Unknown option: --stray");
    expect(options.optional("missing")).toBeNull();
  });

  it("requires an exact positional count", () => {
    expect(requirePositionals(["a", "b"], ["documentId", "pageId"])).toEqual(["a", "b"]);
    expect(() => requirePositionals(["a"], ["documentId", "pageId"])).toThrow("<documentId> <pageId>");
  });
});
