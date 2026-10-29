import { evidenceLabel, sortedClaims, VERDICT_LABEL } from "./format.js";
import type { Receipt } from "./schema.js";

/** Table cells: no pipes or newlines, which would break the row. */
function cell(text: string): string {
  return text
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

/** A block to paste into a pull request description or comment. */
export function renderMarkdown(receipt: Receipt): string {
  const { session, changes } = receipt;
  const lines: string[] = [
    `### Receipts: ${cell(session.title)}`,
    "",
    `**${receipt.summary}**`,
    "",
  ];

  if (receipt.claims.length > 0) {
    lines.push("| Verdict | Claim | Why | Evidence |", "| --- | --- | --- | --- |");
    for (const claim of sortedClaims(receipt)) {
      lines.push(
        `| ${VERDICT_LABEL[claim.verdict]} | ${cell(claim.text)} | ${cell(claim.reason)} | ${cell(evidenceLabel(claim.evidence[0]))} |`,
      );
    }
    lines.push("");
  }

  if (receipt.flags.length > 0) {
    lines.push("**Flags**", "");
    for (const flag of receipt.flags) {
      lines.push(
        `- **${flag.severity}** \`${flag.id}\`: ${cell(flag.detail)}${flag.heuristic ? " (heuristic)" : ""}`,
      );
    }
    lines.push("");
  }
  for (const notice of receipt.notices) lines.push(`> ${cell(notice)}`, "");

  const meta = [
    `Receipts ${receipt.receiptsVersion}`,
    `${session.source} session, ${session.stepCount} steps`,
    `changes: ${changes.label}`,
    receipt.llm.model ? `claims from patterns and ${receipt.llm.model}` : "claims from patterns",
  ];
  lines.push(`<sub>${cell(meta.join(" · "))}</sub>`, "");
  return lines.join("\n");
}
