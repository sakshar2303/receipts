import type { Claim, ClaimType } from "../types.js";
import { splitSegments } from "./segments.js";

export type DraftClaim = Omit<Claim, "id" | "extractedBy">;

// A file path: backticked or bare, with a slash or a file extension that has a letter in it
// (so "v1.2" is not a path but "src/a.ts", "README.md" and "docs/" are).
const PATH = String.raw`\x60?(?<path>(?:\.{0,2}/)?[\w@.\[\]-]+(?:/[\w@.\[\]-]+)*\.(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,10}|[\w@.-]+(?:/[\w@.\[\]-]+)+/?)\x60?`;
const PKG = String.raw`\x60?(?<pkg>@?[a-z0-9][\w.-]*(?:/[\w.-]+)?)\x60?`;
// "npm run typecheck", "`pnpm lint`": a package-manager prefix before a check name.
const RUNNER = String.raw`\x60?(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?)?`;
// A phrase subject runs to the end of the clause.
// A dot inside a word ("parser.test.ts") does not end it.
const PHRASE = String.raw`(?<phrase>(?:[^.;:\n]|\.(?=\S))+?)(?=[.;:\n](?:\s|$)|[;:\n]|,\s|\s+and\s|\s+so\s|$)`;

interface Pattern {
  type: ClaimType;
  re: RegExp;
  /** A fixed subject, for claims whose wording never names one ("pushed to main"). */
  subject?: string;
}

const p = (type: ClaimType, source: string, subject?: string): Pattern => ({
  type,
  re: new RegExp(source, "gi"),
  ...(subject ? { subject } : {}),
});

/**
 * Ordered most specific first. When two matches overlap, the earlier pattern
 * wins, so "no lint errors" is a lint claim and not a generic no-errors claim.
 */
