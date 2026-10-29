import type { SessionSummary } from "../types.js";
import type { Colors } from "../report/colors.js";

/** Local "YYYY-MM-DD HH:MM", the way people read times in a terminal. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderSessions(rows: readonly SessionSummary[], c: Colors, width = 100): string {
  if (rows.length === 0) {
    return "No sessions found. Receipts looks in ~/.claude/projects and in OpenCode-format databases; use --db to point at one.\n";
  }
  const sourceWidth = Math.max(6, ...rows.map((r) => r.sourceLabel.length));
  const idWidth = Math.max(2, ...rows.map((r) => r.id.length));
  const fixed = 16 + 2 + sourceWidth + 2 + idWidth + 2;
  const titleWidth = Math.max(20, width - fixed);
  const header = [
    "WHEN".padEnd(16),
    "SOURCE".padEnd(sourceWidth),
    "ID".padEnd(idWidth),
    "TITLE",
  ].join("  ");
  const lines = rows.map((r) =>
    [
      formatWhen(r.updatedAt).padEnd(16),
      r.sourceLabel.padEnd(sourceWidth),
      c.dim(r.id.padEnd(idWidth)),
      truncate(r.title, titleWidth),
    ].join("  "),
  );
  return `${c.dim(header)}\n${lines.join("\n")}\n`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
