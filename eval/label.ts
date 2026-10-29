// `npm run label`: hand-label Receipts' claims on real sessions from this
// machine. Labels go to eval/private/labels.json, which is never committed.
// Only a local Ollama model is used, so no real transcript text is sent anywhere.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import type { Io } from "../src/commands/check.js";
import { openInBrowser } from "../src/commands/open.js";
import { pickOllamaModel } from "../src/providers/select.js";
import { colorsFor } from "../src/report/colors.js";
import { evidenceLabel, VERDICT_LABEL } from "../src/report/format.js";
import { renderHtml } from "../src/report/html/template.js";
import { renderMarkdown } from "../src/report/markdown.js";
import type { Receipt } from "../src/report/schema.js";
import type { Verdict } from "../src/types.js";
import {
  readLabels,
  realUnits,
  receiptForUnit,
  writeLabels,
  type LabelledUnit,
  type Unit,
} from "./lib/real.js";

const ROOT = process.cwd();
const c = colorsFor(process.stdout);
const KEYS: Record<string, Verdict | "not-a-claim"> = {
  v: "verified",
  c: "contradicted",
  s: "stale",
  u: "unverified",
  n: "needs-review",
  x: "not-a-claim",
};
const io: Io = {
  write: () => undefined,
  isTTY: false,
  columns: 100,
  env: process.env.OLLAMA_HOST ? { OLLAMA_HOST: process.env.OLLAMA_HOST } : {},
  cwd: ROOT,
};
const rl = createInterface({ input: process.stdin, output: process.stdout });
const say = (s = "") => process.stdout.write(`${s}\n`);

function indent(text: string, max = 2500): string {
  const clipped =
    text.length > max ? `${text.slice(0, max)}\n[... ${text.length - max} more characters]` : text;
  return clipped
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}

function outputTail(receipt: Receipt, claim: Receipt["claims"][number]): string {
  const run = claim.evidence.find((e) => e.kind === "run");
  if (run?.kind !== "run") return "";
  const tool = receipt.steps.flatMap((s) => s.tools).find((t) => t.id === run.toolId);
  const lines = (tool?.output ?? "").trim().split("\n").slice(-6);
  return lines.length && lines[0]
    ? lines.map((l) => `        | ${l.slice(0, 120)}`).join("\n")
    : "";
}

function openReport(receipt: Receipt): void {
  const dir = path.join(ROOT, ".receipts");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "label-report.html");
  writeFileSync(file, renderHtml(receipt, renderMarkdown(receipt)));
  openInBrowser(file);
}

/** Labels one message. Returns null to skip it, "quit" to stop. */
async function labelUnit(unit: Unit, receipt: Receipt): Promise<LabelledUnit | null | "quit"> {
  say(
    c.bold(
      `\n${unit.source} · ${receipt.session.title} · turn ${unit.turn} of ${unit.turns} · ${receipt.session.stepCount} steps`,
    ),
  );
  say(c.dim("Final message:"));
  say(indent(receipt.finalMessage.text));
  say();
  const claims: LabelledUnit["claims"] = [];
  if (receipt.claims.length === 0) say(c.dim("Receipts found no claims in this message."));
  for (const [i, claim] of receipt.claims.entries()) {
    say(
      `  (${i + 1}/${receipt.claims.length}) ${c.bold(`"${claim.text}"`)}  ${c.dim(`[${claim.type}, ${claim.extractedBy}]`)}`,
    );
    say(`      Receipts: ${VERDICT_LABEL[claim.verdict].toUpperCase()}. ${claim.reason}`);
    say(
      c.dim(
        `      Evidence: ${claim.evidence.slice(0, 3).map(evidenceLabel).join("; ") || "none"}`,
      ),
    );
    const tail = outputTail(receipt, claim);
    if (tail) say(c.dim(tail));
    for (;;) {
      const answer = (
        await rl.question(
          "      True verdict? Enter=agree, v c s u n, x=not a claim, o=open report, k=skip message, q=quit: ",
        )
      )
        .trim()
        .toLowerCase();
      if (answer === "q") return "quit";
      if (answer === "k") return null;
      if (answer === "o") {
        openReport(receipt);
        continue;
      }
      const truth = answer === "" ? claim.verdict : KEYS[answer];
      if (!truth) continue;
      claims.push({ start: claim.span.start, end: claim.span.end, text: claim.text, truth });
      break;
    }
  }
  const missed = Number(
    (await rl.question("  How many real claims did Receipts miss in this message? [0] ")).trim() ||
      "0",
  );
  return {
    key: unit.key,
    claims,
    missed: Number.isFinite(missed) && missed >= 0 ? Math.floor(missed) : 0,
  };
}

/**
 * One turn from each session in turn, so stopping early still leaves a sample
 * spread across sessions and both agents, not one long session.
 */
function roundRobin(units: Unit[]): Unit[] {
  const bySession = new Map<string, Unit[]>();
  for (const u of units) bySession.set(u.target, [...(bySession.get(u.target) ?? []), u]);
  const queues = [...bySession.values()];
  const out: Unit[] = [];
  while (queues.some((q) => q.length))
    for (const q of queues) {
      const next = q.shift();
      if (next) out.push(next);
    }
  return out;
}

async function main(): Promise<void> {
  const local = await pickOllamaModel(io.env);
  const model = local ? `ollama:${local}` : null;
  const labels = readLabels();
  const done = new Set(labels.units.map((u) => u.key));
  const todo = roundRobin((await realUnits()).filter((u) => !done.has(u.key)));
  say(c.bold("Receipts labelling"));
  say(
    `${done.size} messages labelled so far, ${todo.length} to go. Claims come from patterns${model ? ` and ${model} (local)` : " only (no local model found)"}.`,
  );
  say(
    "Judge each claim from the evidence, not from Receipts' verdict. Labels are saved after every message.",
  );
  for (const [i, unit] of todo.entries()) {
    say(c.dim(`\n[${i + 1}/${todo.length}]`));
    const receipt = await receiptForUnit(unit, io, model);
    const result = await labelUnit(unit, receipt);
    if (result === "quit") break;
    if (result === null) continue;
    labels.units.push(result);
    writeLabels(labels);
    say(c.green(`  Saved. ${labels.units.length} messages labelled.`));
  }
  rl.close();
  say(`\nDone. Run "npm run eval" to score Receipts against your labels.`);
}

await main();