const PATTERNS: Pattern[] = [
  p(
    "tests-pass",
    String.raw`\b(?:all\s+(?:of\s+the\s+)?|the\s+)?(?:\d+\s*(?:/\s*\d+\s+)?)?(?:unit\s+|e2e\s+|integration\s+|existing\s+|new\s+)?tests?(?:\s+suite)?\s+(?:are\s+|is\s+|now\s+|still\s+|all\s+)*(?:pass(?:es|ed|ing)?|green|succeed(?:s|ed)?)\b`,
  ),
  p("tests-pass", String.raw`\bno\s+(?:failing|failed)\s+tests\b`),
  p(
    "tests-pass",
    String.raw`\x60(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test[\w:-]*\x60\s+(?:is\s+|now\s+)*(?:\d+\s*/\s*\d+\s+)?(?:pass(?:es|ed|ing)?|green|clean)\b`,
  ),
  p("tests-pass", String.raw`\b\d+\s*/\s*\d+\s+(?:tests?\s+)?(?:pass(?:es|ed|ing)?|green)\b`),
  p(
    "tests-pass",
    String.raw`\b(?:pass(?:es|ed)?|passing)\s+(?:all\s+)?(?:the\s+)?(?:\d+\s+)?tests\b`,
  ),
  p(
    "tests-added",
    String.raw`\b(?:added|wrote|written|created|introduced)\s+(?:\w+\s+){0,3}?(?:unit\s+|regression\s+|e2e\s+|integration\s+)?tests?\b(?:\s+(?:for|covering|to\s+cover|around)\s+${PHRASE})?`,
  ),
  p(
    "typecheck-passes",
    String.raw`(?:\b(?:the\s+)?|${RUNNER})(?:typecheck(?:ing)?|type[- ]check(?:ing)?|tsc|mypy|pyright)\x60?\s+(?:is\s+|now\s+)*(?:pass(?:es|ed)?|clean|succeeds?|succeeded)\b`,
  ),
  p("typecheck-passes", String.raw`\bno\s+type\s+errors\b`),
  p(
    "lint-passes",
    String.raw`(?:\b(?:the\s+)?|${RUNNER})(?:lint(?:ing|er)?|eslint|ruff|clippy|prettier)\x60?\s+(?:is\s+|now\s+|checks?\s+)*(?:clean|pass(?:es|ed)?|green|happy)\b`,
  ),
  p("lint-passes", String.raw`\bno\s+(?:lint|linting|eslint)\s+(?:errors|warnings|issues)\b`),
  p(
    "build-passes",
    String.raw`(?:\b(?:the\s+)?|${RUNNER})build\x60?\s+(?:now\s+|still\s+)*(?:succeeds|succeeded|passes|passed|is\s+green|is\s+clean|works)\b`,
  ),
  p(
    "build-passes",
    String.raw`\b(?:builds|compiles)\s+(?:successfully|cleanly|without\s+(?:any\s+)?errors)\b`,
  ),
  p("dependency-added", String.raw`\binstalled\s+(?:the\s+)?${PKG}`),
  p(
    "dependency-added",
    String.raw`\badded\s+(?:the\s+)?${PKG}\s+(?:as\s+a\s+|to\s+(?:the\s+)?)?(?:dev[- ]?)?(?:dependency|dependencies|package)\b`,
  ),
  p("dependency-removed", String.raw`\buninstalled\s+(?:the\s+)?${PKG}`),
  p(
    "dependency-removed",
    String.raw`\bremoved\s+(?:the\s+)?${PKG}\s+(?:dev[- ]?)?(?:dependency|package)\b`,
  ),
  p(
    "file-created",
    String.raw`\b(?:created|added|wrote)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:file\s+)?${PATH}`,
  ),
  p("file-deleted", String.raw`\b(?:removed|deleted)\s+(?:the\s+)?(?:file\s+)?${PATH}`),
  p(
    "file-changed",
    String.raw`\b(?:updated|modified|changed|edited|refactored|touched|tweaked)\s+(?:the\s+)?(?:file\s+)?${PATH}`,
  ),
  p("file-created", String.raw`${PATH}\s+(?:(?:was|were|is|has\s+been)\s+)?(?:created|added)\b`),
  p("file-deleted", String.raw`${PATH}\s+(?:(?:was|were|is|has\s+been)\s+)?(?:removed|deleted)\b`),
  p(
    "file-changed",
    String.raw`${PATH}\s+(?:(?:was|were|is|has\s+been)\s+)?(?:updated|modified|changed|edited|replaced|rewritten|refactored)\b`,
  ),
  p("scope", String.raw`\bonly\s+(?:touched|changed|modified|edited|updated)\s+${PHRASE}`),
  p(
    "scope",
    String.raw`\b(?:no\s+other|nothing\s+else)\s+(?:files?\s+)?(?:was\s+|were\s+)?(?:changed|touched|modified)\b`,
  ),
  p("command-ran", String.raw`\b(?:ran|executed)\s+\x60(?<cmd>[^\x60]+)\x60`),
  p(
    "command-ran",
    String.raw`\b(?:ran|applied|executed)\s+(?:the\s+|all\s+)?(?<cmd>(?:database\s+)?migrations?|seeds?|seed\s+script|formatter|codegen)\b`,
  ),
  // Commit and push claims are the most common claims in real final messages.
  p("command-ran", String.raw`\bcommitted\b(?:\s+as\s+\x60?[0-9a-f]{7,40}\x60?)?`, "git commit"),
  p(
    "command-ran",
    String.raw`\b(?:(?:\w+\s+)?commits?\s+)?pushed\b(?:\s+(?:to|as)\s+\x60?[\w./-]+\x60?)?`,
    "git push",
  ),
  p(
    "no-errors",
    String.raw`\b(?:no|zero)\s+(?:errors|warnings|issues|problems)\b|\b(?:without\s+(?:any\s+)?errors|error[- ]free)\b`,
  ),
  // "Fixed and pushed" names no bug; the subject must not start with a conjunction.
  p("bug-fixed", String.raw`\b(?:fixed|fixes)\s+(?!and\b|&|,)${PHRASE}`),
  // "resolved" and "patched" also describe paths and versions; require a problem noun.
  p(
    "bug-fixed",
    String.raw`\b(?:resolved|patched)\s+(?<phrase>(?:the\s+|a\s+|an\s+)?(?:[\w-]+\s+){0,3}?(?:bug|issue|error|crash|conflict|problem|failure|regression|warning)s?)\b`,
  ),
  p("behaviour", String.raw`\bno\s+breaking\s+changes\b`),
  p(
    "behaviour",
    String.raw`\b(?:now|should\s+now)\s+(?:correctly\s+|properly\s+)?(?:works?|loads?|renders?|shows?|returns?|handles?|feels?|displays?|responds?|runs?|behaves?)\b(?:\s+${PHRASE})?`,
  ),
  p(
    "behaviour",
    String.raw`\bis\s+(?:now\s+)?(?:noticeably\s+|much\s+)?(?:faster|smoother|snappier|more\s+responsive)\b`,
  ),
  p(
    "feature-done",
    String.raw`\b(?:implemented|introduced|wired\s+up|set\s+up|added\s+support\s+for|added)\s+(?!(?:in|to|on|at|as|and|it|them|this|that)\b)${PHRASE}`,
  ),
];

