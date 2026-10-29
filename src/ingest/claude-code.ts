import { createReadStream, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Session, SessionSummary, Step, ToolCall } from "../types.js";
import { findFinalMessage, orderSteps } from "./build.js";
import { applyResult } from "./claude-code-results.js";
import { asArray, asRecord, asString, parseJson, type JsonRecord } from "./json.js";
import { canonicalTool } from "./tools.js";
import { stripInjectedTags, toTitle } from "./text.js";

interface FileParse {
  sessionId: string;
  cwd: string;
  customTitle: string;
  firstHumanText: string;
  steps: Step[];
}

/**
 * Reads one Claude Code JSONL transcript plus any sub-agent transcripts stored
 * next to it in `<session>/subagents/*.jsonl`.
 */
export async function readClaudeCodeSession(file: string): Promise<Session> {
  const main = await parseFile(file, false, "");
  const steps = [...main.steps];
  for (const subFile of subagentFiles(file)) {
    const sub = await parseFile(subFile, true, main.cwd);
    steps.push(...sub.steps);
  }
  const ordered = orderSteps(steps);
  return {
    id: main.sessionId || path.basename(file, ".jsonl"),
    source: "claude-code",
    title: main.customTitle || toTitle(main.firstHumanText) || "Untitled session",
    cwd: main.cwd,
    startedAt: ordered[0]?.at ?? "",
    steps: ordered,
    finalMessage: findFinalMessage(ordered),
  };
}

/** A listing row for `receipts sessions`; skips sub-agent files and step ordering. */
export async function summariseClaudeCodeFile(file: string): Promise<SessionSummary> {
  const parsed = await parseFile(file, false, "");
  return {
    id: parsed.sessionId || path.basename(file, ".jsonl"),
    source: "claude-code",
    sourceLabel: "claude-code",
    title: parsed.customTitle || toTitle(parsed.firstHumanText) || "Untitled session",
    cwd: parsed.cwd,
    updatedAt: parsed.steps.at(-1)?.at ?? "",
    location: file,
  };
}

export function subagentFiles(file: string): string[] {
  const dir = path.join(file.replace(/\.jsonl$/, ""), "subagents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(dir, name));
}

async function parseFile(
  file: string,
  sidechainFile: boolean,
  cwdHint: string,
): Promise<FileParse> {
  const out: FileParse = {
    sessionId: "",
    cwd: cwdHint,
    customTitle: "",
    firstHumanText: "",
    steps: [],
  };
  const calls = new Map<string, ToolCall>();
  let current: { messageId: string; step: Step } | undefined;
  let pendingUserText = "";

  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const rec = asRecord(parseJson(line));
    if (!rec) continue;
    out.sessionId ||= asString(rec.sessionId) ?? "";
    if (!out.cwd) out.cwd = asString(rec.cwd) ?? "";

    // Only these record types carry the conversation. Others (request blobs,
    // snapshots, queue operations) repeat content and would double count.
    if (rec.type === "custom-title") {
      out.customTitle = asString(rec.customTitle) ?? out.customTitle;
    } else if (rec.type === "assistant") {
      const message = asRecord(rec.message);
      if (!message || message.model === "<synthetic>" || rec.isApiErrorMessage === true) continue;
      const messageId = asString(message.id) ?? asString(rec.uuid) ?? "";
      // One API message is split across several lines that share message.id.
      if (current?.messageId !== messageId) {
        current = { messageId, step: newStep(rec, message, sidechainFile, pendingUserText) };
        out.steps.push(current.step);
        pendingUserText = "";
      }
      appendBlocks(current.step, asArray(message.content), calls);
    } else if (rec.type === "user") {
      const human = handleUser(rec, calls, out.cwd);
      if (human) {
        pendingUserText = pendingUserText ? `${pendingUserText}\n\n${human}` : human;
        out.firstHumanText ||= human;
      }
    }
  }
  return out;
}

function newStep(
  rec: JsonRecord,
  message: JsonRecord,
  sidechainFile: boolean,
  userText: string,
): Step {
  return {
    index: 0,
    at: asString(rec.timestamp) ?? "",
    model: asString(message.model) ?? "",
    isSidechain: sidechainFile || rec.isSidechain === true,
    text: "",
    userText,
    tools: [],
  };
}

function appendBlocks(step: Step, blocks: unknown[], calls: Map<string, ToolCall>): void {
  for (const raw of blocks) {
    const block = asRecord(raw);
    if (block?.type === "text") {
      const text = asString(block.text) ?? "";
      step.text = step.text ? `${step.text}\n\n${text}` : text;
    } else if (block?.type === "tool_use") {
      const name = asString(block.name) ?? "unknown";
      const call: ToolCall = {
        id: asString(block.id) ?? "",
        name,
        canonical: canonicalTool(name),
        input: asRecord(block.input) ?? {},
        output: "",
        exitCode: null,
        // Until a result arrives the call never finished, as far as the transcript knows.
        status: "interrupted",
        note: "no result recorded",
        edits: [],
      };
      step.tools.push(call);
      calls.set(call.id, call);
    }
  }
}

/** Attaches tool results and returns the human-typed text, if this line has any. */
function handleUser(rec: JsonRecord, calls: Map<string, ToolCall>, cwd: string): string {
  const message = asRecord(rec.message);
  const content = message?.content;
  const humanParts: string[] = [];
  if (typeof content === "string") humanParts.push(content);
  for (const raw of asArray(content)) {
    const block = asRecord(raw);
    if (block?.type === "text") humanParts.push(asString(block.text) ?? "");
    if (block?.type === "tool_result") {
      const call = calls.get(asString(block.tool_use_id) ?? "");
      if (call) {
        delete call.note;
        applyResult(call, block, rec.toolUseResult, cwd);
      }
    }
  }
  if (rec.isMeta === true || rec.isCompactSummary === true) return "";
  return stripInjectedTags(humanParts.join("\n"));
}
