import { describe, expect, it } from "vitest";
import { buildContext, checkClaims } from "../../src/check/index.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import type { ToolCall } from "../../src/types.js";
import { add, check, claim, del, file, gitChanges } from "../helpers/checks.js";
import { editCall, makeSession, runCall } from "../helpers/session.js";

const pass = (cmd = "npm test") => runCall(cmd, 0, "Tests  8 passed (8)");
const fail = (cmd = "npm test") => runCall(cmd, 1, "Tests  1 failed | 7 passed (8)");
const steps = (...calls: ToolCall[][]) => calls.map((tools) => ({ tools }));

describe("tests-pass", () => {
  it("verifies when the last run passed after the final edit", () => {
    const r = check(
      "tests-pass",
      steps([editCall("src/a.ts")], [fail()], [editCall("src/a.ts")], [pass()]),
    );
    expect(r.verdict).toBe("verified");
    expect(r.reason).toBe(
      "Last test run (step 4, npm test) exited 0, after the last code edit at step 3.",
    );
  });

  it("is stale when code changed after the last passing run", () => {
    const r = check("tests-pass", steps([pass()], [editCall("src/parser.ts")]));
    expect(r.verdict).toBe("stale");
    expect(r.reason).toBe(
      "Last test run passed at step 1, but src/parser.ts was edited at step 2 after it.",
    );
    expect(r.evidence.map((e) => e.kind)).toEqual(["run", "edit"]);
  });

  it("is not stale when only docs changed after the run", () => {
    expect(check("tests-pass", steps([pass()], [editCall("README.md")])).verdict).toBe("verified");
  });

  it("is stale when a shell command rewrote code after the run", () => {
    const sed = runCall("sed -i '' 's/a/b/' src/a.ts", 0);
    expect(check("tests-pass", steps([pass()], [sed])).reason).toContain(
      "src/a.ts was changed by sed -i at step 2",
    );
    const script = runCall("python3 - <<'EOF'\nopen('src/a.ts', 'w').write('x')\nEOF", 0);
    expect(check("tests-pass", steps([pass()], [script])).reason).toContain(
      "an inline script at step 2 may have changed files",
    );
  });

  it("is contradicted when the last run failed", () => {
    const r = check("tests-pass", steps([pass()], [fail()]));
    expect(r).toMatchObject({
      verdict: "contradicted",
      reason: "Last test run (step 2, npm test) exited 1.",
    });
  });

  it("is contradicted when no tests ran", () => {
    const r = check(
      "tests-pass",
      steps([runCall("npx vitest run", 1, "No test files found, exiting with code 1")]),
    );
    expect(r.reason).toBe("Last test run (step 1, vitest run) reported that no tests ran.");
  });

  it("is unverified when tests never ran, or no tools ran at all", () => {
    expect(check("tests-pass", steps([editCall("src/a.ts")])).reason).toBe(
      "No test command ran in this session.",
    );
    expect(check("tests-pass", [{ text: "done" }]).reason).toBe("No tools ran in this session.");
  });

  it("is unverified when the last run was interrupted", () => {
    const r = check("tests-pass", steps([pass()], [runCall("npm test", null)]));
    expect(r.verdict).toBe("unverified");
  });

  it("ignores a denied run and judges the run before it", () => {
    const denied = {
      ...runCall("npm test", null),
      status: "error" as const,
      note: "the command did not run",
    };
    expect(check("tests-pass", steps([fail()], [denied])).verdict).toBe("contradicted");
  });

  it("reads 'npm test && npm run lint' with lint failing from the test summary", () => {
    const chain = runCall("npm test && npm run lint", 1, "Tests  5 passed (5)\n✖ 3 problems");
    expect(check("tests-pass", steps([chain])).verdict).toBe("verified");
    const bare = runCall("npm test && npm run lint", 1);
    expect(check("tests-pass", steps([bare])).reason).toBe(
      "Last test run (step 1, npm test) was part of a chain that exited 1, and it is unclear which command failed.",
    );
  });

  it("counts a sub-agent's run and says so", () => {
    const r = check("tests-pass", [{ tools: [pass()], isSidechain: true }]);
    expect(r.verdict).toBe("verified");
    expect(r.reason).toContain("step 1 by a sub-agent");
    expect(r.evidence[0]).toMatchObject({ kind: "run", isSidechain: true });
  });

  it("does not accept a filtered run for 'all tests pass'", () => {
    const r = check("tests-pass", steps([pass("npx vitest run test/parser.test.ts")]));
    expect(r.reason).toContain("ran only part of the suite");
    const scoped = check("tests-pass", steps([pass("npx vitest run test/parser.test.ts")]), {
      text: "The parser tests pass",
    });
    expect(scoped.verdict).toBe("verified");
  });

  it("accepts a composite check script", () => {
    expect(check("tests-pass", steps([runCall("npm run check", 0)])).verdict).toBe("verified");
  });
});

