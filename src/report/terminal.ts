import type { Severity, Verdict } from "../types.js";
import type { Colors } from "./colors.js";
import { evidenceLabel, oneLine, sortedClaims, VERDICT_LABEL, VERDICT_ORDER } from "./format.js";
import type { Receipt } from "./schema.js";

export interface TerminalOptions {
  colors: Colors;
  width: number;
  /** Where the report files were written, if anywhere. */
  reportPath?: string;
}

const TAG_WIDTH = 12;

/**
 * The default output: a header, the verdict counts, one line per claim (with the
 * reason underneath when it is not verified), flags, notices and the report path.
 */
export function renderTerminal(receipt: Receipt, options: TerminalOptions): string {
  const c = options.colors;
  const width = Math.max(60, Math.min(options.width, 140));
  const paint: Record<Verdict, (s: string) => string> = {
    verified: c.green,
    contradicted: c.red,
    stale: c.yellow,
    unverified: c.gray,
    "needs-review": c.magenta,
  };
  const severity: Record<Severity, (s: string) => string> = {
    high: c.red,
    medium: c.yellow,
    low: c.gray,
  };
  const { session, changes } = receipt;
  const out: string[] = [];

  out.push(`${c.bold("Receipts")}  ${oneLine(session.title, width - 10)}`);
  out.push(
    c.dim(
      [session.source, session.model, `${session.stepCount} steps`, session.repo, changes.label]
        .concat(session.turns ? [`turns ${session.turns}`] : [])
        .join(" · "),
    ),
  );
  out.push("");
  out.push(
    "  " +
      VERDICT_ORDER.map((v) => `${paint[v](String(receipt.counts[v]))} ${VERDICT_LABEL[v]}`).join(
        "   ",
      ),
  );
  out.push(`  ${receipt.summary}`);
  out.push("");

  const evidenceWidth = 34;
  const textWidth = Math.max(20, width - 2 - TAG_WIDTH - 2 - evidenceWidth - 2);
  for (const claim of sortedClaims(receipt)) {
    const tag = paint[claim.verdict](VERDICT_LABEL[claim.verdict].toUpperCase().padEnd(TAG_WIDTH));
    const text = oneLine(claim.text, textWidth).padEnd(textWidth);
    out.push(
      `  ${tag}  ${text}  ${c.dim(oneLine(evidenceLabel(claim.evidence[0]), evidenceWidth))}`,
    );
    if (claim.verdict !== "verified") {
      out.push(
        `  ${" ".repeat(TAG_WIDTH)}  ${c.dim(oneLine(claim.reason, width - TAG_WIDTH - 4))}`,
      );
    }
  }
  if (receipt.claims.length === 0) out.push("  No checkable claims in the final message.");

  if (receipt.flags.length > 0) {
    out.push("", c.bold("Flags"));
    for (const flag of receipt.flags) {
      const sev = severity[flag.severity](flag.severity.toUpperCase().padEnd(6));
      out.push(`  ${sev}  ${flag.id.padEnd(26)}  ${oneLine(flag.detail, width - 40)}`);
    }
  }
  if (receipt.notices.length > 0) {
    out.push("", c.bold("Notices"));
    for (const notice of receipt.notices) out.push(`  ${oneLine(notice, width - 2)}`);
  }
  if (options.reportPath) out.push("", `${c.bold("Report")}  ${options.reportPath}`);
  return `${out.join("\n")}\n`;
}
