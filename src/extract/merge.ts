import type { Claim } from "../types.js";
import type { DraftClaim } from "./patterns.js";

/** Lowercase, no backticks, quotes or "./", collapsed whitespace. */
export function normaliseSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/[`"']/g, "")
    .replace(/^\.\//, "")
    .replace(/\s+/g, " ")
    .trim();
}

const overlaps = (a: DraftClaim, b: DraftClaim) =>
  a.span.start < b.span.end && b.span.start < a.span.end;

/**
 * Union of pattern and LLM claims. Two claims are the same when they have the
 * same type and either the same subject or overlapping spans. The pattern span
 * wins, because it was matched deterministically.
 */
export function mergeClaims(pattern: DraftClaim[], llm: DraftClaim[]): Claim[] {
  const merged: Omit<Claim, "id">[] = pattern.map((c) => ({ ...c, extractedBy: "pattern" }));
  for (const candidate of llm) {
    const subject = normaliseSubject(candidate.subject);
    const twin = merged.find(
      (c) =>
        c.type === candidate.type &&
        ((subject !== "" && normaliseSubject(c.subject) === subject) || overlaps(c, candidate)),
    );
    if (twin) {
      if (twin.extractedBy === "pattern") twin.extractedBy = "both";
      continue;
    }
    merged.push({ ...candidate, extractedBy: "llm" });
  }
  return merged
    .sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end)
    .map((c, i) => ({ id: i + 1, ...c }));
}
