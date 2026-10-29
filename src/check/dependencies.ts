import type { CheckResult, Claim } from "../types.js";
import { runRef, stepLabel } from "./activity.js";
import { absent, diffRef, type CheckContext } from "./context.js";

const INSTALL =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)|pip3?\s+install|poetry\s+add|uv\s+(?:add|pip\s+install)|cargo\s+add|go\s+get|gem\s+install|bundle\s+add|composer\s+require)\b/;
const UNINSTALL =
  /^(?:(?:npm|pnpm|yarn|bun)\s+(?:remove|rm|uninstall|un)|pip3?\s+uninstall|poetry\s+remove|uv\s+remove|cargo\s+remove)\b/;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * dependency-added and dependency-removed: the manifest diff must show the
 * package. An install command alone is not enough; installs can fail
 * silently or land in the wrong project.
 */
export function checkDependency(
  kind: "dependency-added" | "dependency-removed",
  claim: Claim,
  ctx: CheckContext,
): CheckResult {
  const name = claim.subject
    .trim()
    .replace(/^`|`$/g, "")
    .replace(/@[\d^~<>=.*x-]+$/, "");
  const nameRe = new RegExp(`(?:^|["'\\s/])${escape(name)}(?=["'\\s=<>~^@:\\[,]|$)`, "i");
  const manifests = ctx.changes.files.filter((f) => ctx.activity.isManifest(f.path));
  const want = kind === "dependency-added" ? "add" : "del";
  const other = want === "add" ? "del" : "add";

  for (const file of manifests) {
    const lines = file.hunks.flatMap((h) => h.lines);
    const hit = lines.some((l) => l.kind === want && nameRe.test(l.text));
    // A version bump removes and re-adds the line; that is neither an add nor a removal.
    const undone = lines.some((l) => l.kind === other && nameRe.test(l.text));
    if (hit && !undone) {
      return {
        verdict: "verified",
        evidence: [diffRef(file)],
        reason: `${file.path} ${want === "add" ? "adds" : "drops"} ${name}.`,
      };
    }
  }

  const cmdRe = kind === "dependency-added" ? INSTALL : UNINSTALL;
  const install = ctx.activity.runsMatching((s) => cmdRe.test(s) && nameRe.test(` ${s}`)).at(-1);
  if (install) {
    return {
      verdict: "unverified",
      evidence: [runRef(install)],
      reason: `${kind === "dependency-added" ? "Install" : "Uninstall"} ran at ${stepLabel(install.stepIndex)}, but no manifest change shows ${name}.`,
    };
  }
  return absent(
    ctx,
    `No manifest change mentions ${name}.`,
    `No manifest change or install command mentions ${name}.`,
  );
}
