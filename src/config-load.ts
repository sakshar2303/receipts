import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { ConfigSchema, DEFAULT_CONFIG, type Config } from "./config.js";
import { inputNotFound, ReceiptsError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";

export const CONFIG_FILE = "receipts.config.json";

// Every key is optional in the file; nested command lists may be set one at a time.
const FileSchema = ConfigSchema.extend({
  commands: ConfigSchema.shape.commands.partial().strict(),
  // Lets editors validate the file against a published JSON Schema.
  $schema: z.string(),
})
  .partial()
  .strict();

export interface LoadedConfig {
  config: Config;
  /** The file it came from, or null for the defaults. */
  file: string | null;
}

/**
 * Loads receipts.config.json: the --config path if given, otherwise the first
 * one found in the given folders. Keys override the defaults; lists replace them.
 */
export function loadConfig(explicit: string | undefined, dirs: readonly string[]): LoadedConfig {
  const file = explicit ?? dirs.map((d) => path.join(d, CONFIG_FILE)).find((f) => existsSync(f));
  if (!file) return { config: DEFAULT_CONFIG, file: null };
  if (!existsSync(file)) throw inputNotFound(`Config file not found: ${file}`);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (error) {
    throw usage(
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) throw usage(`${file} has problems:\n${formatIssues(parsed.error)}`);

  const { commands = {}, ...settings } = parsed.data;
  const rest = Object.fromEntries(
    Object.entries(settings).filter(([key, value]) => key !== "$schema" && value !== undefined),
  ) as Partial<Config>;
  const commandOverrides = Object.fromEntries(
    Object.entries(commands).filter(([, value]) => value !== undefined),
  ) as Partial<Config["commands"]>;
  const config: Config = {
    ...DEFAULT_CONFIG,
    ...rest,
    commands: { ...DEFAULT_CONFIG.commands, ...commandOverrides },
  };
  for (const [kind, patterns] of Object.entries(config.commands)) {
    for (const source of patterns) {
      try {
        new RegExp(source);
      } catch {
        throw usage(`${file}: commands.${kind} has an invalid regular expression: ${source}`);
      }
    }
  }
  return { config, file };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const where = issue.path.length ? issue.path.join(".") : "(top level)";
      if (issue.code === "unrecognized_keys") {
        const parent = issue.path.length ? issue.path.join(".") : "";
        const valid =
          parent === "commands"
            ? Object.keys(ConfigSchema.shape.commands.shape)
            : Object.keys(ConfigSchema.shape);
        return `  Unknown key ${issue.keys.map((k) => `"${k}"`).join(", ")}${parent ? ` in ${parent}` : ""}. Valid keys: ${valid.join(", ")}.`;
      }
      return `  ${where}: ${issue.message}`;
    })
    .join("\n");
}

function usage(message: string): ReceiptsError {
  return new ReceiptsError(message, ExitCode.Usage);
}