describe("build, typecheck and lint", () => {
  it("verifies, contradicts and goes stale like tests", () => {
    expect(check("build-passes", steps([runCall("npm run build", 0)])).verdict).toBe("verified");
    expect(check("typecheck-passes", steps([runCall("npx tsc --noEmit", 2)])).verdict).toBe(
      "contradicted",
    );
    expect(
      check("lint-passes", steps([runCall("npm run lint", 0)], [editCall("src/a.ts")])).verdict,
    ).toBe("stale");
  });

  it("does not let a test-only edit make a build claim stale", () => {
    const r = check(
      "build-passes",
      steps([runCall("npm run build", 0)], [editCall("test/a.test.ts")]),
    );
    expect(r.verdict).toBe("verified");
  });

  it("reads typecheck errors printed through a pipe", () => {
    const piped = runCall("npx tsc --noEmit | head", 0, "src/a.ts(3,1): error TS2322: nope");
    expect(check("typecheck-passes", steps([piped])).verdict).toBe("contradicted");
  });
});

describe("tests-added", () => {
  it("verifies when a test file gained lines", () => {
    const r = check("tests-added", [], {
      changes: gitChanges([file("test/parser.test.ts", "added", 20)]),
    });
    expect(r).toMatchObject({
      verdict: "verified",
      reason: "Test files gained lines: test/parser.test.ts.",
    });
  });

  it("contradicts when test files only lost lines, or none changed", () => {
    expect(
      check("tests-added", [], { changes: gitChanges([file("src/x.spec.ts", "modified", 0, 5)]) })
        .verdict,
    ).toBe("contradicted");
    expect(check("tests-added", [], { changes: gitChanges([file("src/a.ts")]) }).reason).toBe(
      "No test file was added or changed in the diff.",
    );
  });

  it("stays unverified without a git diff", () => {
    const r = check("tests-added", [], {
      changes: { source: "transcript", label: "", files: [], notice: "x" },
    });
    expect(r.verdict).toBe("unverified");
  });
});

describe("file claims", () => {
  const changes = gitChanges([
    file("src/auth/session.ts"),
    file("docs/api.md", "added", 30),
    file("src/legacy.ts", "deleted", 0, 40),
  ]);

  it("matches paths loosely and verifies from the diff", () => {
    expect(check("file-changed", [], { subject: "session.ts", changes }).verdict).toBe("verified");
    expect(check("file-changed", [], { subject: "auth/session.ts", changes }).verdict).toBe(
      "verified",
    );
    expect(check("file-changed", [], { subject: "src/auth/", changes }).verdict).toBe("verified");
    expect(check("file-created", [], { subject: "docs/api.md", changes }).verdict).toBe("verified");
    expect(check("file-deleted", [], { subject: "src/legacy.ts", changes }).verdict).toBe(
      "verified",
    );
  });

  it("contradicts a created claim for a file that already existed", () => {
    const r = check("file-created", [], { subject: "src/auth/session.ts", changes });
    expect(r.reason).toBe(
      "src/auth/session.ts already existed; the diff shows it modified, not created.",
    );
  });

  it("contradicts a file the diff does not show, and explains an edit that was undone", () => {
    expect(check("file-changed", [], { subject: "src/other.ts", changes }).reason).toBe(
      "src/other.ts does not appear in the diff.",
    );
    const r = check("file-changed", steps([editCall("src/reverted.ts")]), {
      subject: "src/reverted.ts",
      changes,
    });
    expect(r.reason).toBe(
      "src/reverted.ts was changed at step 1, but the diff shows no change to it.",
    );
  });

  it("does not contradict when the diff range was a guess", () => {
    const guessed = gitChanges([], {
      notice: "The repository has commits made after this session ended",
    });
    expect(check("file-changed", [], { subject: "src/other.ts", changes: guessed }).verdict).toBe(
      "unverified",
    );
  });
});

