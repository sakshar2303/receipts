const OUTPUT_LIMIT = 32 * 1024;

/**
 * Keeps the head and tail of long tool output. Test runners print their summary
 * at the end, so the tail matters as much as the head.
 */
export function clipOutput(text: string, limit = OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  const dropped = text.length - half * 2;
  return `${text.slice(0, half)}\n[... ${dropped} characters clipped ...]\n${text.slice(-half)}`;
}

// Harness-injected blocks such as <system-reminder>...</system-reminder> are not
// what the human typed. Tags without a hyphen are kept, since users write those.
const INJECTED_BLOCK = /<([a-z]+(?:-[a-z]+)+)\b[^>]*>[\s\S]*?<\/\1>/g;

export function stripInjectedTags(text: string): string {
  return text.replace(INJECTED_BLOCK, "").trim();
}

export function toTitle(text: string, max = 80): string {
  const line = stripInjectedTags(text)
    .replace(/<\/?[a-z_]+[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function countLines(text: string): number {
  if (text === "") return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

/**
 * Added and removed line counts between two snippets, treating them as multisets
 * of lines. Exact enough for a timeline; the git diff is the source of truth.
 */
export function lineChangeStats(before: string, after: string): { added: number; removed: number } {
  const remaining = new Map<string, number>();
  for (const line of splitLines(before)) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of splitLines(after)) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) remaining.set(line, left - 1);
    else added++;
  }
  let removed = 0;
  for (const left of remaining.values()) removed += left;
  return { added, removed };
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Counts +/- lines in unified-diff hunk bodies. */
export function patchLineStats(lines: readonly string[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}
