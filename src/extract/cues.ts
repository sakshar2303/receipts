import type { ClaimType } from "../types.js";

const PATH_LIKE = /[\w.-]+\/[\w./-]+|[\w-]+\.[A-Za-z][A-Za-z0-9]{0,9}\b/;

/**
 * Words a claim of each type cannot be written without. A model's type is
 * kept only when its quoted text contains the cue: on real data a small local
 * model labelled a résumé's skill list ("Redis", "Agile/Scrum") as dependency
 * and scope claims. Types about behaviour have no cue; they become needs-review.
 */
const CUES: Partial<Record<ClaimType, RegExp>> = {
  "tests-pass": /\btests?\b|\bspecs?\b|\d+\s*\/\s*\d+\s+pass/i,
  "tests-added": /\btests?\b|\bspecs?\b/i,
  "build-passes": /\bbuild|compil/i,
  "typecheck-passes": /type|\btsc\b|mypy|pyright/i,
  "lint-passes": /lint|ruff|clippy|prettier/i,
  "file-changed": PATH_LIKE,
  "file-created": PATH_LIKE,
  "file-deleted": PATH_LIKE,
  "dependency-added": /install|dependenc|\bpackage|\bdeps?\b/i,
  "dependency-removed": /uninstall|dependenc|\bpackage|\bdeps?\b/i,
  "command-ran": /\x60[^\x60]+\x60|\bran\b|\bexecuted\b|\bcommit|\bpush|\bmigrat/i,
  "no-errors": /\berrors?\b|\bwarnings?\b|\bissues\b|\bproblems\b/i,
  scope: /\bonly\b|\bother\b|\belse\b|\btouch/i,
  "bug-fixed": /\bfix|\bresolv|\bpatch|\bbug|\bcrash/i,
};

export function hasTypeCue(type: ClaimType, text: string): boolean {
  return CUES[type]?.test(text) ?? true;
}
