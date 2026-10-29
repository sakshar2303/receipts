import { describe, expect, it } from "vitest";
import { extractPatternClaims } from "../../src/extract/patterns.js";
import { splitSegments } from "../../src/extract/segments.js";

const types = (message: string) => extractPatternClaims(message).map((c) => [c.type, c.subject]);

describe("segments", () => {
  it("splits sentences and bullets with exact offsets and skips code and headings", () => {
    const msg =
      "## Summary\nUpdated src/a.ts. All tests pass.\n- Added docs/api.md\n```\nnpm test passes\n```";
    const segments = splitSegments(msg);
    expect(segments.map((s) => s.text)).toEqual([
      "Updated src/a.ts.",
      "All tests pass.",
      "Added docs/api.md",
    ]);
    for (const s of segments) expect(msg.slice(s.start, s.end)).toBe(s.text);
  });
});

describe("pattern extractor", () => {
  it.each([
    ["All tests pass.", "tests-pass", "tests"],
    ["Tests are passing now.", "tests-pass", "tests"],
    ["12 tests pass.", "tests-pass", "tests"],
    ["The test suite is green.", "tests-pass", "tests"],
    ["Added tests for the empty-input case.", "tests-added", "the empty-input case"],
    ["Wrote two new regression tests.", "tests-added", "tests"],
    ["The build succeeds.", "build-passes", "build"],
    ["It compiles cleanly.", "build-passes", "build"],
    ["Typecheck passes.", "typecheck-passes", "typecheck"],
    ["No type errors.", "typecheck-passes", "typecheck"],
    ["Lint is clean.", "lint-passes", "lint"],
    ["Updated `src/auth.ts`.", "file-changed", "src/auth.ts"],
    ["Modified the file README.md.", "file-changed", "README.md"],
    ["Created docs/api.md with examples.", "file-created", "docs/api.md"],
    ["Deleted src/legacy/old.ts.", "file-deleted", "src/legacy/old.ts"],
    ["Installed zod.", "dependency-added", "zod"],
    ["Added @types/node as a dev dependency.", "dependency-added", "@types/node"],
    ["Removed the lodash dependency.", "dependency-removed", "lodash"],
    ["Ran `npm run migrate`.", "command-ran", "npm run migrate"],
    ["Ran the migrations.", "command-ran", "migrations"],
    ["There are no errors.", "no-errors", "no-errors"],
    ["Fixed the login redirect loop.", "bug-fixed", "the login redirect loop"],
    ["The dropdown now feels faster.", "behaviour", ""],
    ["No breaking changes.", "behaviour", "behaviour"],
    ["Only touched the parser module.", "scope", "the parser module"],
    ["Implemented dark mode.", "feature-done", "dark mode"],
    ["`npm test` 6/6 passing.", "tests-pass", "tests"],
    ["243/243 passing.", "tests-pass", "tests"],
    ["`npm run typecheck` clean.", "typecheck-passes", "typecheck"],
    ["`pnpm lint` passes.", "lint-passes", "lint"],
    ["`docs/demo.mp4` replaced.", "file-changed", "docs/demo.mp4"],
    ["src/new.ts was added.", "file-created", "src/new.ts"],
    ["Committed as `a4b5c6d`.", "command-ran", "git commit"],
    ["Five commits pushed to `main`.", "command-ran", "git push"],
    ["Resolved the merge conflict in the lockfile.", "bug-fixed", "the merge conflict"],
  ])("%s -> %s", (message, type, subject) => {
    const [claim] = extractPatternClaims(message);
    expect(claim?.type).toBe(type);
    if (subject) expect(claim?.subject).toBe(subject);
  });

  it("finds several claims in one sentence, each with an exact span", () => {
    const msg = "Fixed the parser crash on empty input and updated src/parser.ts. All tests pass.";
    const claims = extractPatternClaims(msg);
    expect(claims.map((c) => [c.type, c.text])).toEqual([
      ["bug-fixed", "Fixed the parser crash on empty input"],
      ["file-changed", "updated src/parser.ts"],
      ["tests-pass", "All tests pass"],
    ]);
    for (const c of claims) expect(msg.slice(c.span.start, c.span.end)).toBe(c.text);
  });

  it("prefers the specific claim when patterns overlap", () => {
    expect(types("No lint errors.")).toEqual([["lint-passes", "lint"]]);
    expect(types("Added tests for parse().")).toEqual([["tests-added", "parse()"]]);
  });

  it("ignores negations, plans, questions and instructions", () => {
    expect(types("The tests do not pass yet.")).toEqual([]);
    expect(types("I couldn't get the build passes to work.")).toEqual([]);
    expect(types("Once you install zod, the build succeeds.")).toEqual([]);
    expect(types("Should I update src/a.ts?")).toEqual([]);
    expect(types("I will add tests for this next.")).toEqual([]);
    expect(types("You can run `npm test` to verify all tests pass.")).toEqual([]);
  });

  it("keeps a later clause after a conditional one", () => {
    expect(types("Fixed the crash when input is empty, and all tests pass.")).toEqual([
      ["bug-fixed", "the crash when input is empty"],
      ["tests-pass", "tests"],
    ]);
  });

  it("does not read a fix out of a commit message or a path resolution", () => {
    expect(types("Fixed and pushed as `20e81c0`.")).toEqual([["command-ran", "git push"]]);
    expect(types("Paths are resolved against the session cwd.")).toEqual([]);
    expect(types("The helper was added in src/types.")).toEqual([]);
  });

  it("does not take version numbers for paths", () => {
    expect(types("Updated to v1.2.")).toEqual([]);
    expect(types("`Step.userText` added.")).toEqual([]);
  });
});
