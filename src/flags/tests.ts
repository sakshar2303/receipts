import { diffRef } from "../check/context.js";
import type { DiffLine, FileDiff, Flag, FlagLine } from "../types.js";
import { makeFlag, type FlagContext } from "./context.js";

const linesOf = (file: FileDiff): DiffLine[] => file.hunks.flatMap((h) => h.lines);
const changed = (file: FileDiff, kinds: DiffLine["kind"][]): FlagLine[] =>
  linesOf(file)
    .filter((l) => kinds.includes(l.kind))
    .map((line) => ({ path: file.path, line }));

/** test-file-modified: an existing test was edited or deleted, not just added to. */
export function testFileModified(ctx: FlagContext): Flag | null {
  const files = ctx.changes.files.filter(
    (f) =>
      (ctx.activity.isTestFile(f.path) || ctx.activity.isTestFile(f.oldPath)) &&
      (f.status === "deleted" ||
        f.status === "renamed" ||
        (f.status === "modified" && f.removed > 0)),
  );
  if (files.length === 0) return null;
  const deleted = files.filter((f) => f.status === "deleted").length;
  return makeFlag(
    "test-file-modified",
    `${files.length} existing test file${files.length > 1 ? "s were" : " was"} changed${deleted ? `, ${deleted} deleted` : ""}: ${files
      .map((f) => f.path)
      .slice(0, 3)
      .join(", ")}.`,
    {
      files: files.map((f) => f.path),
      evidence: files.map(diffRef),
      lines: files.flatMap((f) => changed(f, ["del", "add"]).slice(0, 12)),
    },
  );
}

