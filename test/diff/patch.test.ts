import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseUnifiedDiff, readPatchFile } from "../../src/diff/patch.js";
import { ReceiptsError } from "../../src/errors.js";

const GIT_DIFF = `diff --git a/src/parser.ts b/src/parser.ts
index 1111111..2222222 100644
--- a/src/parser.ts
+++ b/src/parser.ts
@@ -1,3 +1,4 @@
 export function parse(input: string) {
+  if (!input) return [];
   return input.split(",");
 }
diff --git a/docs/new.md b/docs/new.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/docs/new.md
@@ -0,0 +1,2 @@
+# New
+Text
diff --git a/old.txt b/old.txt
deleted file mode 100644
index 4444444..0000000
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/src/a.ts b/src/b.ts
similarity index 90%
rename from src/a.ts
rename to src/b.ts
index 5555555..6666666 100644
--- a/src/a.ts
+++ b/src/b.ts
@@ -1,2 +1,2 @@
-const a = 1;
+const b = 1;
 export {};
diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..7777777
Binary files /dev/null and b/logo.png differ
`;

describe("unified diff parser", () => {
  const files = parseUnifiedDiff(GIT_DIFF);
  const byPath = (p: string) => files.find((f) => f.path === p);

  it("reads statuses, renames and binary files", () => {
    expect(files.map((f) => [f.path, f.status, f.binary])).toEqual([
      ["src/parser.ts", "modified", false],
      ["docs/new.md", "added", false],
      ["old.txt", "deleted", false],
      ["src/b.ts", "renamed", false],
      ["logo.png", "added", true],
    ]);
    expect(byPath("src/b.ts")?.oldPath).toBe("src/a.ts");
  });

  it("counts lines and keeps line numbers", () => {
    const parser = byPath("src/parser.ts");
    expect([parser?.added, parser?.removed]).toEqual([1, 0]);
    expect(parser?.hunks[0]?.lines[1]).toEqual({
      kind: "add",
      text: "  if (!input) return [];",
      oldLine: null,
      newLine: 2,
    });
    expect(byPath("old.txt")?.removed).toBe(1);
  });

  it("treats a removed line that starts with dashes as a body line, not a header", () => {
    const patch = `--- a/x.sql
+++ b/x.sql
@@ -1,2 +1,1 @@
--- drop this comment
 select 1;
`;
    const [file] = parseUnifiedDiff(patch);
    expect(file?.removed).toBe(1);
    expect(file?.hunks[0]?.lines[0]?.text).toBe("-- drop this comment");
  });

  it("parses plain diff -u patches with several files and CRLF endings", () => {
    const patch = [
      "--- a.txt\t2026-01-01",
      "+++ a.txt\t2026-01-02",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "--- b.txt",
      "+++ b.txt",
      "@@ -1 +1,2 @@",
      " k",
      "+z",
      "",
    ].join("\r\n");
    expect(parseUnifiedDiff(patch).map((f) => [f.path, f.added, f.removed])).toEqual([
      ["a.txt", 1, 1],
      ["b.txt", 1, 0],
    ]);
  });

  it("unquotes paths git escapes, including UTF-8 bytes", () => {
    const patch = `diff --git "a/caf\\303\\251 menu.txt" "b/caf\\303\\251 menu.txt"
--- "a/caf\\303\\251 menu.txt"
+++ "b/caf\\303\\251 menu.txt"
@@ -1 +1 @@
-a
+b
`;
    expect(parseUnifiedDiff(patch)[0]?.path).toBe("café menu.txt");
  });

  it("reads non-UTF-8 patch files without failing", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "receipts-patch-")), "x.patch");
    const body = Buffer.concat([
      Buffer.from("--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+"),
      Buffer.from([0xff, 0xfe]),
      Buffer.from("\n"),
    ]);
    writeFileSync(file, body);
    expect(readPatchFile(file)[0]?.hunks[0]?.lines[0]?.text).toBe("��");
  });

  it("reports a missing patch file as input-not-found", () => {
    let caught: unknown;
    try {
      readPatchFile("/no/such.patch");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReceiptsError);
    expect((caught as ReceiptsError).exitCode).toBe(3);
  });
});
