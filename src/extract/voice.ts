import type { Span } from "../types.js";
import { CONDITIONAL_SENTENCE } from "./patterns.js";
import { splitSegments } from "./segments.js";

const QUOTED = /"[^"\n]*"|“[^”\n]*”/g;
const BLOCKQUOTE = /^[ \t]*>/;
// Words that announce work still to come: "Let me verify the build first."
const INTENT =
  /\b(?:let\s+me|let's|i'll|i\s+will|i'm\s+going\s+to|i\s+am\s+going\s+to|next,?\s+i)\b/i;

/**
 * Whether a span is the agent reporting its own finished work. On real data,
 * claims also turned up in words the agent was quoting (examples of how other
 * agents write, a drafted post in a blockquote) and in a sentence announcing
 * the next step. Both extractors pass through this.
 */
export function isReported(message: string, span: Span): boolean {
  for (const m of message.matchAll(QUOTED)) {
    if (m.index < span.start && span.end <= m.index + m[0].length) return false;
  }
  const lineStart = message.lastIndexOf("\n", span.start - 1) + 1;
  if (BLOCKQUOTE.test(message.slice(lineStart, span.start))) return false;
  const segment = splitSegments(message).find((s) => s.start <= span.start && span.start < s.end);
  if (!segment) return true;
  if (CONDITIONAL_SENTENCE.test(segment.text)) return false;
  return !INTENT.test(message.slice(segment.start, span.start));
}