// Anchored to the start of the line: a marker inside a string ("it.skip" in a
// test of this very detector, or in docs) is not a skipped test.
const SKIP =
  /^\s*(?:(?:it|test|describe|context|suite|specify)\.(?:skip|only|todo)\b|(?:xit|xtest|xdescribe|xcontext|xspecify|fit|fdescribe|ftest)\s*\(|@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.(?:skip|expectedFailure)\b|t\.Skip(?:Now|f)?\(|#\[ignore\]|pytest\.skip\(|this\.skip\(\))/;
const ASSERTION =
  /\b(?:expect|assert\w*|should)\s*[.(]|\bt\.(?:Error|Fatal|Fail)f?\(|\bself\.assert\w*\(|\bassert\s+\S/;
const COMMENTED = /^\s*(?:\/\/+|#+|\/\*+|\*)\s*/;

/** test-skipped: the diff adds a skip or focus marker, or comments out an assertion. */
export function testSkipped(ctx: FlagContext): Flag | null {
  const hits: FlagLine[] = [];
  let markers = 0;
  for (const file of ctx.changes.files) {
    const lines = linesOf(file);
    const removed = new Set(lines.filter((l) => l.kind === "del").map((l) => l.text.trim()));
    for (const line of lines) {
      if (line.kind !== "add") continue;
      const commented = COMMENTED.test(line.text);
      const bare = line.text.replace(COMMENTED, "").trim();
      const skipMarker = SKIP.test(line.text) && !commented;
      const commentedAssertion = commented && ASSERTION.test(bare) && removed.has(bare);
      if (skipMarker || (commentedAssertion && ctx.activity.isTestFile(file.path))) {
        hits.push({ path: file.path, line });
        if (skipMarker) markers++;
      }
    }
  }
  if (hits.length === 0) return null;
  const files = [...new Set(hits.map((h) => h.path))];
  return makeFlag(
    "test-skipped",
    `${describeSkips(markers, hits.length - markers)} in ${files.slice(0, 3).join(", ")}.`,
    {
      files,
      evidence: ctx.changes.files.filter((f) => files.includes(f.path)).map(diffRef),
      lines: hits,
    },
  );
}

function describeSkips(markers: number, commented: number): string {
  const parts = [
    markers ? `${markers} skip or focus marker${markers > 1 ? "s" : ""} added` : "",
    commented ? `${commented} assertion${commented > 1 ? "s" : ""} commented out` : "",
  ];
  const text = parts.filter(Boolean).join(" and ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const STRONG =
  /\.(?:toEqual|toStrictEqual|toBe|toMatchObject|toMatch|toThrow\w*|toHaveBeenCalledWith|toHaveLength|toContain)\(|assert(?:Equal|Equals|Raises|In|Is)\b|\bassert\s+[^,]+==/;
const WEAK =
  /\.(?:toBeDefined|toBeTruthy|toBeFalsy|toBeUndefined|toBeNull)\(\)|\.not\.(?:toBeNull|toBeUndefined|toThrow)\(|\.toBeGreaterThan(?:OrEqual)?\(0\)|assert(?:True|IsNotNone|Truthy)\b|\bassert\s+\w+\s*$/;

/**
 * assertion-weakened (heuristic): in a test file, an assertion was removed
 * without a replacement, or a strict matcher gave way to a loose one.
 */
export function assertionWeakened(ctx: FlagContext): Flag | null {
  const hits: FlagLine[] = [];
  for (const file of ctx.changes.files.filter(
    (f) => ctx.activity.isTestFile(f.path) && f.status !== "deleted",
  )) {
    for (const hunk of file.hunks) {
      const del = hunk.lines.filter((l) => l.kind === "del" && ASSERTION.test(l.text));
      const add = hunk.lines.filter((l) => l.kind === "add" && ASSERTION.test(l.text));
      const loosened = del.some((l) => STRONG.test(l.text)) && add.some((l) => WEAK.test(l.text));
      if (loosened || del.length > add.length) {
        hits.push(...[...del, ...add].map((line) => ({ path: file.path, line })));
      }
    }
  }
  if (hits.length === 0) return null;
  const files = [...new Set(hits.map((h) => h.path))];
  return makeFlag(
    "assertion-weakened",
    `Assertions were removed or loosened in ${files.slice(0, 3).join(", ")}.`,
    {
      files,
      evidence: ctx.changes.files.filter((f) => files.includes(f.path)).map(diffRef),
      lines: hits,
      heuristic: true,
    },
  );
}

const COVERAGE_CONFIG =
  /(?:^|\/)(?:(?:vitest|vite|jest|karma)\.config\.\w+|package\.json|\.nycrc(?:\.\w+)?|\.c8rc(?:\.\w+)?|pyproject\.toml|setup\.cfg|\.coveragerc|codecov\.ya?ml|tox\.ini)$/;
const THRESHOLD =
  /["']?\b(lines|statements|functions|branches|fail[_-]under|threshold|minimum|target|perFile|global)\b["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i;

/** coverage-threshold-lowered: a coverage number went down in a config file. */
export function coverageThresholdLowered(ctx: FlagContext): Flag | null {
  const hits: FlagLine[] = [];
  for (const file of ctx.changes.files.filter((f) => COVERAGE_CONFIG.test(f.path))) {
    const lines = linesOf(file);
    const was = new Map<string, { value: number; line: DiffLine }>();
    for (const line of lines.filter((l) => l.kind === "del")) {
      const m = THRESHOLD.exec(line.text);
      if (m?.[1] && m[2]) was.set(m[1].toLowerCase(), { value: Number(m[2]), line });
    }
    for (const line of lines.filter((l) => l.kind === "add")) {
      const m = THRESHOLD.exec(line.text);
      const before = m?.[1] ? was.get(m[1].toLowerCase()) : undefined;
      if (m?.[2] && before && Number(m[2]) < before.value) {
        hits.push({ path: file.path, line: before.line }, { path: file.path, line });
      }
    }
  }
  if (hits.length === 0) return null;
  const files = [...new Set(hits.map((h) => h.path))];
  return makeFlag(
    "coverage-threshold-lowered",
    `A coverage threshold went down in ${files.join(", ")}.`,
    {
      files,
      evidence: ctx.changes.files.filter((f) => files.includes(f.path)).map(diffRef),
      lines: hits,
    },
  );
}
