import type { CheckResult, Claim, EvidenceRef } from "../types.js";
import { stepLabel, writeRef } from "./activity.js";
import { absent, diffRef, listPaths, type CheckContext } from "./context.js";
import { cleanClaimPath, matchPaths, sharesToken, tokens } from "./paths.js";

type FileKind = "file-changed" | "file-created" | "file-deleted";

/** file-changed, file-created and file-deleted: the diff decides, the edit records explain. */
export function checkFileClaim(kind: FileKind, claim: Claim, ctx: CheckContext): CheckResult {
  const name = cleanClaimPath(claim.subject);
  const files = ctx.changes.files;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const byOldPath = new Map(files.map((f) => [f.oldPath, f]));
  const hits = matchPaths(
    name,
    files.map((f) => f.path),
  ).flatMap((p) => byPath.get(p) ?? []);
  const movedFrom = matchPaths(
    name,
    files.filter((f) => f.status === "renamed").map((f) => f.oldPath),
  ).flatMap((p) => byOldPath.get(p) ?? []);

  if (kind === "file-deleted") {
    const gone = [...hits.filter((f) => f.status === "deleted"), ...movedFrom];
    if (gone.length) {
      return {
        verdict: "verified",
        evidence: gone.map(diffRef),
        reason: `The diff shows ${gone[0]?.oldPath} removed.`,
      };
    }
    const rm = ctx.activity.writes.find(
      (w) => w.what === "rm" && w.path && matchPaths(name, [w.path]).length,
    );
    if (rm && ctx.changes.source === "transcript") {
      return {
        verdict: "verified",
        evidence: [writeRef(rm)],
        reason: `rm removed ${rm.path} at ${stepLabel(rm.stepIndex)}.`,
      };
    }
    if (hits.length) {
      return {
        verdict: "contradicted",
        evidence: hits.map(diffRef),
        reason: `${hits[0]?.path} is still in the diff as ${hits[0]?.status}, not deleted.`,
      };
    }
    return absent(
      ctx,
      `The diff does not show ${name} deleted.`,
      `No record shows ${name} deleted.`,
    );
  }

  if (hits.length) {
    const evidence = hits.map(diffRef);
    if (kind === "file-created") {
      const created = hits.filter((f) => f.status === "added" || f.status === "renamed");
      if (created.length)
        return {
          verdict: "verified",
          evidence,
          reason: `The diff shows ${created[0]?.path} as a new file.`,
        };
      return {
        verdict: "contradicted",
        evidence,
        reason: `${hits[0]?.path} already existed; the diff shows it ${hits[0]?.status}, not created.`,
      };
    }
    const f = hits[0];
    return {
      verdict: "verified",
      evidence,
      reason: `The diff shows ${f?.path} ${f?.status} (+${f?.added} -${f?.removed}).`,
    };
  }

  // Not in the diff. Did the agent touch it at all?
  const writes = ctx.activity.writes.filter(
    (w) => w.path !== null && matchPaths(name, [w.path]).length > 0,
  );
  const lastWrite = writes.at(-1);
  if (lastWrite) {
    const evidence: EvidenceRef[] = [writeRef(lastWrite)];
    return absent(
      ctx,
      `${lastWrite.path} was changed at ${stepLabel(lastWrite.stepIndex)}, but the diff shows no change to it.`,
      `${lastWrite.path} was changed by ${lastWrite.what} at ${stepLabel(lastWrite.stepIndex)}, but there is no diff to confirm it.`,
      evidence,
    );
  }
  return absent(
    ctx,
    `${name} does not appear in the diff.`,
    `No record shows a change to ${name}.`,
  );
}

/** tests-added: a test file in the change set gained lines. */
export function checkTestsAdded(_claim: Claim, ctx: CheckContext): CheckResult {
  const { activity } = ctx;
  const testFiles = ctx.changes.files.filter((f) => activity.isTestFile(f.path));
  const grown = testFiles.filter((f) => f.added > 0);
  if (grown.length) {
    return {
      verdict: "verified",
      evidence: grown.map(diffRef),
      reason: `Test files gained lines: ${listPaths(grown.map((f) => f.path))}.`,
    };
  }
  if (testFiles.length) {
    return {
      verdict: "contradicted",
      evidence: testFiles.map(diffRef),
      reason: `Test files changed, but no test lines were added: ${listPaths(testFiles.map((f) => f.path))}.`,
    };
  }
  const shellTests = activity.writes.filter(
    (w) => w.via === "shell" && w.path && activity.isTestFile(w.path),
  );
  return absent(
    ctx,
    "No test file was added or changed in the diff.",
    shellTests.length
      ? `Test files were written by shell commands (${listPaths(shellTests.flatMap((w) => w.path ?? []))}), but there is no diff to confirm it.`
      : "No test file change appears in the agent's edit records.",
    shellTests.map(writeRef),
  );
}

/** scope: every changed file must belong to what the claim names. */
export function checkScope(claim: Claim, ctx: CheckContext): CheckResult {
  const wanted = tokens(claim.subject);
  if (wanted.size === 0) {
    return {
      verdict: "needs-review",
      evidence: [],
      reason:
        "The claim does not name what was in scope, so a person needs to compare it with the changed files.",
    };
  }
  const files = ctx.changes.files;
  if (files.length === 0) {
    return {
      verdict: "unverified",
      evidence: [],
      reason: "There are no changed files to compare with the claimed scope.",
    };
  }
  const extra = files.filter((f) => !sharesToken(wanted, tokens(f.path)));
  if (extra.length === 0) {
    return {
      verdict: "verified",
      evidence: files.slice(0, 5).map(diffRef),
      reason: `All ${files.length} changed files match "${claim.subject}".`,
    };
  }
  return {
    verdict: "contradicted",
    evidence: extra.slice(0, 5).map(diffRef),
    reason: `Files outside "${claim.subject}" also changed: ${listPaths(extra.map((f) => f.path))}.`,
  };
}