// Words that turn a match into a non-claim: negations, plans, hedges and instructions.
// Only the current clause counts: "Fixed the crash when input is empty, and all tests
// pass" is still a test claim.
const NEGATED =
  /\b(?:not|never|no\s+longer|\w+n't|unable|cannot|if|once|until|will|would|might|may|please|try|you\s+can|you\s+should|to\s+verify)\b/i;
// A sentence that opens with a condition ("Once you install zod, the build succeeds")
// makes every clause in it conditional.
const CONDITIONAL_SENTENCE = /^(?:if|once|unless|as\s+soon\s+as|after\s+you|when\s+you)\b/i;
const CLAUSE_BREAK = /,|;|\band\b|\bbut\b|\bso\b|\balso\b/gi;

export function extractPatternClaims(message: string): DraftClaim[] {
  const found: DraftClaim[] = [];
  for (const segment of splitSegments(message)) {
    if (CONDITIONAL_SENTENCE.test(segment.text)) continue;
    const inSegment: DraftClaim[] = [];
    for (const pattern of PATTERNS) {
      pattern.re.lastIndex = 0;
      for (const m of segment.text.matchAll(pattern.re)) {
        // A behaviour claim reads as a whole clause: "The parser now handles quoted
        // commas", not "now handles".
        const from = pattern.type === "behaviour" ? clauseStart(segment.text, m.index) : m.index;
        const start = segment.start + from;
        const end = segment.start + m.index + m[0].trimEnd().length;
        if (inSegment.some((c) => c.span.start < end && start < c.span.end)) continue;
        const clause = segment.text.slice(0, m.index).split(CLAUSE_BREAK).pop() ?? "";
        if (NEGATED.test(clause) || /\?\s*$/.test(segment.text)) continue;
        if (m.groups?.path && !looksLikeFile(m.groups.path)) continue;
        if (m.groups?.pkg && NOT_A_PACKAGE.has(m.groups.pkg.toLowerCase().replace(/[.]+$/, "")))
          continue;
        inSegment.push({
          text: message.slice(start, end),
          type: pattern.type,
          subject: pattern.subject ?? subjectOf(pattern.type, m.groups ?? {}),
          span: { start, end },
        });
      }
    }
    found.push(...inSegment);
  }
  return found.sort((a, b) => a.span.start - b.span.start);
}

// Patterns match case-insensitively, so "Step.userText" would pass for a file.
// A bare name (no slash) needs a lowercase extension to count as one.
function looksLikeFile(path: string): boolean {
  return path.includes("/") || /\.[a-z][a-z0-9]{0,7}$|\.[0-9][a-z0-9]{0,7}$/.test(path);
}

function clauseStart(text: string, index: number): number {
  let start = 0;
  for (const m of text.slice(0, index).matchAll(CLAUSE_BREAK)) start = m.index + m[0].length;
  while (/\s/.test(text[start] ?? "") && start < index) start++;
  return start;
}

// Words that follow "installed" without naming a package: "installed locally",
// and in a Hinglish message, "Ollama installed hai" ("Ollama is installed").
const NOT_A_PACKAGE = new Set([
  "it",
  "them",
  "this",
  "that",
  "and",
  "but",
  "now",
  "already",
  "locally",
  "globally",
  "successfully",
  "correctly",
  "fine",
  "everything",
  "all",
  "deps",
  "dependencies",
  "packages",
  "hai",
  "hain",
  "tha",
  "the",
  "a",
  "an",
]);

function subjectOf(type: ClaimType, groups: Record<string, string | undefined>): string {
  const raw = groups.path ?? groups.pkg ?? groups.cmd ?? groups.phrase ?? "";
  const subject = raw
    .trim()
    .replace(/^\x60|\x60$/g, "")
    .replace(/[.,;:]+$/, "");
  if (subject) return subject;
  if (type === "tests-pass" || type === "tests-added") return "tests";
  return type.replace(/-passes$/, "");
}
