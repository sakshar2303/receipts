import type { Span } from "../types.js";

export interface Segment extends Span {
  text: string;
}

const FENCE = /^\s*(```|~~~)/;
const BULLET = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
// A sentence ends at . ! or ? followed by whitespace and an uppercase letter,
// a quote, a backtick or a bracket. "src/parser.ts" has no space after the
// dot, so paths never split a sentence.
const SENTENCE_END = /[.!?]+(?=\s+[A-Z`"'([])/g;

/**
 * Splits a final message into sentences and bullet items with exact offsets.
 * Fenced code blocks and headings are skipped: they are not claims.
 */
export function splitSegments(message: string): Segment[] {
  const segments: Segment[] = [];
  let inFence = false;
  let offset = 0;
  for (const line of message.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*#{1,6}\s/.test(line) || line.trim() === "") continue;

    const bullet = BULLET.exec(line);
    const bodyStart = lineStart + (bullet?.[1]?.length ?? 0);
    const body = message.slice(bodyStart, lineStart + line.length);
    let cursor = 0;
    for (const m of body.matchAll(SENTENCE_END)) {
      const end = m.index + m[0].length;
      push(segments, message, bodyStart + cursor, bodyStart + end);
      cursor = end;
    }
    push(segments, message, bodyStart + cursor, bodyStart + body.length);
  }
  return segments;
}

function push(out: Segment[], message: string, start: number, end: number): void {
  // Trim whitespace without losing the offsets.
  while (start < end && /\s/.test(message[start] ?? "")) start++;
  while (end > start && /\s/.test(message[end - 1] ?? "")) end--;
  if (end > start) out.push({ start, end, text: message.slice(start, end) });
}
