import type { Flag, Severity } from "../types.js";
import { dangerousCommand, failingCommandIgnored } from "./commands.js";
import type { Detector, FlagContext } from "./context.js";
import {
  largeDiff,
  lockfileChurn,
  secretInDiff,
  sensitiveFile,
  unmentionedChange,
} from "./files.js";
import {
  assertionWeakened,
  coverageThresholdLowered,
  testFileModified,
  testSkipped,
} from "./tests.js";

export type { FlagContext } from "./context.js";

const DETECTORS: Detector[] = [
  testFileModified,
  testSkipped,
  assertionWeakened,
  coverageThresholdLowered,
  sensitiveFile,
  secretInDiff,
  dangerousCommand,
  lockfileChurn,
  unmentionedChange,
  largeDiff,
  failingCommandIgnored,
];

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Runs every detector, applies severity overrides from config, and sorts high first. */
export function detectFlags(ctx: FlagContext): Flag[] {
  const overrides = ctx.activity.config.severity;
  return DETECTORS.flatMap((detect) => detect(ctx) ?? [])
    .map((flag) => ({ ...flag, severity: overrides[flag.id] ?? flag.severity }))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
