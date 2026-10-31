import { describe, expect, it } from "vitest";
import {
  compileKinds,
  isFilteredTestRun,
  kindsOf,
  normaliseSegment,
  splitChain,
} from "../../src/check/commands.js";
import { parseTestSummary, runOutcome } from "../../src/check/outcome.js";
import { shellWrites } from "../../src/check/shell-writes.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { runCall } from "../helpers/session.js";

const kinds = compileKinds(DEFAULT_CONFIG);
const isTest = (s: string) => kindsOf(s, kinds).includes("test");

describe("command chains", () => {
  it("splits on operators outside quotes and heredocs", () => {
    const cmd = `cd app && echo "a && b" | grep a; npm test || true\ncat > f.ts <<'EOF'\nx && y\nEOF`;
    expect(splitChain(cmd).map((s) => [s.joinedBy, s.text])).toEqual([
      ["", "cd app"],
      ["&&", 'echo "a && b"'],
      ["|", "grep a"],
      [";", "npm test"],
      ["||", "true"],
      [";", "cat > f.ts <<EOF"],
    ]);
  });

  it("normalises env, npx, timeout and redirections", () => {
    expect(normaliseSegment("CI=1 FORCE_COLOR=0 npx vitest run 2>&1")).toBe("vitest run");
    expect(normaliseSegment("timeout 60 npm test > out.txt")).toBe("npm test");
    expect(normaliseSegment("perl -e 'alarm 25; exec @ARGV' npm test")).toBe("npm test");
  });

  it.each([
    ["npm test", ["test"]],
    ["pnpm run test:unit", ["test"]],
    ["python -m pytest -q", ["test"]],
    ["go test ./...", ["test"]],
    ["npm run build", ["build"]],
    ["tsc --noEmit", ["typecheck"]],
    ["tsc -b", ["build"]],
    ["npm run lint", ["lint"]],
    ["ruff check .", ["lint"]],
    ["npm run check", ["test", "build", "typecheck", "lint"]],
    ["npm install", []],
  ])("%s runs %j", (segment, expected) => {
    expect(kindsOf(segment, kinds)).toEqual(expected);
  });

  it("knows a filtered test run from the whole suite", () => {
    expect(isFilteredTestRun("vitest run test/parser.test.ts")).toBe(true);
    expect(isFilteredTestRun("npm test -- -t parser")).toBe(true);
    expect(isFilteredTestRun("pytest -k parser")).toBe(true);
    expect(isFilteredTestRun("npm test")).toBe(false);
    expect(isFilteredTestRun("vitest run")).toBe(false);
    expect(isFilteredTestRun("go test ./...")).toBe(false);
    expect(isFilteredTestRun("pytest tests/")).toBe(false);
  });
});

describe("test output summaries", () => {
  it.each([
    ["Tests  12 passed (12)", { passed: 12, failed: 0 }],
    ["Tests  1 failed | 11 passed (12)", { passed: 11, failed: 1 }],
    ["Tests:       2 failed, 5 passed, 7 total", { passed: 5, failed: 2 }],
    ["===== 3 failed, 10 passed in 1.20s =====", { passed: 10, failed: 3 }],
    ["  14 passing (20ms)\n  1 failing", { passed: 14, failed: 1 }],
    ["test result: ok. 5 passed; 0 failed", { passed: 5, failed: 0 }],
    ["ok  \texample.com/pkg\t0.2s", { passed: 1, failed: 0 }],
    ["--- FAIL: TestParse (0.00s)\nFAIL", { passed: 0, failed: 1 }],
    ["# pass 4\n# fail 0", { passed: 4, failed: 0 }],
  ])("%s", (output, expected) => {
    expect(parseTestSummary(output)).toEqual(expected);
  });

  it("recognises runs where no tests ran", () => {
    expect(parseTestSummary("No test files found, exiting with code 1")).toBe("no-tests");
    expect(parseTestSummary("collected 0 items")).toBe("no-tests");
    expect(parseTestSummary("Tests  0 passed")).toBe("no-tests");
  });

  it("returns null when there is no summary", () => {
    expect(parseTestSummary("compiling...")).toBeNull();
  });
});

describe("run outcome", () => {
  const outcome = (command: string, exit: number | null, output = "") =>
    runOutcome(runCall(command, exit, output), isTest, "test");

  it("trusts the exit code when the test is last in an && chain", () => {
    expect(outcome("cd app && npm test", 0)?.outcome).toBe("pass");
    expect(outcome("npm ci && npm test", 1)?.outcome).toBe("fail");
  });

  it("does not trust a piped exit code without a summary", () => {
    expect(outcome("npm test 2>&1 | tail -5", 0)).toMatchObject({
      outcome: "unknown",
      why: "was piped to tail, so the exit code is not its own",
    });
    expect(outcome("npm test | tail -5", 0, "Tests  4 passed (4)")?.outcome).toBe("pass");
    expect(outcome("npm test | tail -5", 0, "Tests  1 failed | 3 passed")?.outcome).toBe("fail");
  });

  it("resolves 'npm test && npm run lint' failing by the test summary, or not at all", () => {
    expect(
      outcome("npm test && npm run lint", 1, "Tests  5 passed (5)\n✖ 2 problems")?.outcome,
    ).toBe("pass");
    expect(outcome("npm test && npm run lint", 1)?.outcome).toBe("unknown");
    expect(outcome("npm test && npm run lint", 0)?.outcome).toBe("pass");
  });

  it("does not trust '|| true'", () => {
    expect(outcome("npm test || true", 0)?.outcome).toBe("unknown");
  });

  it("reports exit 0 with failures in the output as a failure", () => {
    expect(outcome("npm test", 0, "Tests  2 failed | 3 passed")?.outcome).toBe("fail");
  });

  it("treats no tests as its own outcome and skips denied runs", () => {
    expect(outcome("npm test", 0, "No test files found")?.outcome).toBe("no-tests");
    const denied = {
      ...runCall("npm test", null),
      status: "error" as const,
      note: "the command did not run",
    };
    expect(runOutcome(denied, isTest, "test")?.outcome).toBe("not-run");
  });

  it("returns null when the command is not a test run", () => {
    expect(outcome("ls -la", 0)).toBeNull();
  });
});

