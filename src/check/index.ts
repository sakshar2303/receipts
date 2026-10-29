import type { Config } from "../config.js";
import type { ChangeSet, CheckedClaim, Claim, ClaimType, Session } from "../types.js";
import { Activity } from "./activity.js";
import type { Checker, CheckContext } from "./context.js";
import { checkDependency } from "./dependencies.js";
import { checkFileClaim, checkScope, checkTestsAdded } from "./files.js";
import { checkNeedsReview } from "./review.js";
import { checkCommandRan, checkLastRun, checkNoErrors } from "./runs.js";

const CHECKERS: Record<ClaimType, Checker> = {
  "tests-pass": (c, ctx) => checkLastRun("test", c, ctx),
  "tests-added": checkTestsAdded,
  "build-passes": (c, ctx) => checkLastRun("build", c, ctx),
  "typecheck-passes": (c, ctx) => checkLastRun("typecheck", c, ctx),
  "lint-passes": (c, ctx) => checkLastRun("lint", c, ctx),
  "file-changed": (c, ctx) => checkFileClaim("file-changed", c, ctx),
  "file-created": (c, ctx) => checkFileClaim("file-created", c, ctx),
  "file-deleted": (c, ctx) => checkFileClaim("file-deleted", c, ctx),
  "dependency-added": (c, ctx) => checkDependency("dependency-added", c, ctx),
  "dependency-removed": (c, ctx) => checkDependency("dependency-removed", c, ctx),
  "command-ran": checkCommandRan,
  "no-errors": checkNoErrors,
  "bug-fixed": (c, ctx) => checkNeedsReview("bug-fixed", c, ctx),
  "feature-done": (c, ctx) => checkNeedsReview("feature-done", c, ctx),
  behaviour: (c, ctx) => checkNeedsReview("behaviour", c, ctx),
  scope: checkScope,
};

export function buildContext(session: Session, changes: ChangeSet, config: Config): CheckContext {
  return { activity: new Activity(session, config), changes };
}

/** Runs the deterministic checker for each claim. Claim types switched off in config are dropped. */
export function checkClaims(claims: readonly Claim[], ctx: CheckContext): CheckedClaim[] {
  const enabled = ctx.activity.config.claimTypes;
  return claims
    .filter((claim) => enabled[claim.type] !== false)
    .map((claim) => ({ ...claim, ...CHECKERS[claim.type](claim, ctx) }));
}
