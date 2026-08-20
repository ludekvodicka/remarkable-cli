import { CliError } from "./errors.js";

export interface ParsedArgs {
  readonly tokens: readonly string[];
  readonly options: ReadonlyMap<string, string | true>;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const tokens: string[] = [];
  const options = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index] as string;
    if (!argument.startsWith("--")) {
      tokens.push(argument);
      continue;
    }
    const body = argument.slice(2);
    if (body.length === 0) throw new CliError("Bare -- is not an option");
    const equals = body.indexOf("=");
    if (equals >= 0) {
      options.set(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) options.set(body, true);
    else {
      options.set(body, next);
      index++;
    }
  }
  return { tokens, options };
}

export class Options {
  readonly #values: ReadonlyMap<string, string | true>;

  constructor(values: ReadonlyMap<string, string | true>) {
    this.#values = values;
  }

  require(name: string): string {
    const value = this.#values.get(name);
    if (value === undefined) throw new CliError(`Missing --${name}`);
    if (value === true) throw new CliError(`--${name} needs a value`);
    return value;
  }

  optional(name: string): string | null {
    const value = this.#values.get(name);
    if (value === undefined) return null;
    if (value === true) throw new CliError(`--${name} needs a value`);
    return value;
  }

  flag(name: string): boolean {
    const value = this.#values.get(name);
    if (value === undefined) return false;
    if (value === true) return true;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new CliError(`--${name} is a flag and takes no value`);
  }

  rejectUnknown(allowed: readonly string[]): void {
    const known = new Set([...allowed, "json"]);
    const unknown = [...this.#values.keys()].filter((name) => !known.has(name));
    if (unknown.length > 0)
      throw new CliError(`Unknown option${unknown.length > 1 ? "s" : ""}: ${unknown.map((name) => `--${name}`).join(", ")}`);
  }
}

export function requirePositionals(tokens: readonly string[], names: readonly string[]): readonly string[] {
  if (tokens.length !== names.length)
    throw new CliError(`Expected ${names.map((name) => `<${name}>`).join(" ")}, got ${tokens.length} argument(s)`);
  return tokens;
}