describe("dependencies", () => {
  const manifest = file("package.json", "modified", 1, 0, [add('    "zod": "^4.1.0",')]);

  it("verifies from the manifest diff", () => {
    expect(
      check("dependency-added", [], { subject: "zod", changes: gitChanges([manifest]) }).verdict,
    ).toBe("verified");
  });

  it("is unverified when an install ran but the manifest did not change", () => {
    const r = check("dependency-added", steps([runCall("npm install zod", 0)]), { subject: "zod" });
    expect(r.reason).toBe("Install ran at step 1, but no manifest change shows zod.");
  });

  it("contradicts when nothing mentions the package", () => {
    expect(check("dependency-added", [], { subject: "zod" }).verdict).toBe("contradicted");
  });

  it("does not count a version bump as an addition", () => {
    const bump = file("package.json", "modified", 1, 1, [
      del('    "zod": "^3.0.0",'),
      add('    "zod": "^4.0.0",'),
    ]);
    expect(
      check("dependency-added", [], { subject: "zod", changes: gitChanges([bump]) }).verdict,
    ).toBe("contradicted");
  });

  it("verifies a removal", () => {
    const removed = file("package.json", "modified", 0, 1, [del('    "lodash": "^4.17.21",')]);
    expect(
      check("dependency-removed", [], { subject: "lodash", changes: gitChanges([removed]) })
        .verdict,
    ).toBe("verified");
  });
});

describe("command-ran", () => {
  it("follows the exit code of git push and git commit", () => {
    expect(
      check("command-ran", steps([runCall("git push origin main", 0)]), { subject: "git push" })
        .verdict,
    ).toBe("verified");
    const rejected = runCall("git push", 1, " ! [rejected] main -> main (fetch first)");
    expect(check("command-ran", steps([rejected]), { subject: "git push" }).verdict).toBe(
      "contradicted",
    );
    expect(
      check("command-ran", steps([runCall("git add -A && git commit -m x", 0)]), {
        subject: "git commit",
      }).verdict,
    ).toBe("verified");
  });

  it("matches a named command and is unverified when none ran", () => {
    const r = check("command-ran", steps([runCall("npx prisma migrate deploy", 0)]), {
      subject: "migrations",
    });
    expect(r.verdict).toBe("verified");
    expect(check("command-ran", [], { subject: "npm run seed" }).reason).toBe(
      'No command matching "npm run seed" appears in the transcript.',
    );
  });
});

describe("no-errors", () => {
  it("contradicts on a failure after the last edit", () => {
    const r = check("no-errors", steps([editCall("src/a.ts")], [runCall("node scripts/x.js", 1)]));
    expect(r.verdict).toBe("contradicted");
  });

  it("verifies when a passing check ran after the last edit", () => {
    expect(check("no-errors", steps([editCall("src/a.ts")], [pass()])).verdict).toBe("verified");
  });

  it("is unverified when nothing ran after the last edit", () => {
    expect(check("no-errors", steps([pass()], [editCall("src/a.ts")])).verdict).toBe("unverified");
  });
});

describe("needs-review claims", () => {
  it("never verifies behaviour, even with passing tests, and attaches related context", () => {
    const changes = gitChanges([file("src/auth/redirect.ts"), file("src/ui/button.tsx")]);
    for (const type of ["bug-fixed", "feature-done", "behaviour"] as const) {
      const r = check(type, steps([pass()]), {
        subject: "the login redirect loop",
        text: "Fixed the login redirect loop",
        changes,
      });
      expect(r.verdict).toBe("needs-review");
      expect(r.evidence.map((e) => (e.kind === "diff" ? e.path : e.kind))).toEqual([
        "src/auth/redirect.ts",
        "run",
      ]);
    }
  });
});

describe("scope", () => {
  it("verifies when every changed file matches, and lists the ones that do not", () => {
    const changes = gitChanges([file("src/parser/index.ts"), file("test/parser.test.ts")]);
    expect(check("scope", [], { subject: "the parser", changes }).verdict).toBe("verified");
    const wider = gitChanges([
      file("src/parser/index.ts"),
      file("src/auth.ts"),
      file("package.json"),
    ]);
    expect(check("scope", [], { subject: "the parser", changes: wider }).reason).toBe(
      'Files outside "the parser" also changed: src/auth.ts, package.json.',
    );
  });

  it("needs review when the claim names nothing", () => {
    expect(check("scope", [], { subject: "" }).verdict).toBe("needs-review");
  });
});

describe("config", () => {
  it("drops claim types that are switched off", () => {
    const config = { ...DEFAULT_CONFIG, claimTypes: { "tests-pass": false } };
    const ctx = buildContext(makeSession("/work/app"), gitChanges(), config);
    expect(checkClaims([claim("tests-pass")], ctx)).toEqual([]);
  });
});
