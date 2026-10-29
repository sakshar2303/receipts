import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildContext, checkClaims } from "../check/index.js";
import { loadConfig } from "../config-load.js";
import { loadChangeSet } from "../diff/index.js";
import { inputNotFound } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import { extractClaims } from "../extract/index.js";
import { detectFlags } from "../flags/index.js";
import { redactSecrets } from "../flags/secrets.js";
import { selectTurns } from "../ingest/turns.js";
import { DEFAULT_CACHE_DIR } from "../providers/cache.js";
import type { Fetch } from "../providers/client.js";
import { loadProviderEnv } from "../providers/env.js";
import { colorsFor } from "../report/colors.js";
import { renderMarkdown } from "../report/markdown.js";
import { buildReceipt } from "../report/receipt.js";
import type { Receipt } from "../report/schema.js";
import { renderTerminal } from "../report/terminal.js";
import type { Verdict } from "../types.js";
import { resolveTarget } from "./target.js";

export const FORMATS = ["terminal", "json", "md", "all"] as const;
export type Format = (typeof FORMATS)[number];

export interface CheckOptions {
  repo?: string;
  base?: string;
  head?: string;
  diff?: string;
  db?: string;
  turns?: string;
  format: Format;
  out: string;
  llm: boolean;
  model?: string;
  failOn: Verdict[];
  config?: string;
  quiet: boolean;
}

export interface Io {
  write(text: string): void;
  isTTY: boolean;
  columns: number;
  env: NodeJS.ProcessEnv;
  cwd: string;
  fetchImpl?: Fetch;
}

/** The whole pipeline: find the session, read the changes, extract, check, flag, report. */
export async function buildReceiptFor(
  target: string,
  options: CheckOptions,
  io: Io,
): Promise<Receipt> {
  const { config } = loadConfig(options.config, [options.repo ?? io.cwd, io.cwd]);
  const resolved = await resolveTarget(target, {
    ...(options.db ? { db: options.db } : {}),
    ...(options.repo ? { repo: options.repo, strictRepo: true } : { repo: io.cwd }),
  });
  let session = resolved.session;
  if (options.turns) session = selectTurns(session, options.turns);
  if (!session.finalMessage?.text.trim()) {
    throw inputNotFound(`Session "${session.title}" has no final message to check.`);
  }
  // Redact before extraction, so claim offsets point into the text that is shown.
  const finalText = redactSecrets(session.finalMessage.text);
  session = { ...session, finalMessage: { ...session.finalMessage, text: finalText } };

  const diffFile = options.diff ?? (options.base || options.repo ? undefined : resolved.diffFile);
  const changes = await loadChangeSet(session, {
    ...(options.repo ? { repo: options.repo } : {}),
    ...(options.base ? { base: options.base } : {}),
    ...(options.head ? { head: options.head } : {}),
    ...(diffFile ? { diffFile } : {}),
  });
  const extracted = await extractClaims(finalText, {
    noLlm: !options.llm,
    env: loadProviderEnv(io.cwd, io.env),
    cacheDir: path.join(io.cwd, DEFAULT_CACHE_DIR),
    ...(options.model ? { model: options.model } : {}),
    ...(io.fetchImpl ? { fetchImpl: io.fetchImpl } : {}),
  });
  const ctx = buildContext(session, changes, config);
  const claims = checkClaims(extracted.claims, ctx);
  const flags = detectFlags({ activity: ctx.activity, changes, claims });
  return buildReceipt({
    session,
    activity: ctx.activity,
    changes,
    claims,
    flags,
    llm: { model: extracted.model, notice: extracted.notice ?? null },
    turns: options.turns ?? null,
  });
}

/** Writes the requested outputs and returns the exit code for --fail-on. */
export async function runCheck(target: string, options: CheckOptions, io: Io): Promise<number> {
  const receipt = await buildReceiptFor(target, options, io);
  const markdown = renderMarkdown(receipt);
  const json = `${JSON.stringify(receipt, null, 2)}\n`;

  if (options.format === "json") io.write(json);
  else if (options.format === "md") io.write(markdown);
  else {
    let reportPath: string | undefined;
    if (options.format === "all") {
      mkdirSync(options.out, { recursive: true });
      writeFileSync(path.join(options.out, "report.json"), json);
      writeFileSync(path.join(options.out, "report.md"), markdown);
      reportPath = path.join(options.out, "report.json");
    }
    if (!options.quiet) {
      io.write(
        renderTerminal(receipt, {
          colors: colorsFor({ isTTY: io.isTTY }, io.env),
          width: io.columns,
          ...(reportPath ? { reportPath } : {}),
        }),
      );
    }
  }
  return receipt.claims.some((c) => options.failOn.includes(c.verdict))
    ? ExitCode.FailOnMatched
    : ExitCode.Ok;
}