describe("shell writes", () => {
  const paths = (cmd: string) => shellWrites(cmd, "/work/app").map((w) => w.path);

  it("finds files written by redirects, sed -i, tee, mv, cp and rm", () => {
    expect(paths("cat > src/a.ts <<'EOF'\nexport {}\nEOF")).toEqual(["src/a.ts"]);
    expect(paths("sed -i '' 's/a/b/' src/b.ts")).toEqual(["src/b.ts"]);
    expect(paths("echo x | tee -a notes.md")).toEqual(["notes.md"]);
    expect(paths("mv src/old.ts src/new.ts")).toEqual(["src/old.ts", "src/new.ts"]);
    expect(paths("rm -f src/gone.ts")).toEqual(["src/gone.ts"]);
    expect(paths("cd src && echo y > c.ts")).toEqual(["src/c.ts"]);
  });

  it("ignores stderr merges, /dev/null and quoted comparisons", () => {
    expect(paths("npm test 2>&1 > /dev/null")).toEqual([]);
    expect(paths(`awk '{ if ($1 > 5) print }' data.csv`)).toEqual([]);
  });

  it("marks inline scripts, formatters and git rewrites as unknown writes", () => {
    expect(paths("python3 - <<'EOF'\nopen('x','w')\nEOF")).toEqual([null]);
    expect(paths("npx prettier --write .")).toEqual([null]);
    expect(paths("git checkout -- src/a.ts")).toEqual([null]);
  });

  it("maps package installs to the manifest and lockfile", () => {
    expect(paths("npm install zod")).toEqual(["package.json", "package-lock.json"]);
  });
});

describe("output-based outcomes", () => {
  const typecheck = (cmd: string, exit: number, output = "") =>
    runOutcome(
      runCall(cmd, exit, output),
      (s) => kindsOf(s, kinds).includes("typecheck"),
      "typecheck",
    );
  const push = (cmd: string, exit: number, output = "") =>
    runOutcome(runCall(cmd, exit, output), (s) => s.startsWith("git push"), "command");

  it("trusts a clean tail for compilers and linters, and errors in it as failure", () => {
    expect(typecheck("npm run typecheck 2>&1 | tail -5", 0)?.why).toBe(
      "was piped to tail, and its output shows no errors",
    );
    expect(typecheck("npm run typecheck | tail", 0, "src/a.ts(1,1): error TS2304")?.outcome).toBe(
      "fail",
    );
    expect(typecheck("npm run typecheck | grep -c x", 0)?.outcome).toBe("unknown");
  });

  it("reads a piped git push from its output", () => {
    expect(
      push("git push origin main 2>&1 | tail -2", 0, "   abc..def  main -> main")?.outcome,
    ).toBe("pass");
    expect(push("git push 2>&1 | tail -2", 0, " ! [rejected] main -> main")?.outcome).toBe("fail");
    expect(push("git push 2>&1 | tail -2", 0, "")?.outcome).toBe("unknown");
  });

  it("trusts the exit code of a command that follows ';'", () => {
    expect(typecheck("cd app; npm run typecheck", 2)?.outcome).toBe("fail");
    expect(typecheck("npm run typecheck; echo done", 0)?.why).toBe(
      "was followed by another command, so the exit code is not its own",
    );
  });
});

describe("inline scripts", () => {
  it("count as writers only when they call a write API", () => {
    expect(shellWrites(`node -e "console.log(require('./package.json').version)"`, "/w")).toEqual(
      [],
    );
    expect(shellWrites(`node -e "require('fs').writeFileSync('a.ts', '')"`, "/w")).toEqual([
      { path: null, what: "an inline script" },
    ]);
    expect(shellWrites("git checkout -b feature", "/w")).toEqual([]);
  });
});

describe("exit 0 in && chains", () => {
  const test = (cmd: string, exit: number) => runOutcome(runCall(cmd, exit), isTest, "test");

  it("proves a check that is followed by &&", () => {
    expect(
      test("npm test && git add -A && git commit -m x && git push 2>&1 | tail -2", 0)?.outcome,
    ).toBe("pass");
    expect(test("npm test && npm run lint", 0)?.why).toBe("exited 0 in an && chain");
  });

  it("does not when || or a later ; could hide the code", () => {
    expect(test("npm test && echo ok || echo failed", 0)?.outcome).toBe("unknown");
    expect(test("npm test && echo ok; true", 0)?.outcome).toBe("unknown");
  });
});
