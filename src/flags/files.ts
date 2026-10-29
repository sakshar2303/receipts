import path from "node:path";
import picomatch from "picomatch";
import { diffRef } from "../check/context.js";
import type { Flag, FlagLine } from "../types.js";
import { makeFlag, type FlagContext } from "./context.js";
import { findSecrets } from "./secrets.js";

const TEMPLATE = /\.(?:example|sample|template|dist)$/;

/** sensitive-file: the diff touches a configured sensitive path. Templates such as .env.example do not count. */
export function sensitiveFile(ctx: FlagContext): Flag | null {
  const isSensitive = picomatch(ctx.activity.config.sensitivePaths, { dot: true });
  const files = ctx.changes.files.filter(
    (f) => [f.path, f.oldPath].some((p) => isSensitive(p)) && !TEMPLATE.test(f.path),
  );
  if (files.length === 0) return null;
  return makeFlag(
    "sensitive-file",
    `The diff touches ${files
      .map((f) => f.path)
      .slice(0, 4)
      .join(", ")}${files.length > 4 ? ` and ${files.length - 4} more` : ""}.`,
    {
      files: files.map((f) => f.path),
      evidence: files.map(diffRef),
    },
  );
}

/** secret-in-diff: an added line looks like a credential. Lines are redacted before they are stored. */
export function secretInDiff(ctx: FlagContext): Flag | null {
  const hits: FlagLine[] = [];
  const labels = new Set<string>();
  for (const file of ctx.changes.files) {
    let inKey = false;
    for (const line of file.hunks.flatMap((h) => h.lines)) {
      if (line.kind !== "add") continue;
      // Key bodies have no marker of their own; everything up to the END line is secret.
      if (inKey) {
        hits.push({
          path: file.path,
          line: {
            ...line,
            text: /-----END /.test(line.text) ? line.text : "[redacted private key]",
          },
        });
        if (/-----END /.test(line.text)) inKey = false;
        continue;
      }
      const found = findSecrets(line.text);
      if (found.length === 0) continue;
      for (const s of found) labels.add(s.label);
      if (found.some((s) => s.label === "private key") && !/-----END /.test(line.text))
        inKey = true;
      hits.push({ path: file.path, line });
    }
  }
  if (hits.length === 0) return null;
  const files = [...new Set(hits.map((h) => h.path))];
  return makeFlag(
    "secret-in-diff",
    `Added lines in ${files.slice(0, 3).join(", ")} look like credentials (${[...labels].join(", ")}).`,
    {
      files,
      evidence: ctx.changes.files.filter((f) => files.includes(f.path)).map(diffRef),
      lines: hits,
    },
  );
}

const LOCKFILES: Record<string, string> = {
  "package-lock.json": "package.json",
  "npm-shrinkwrap.json": "package.json",
  "pnpm-lock.yaml": "package.json",
  "yarn.lock": "package.json",
  "bun.lock": "package.json",
  "bun.lockb": "package.json",
  "Cargo.lock": "Cargo.toml",
  "poetry.lock": "pyproject.toml",
  "uv.lock": "pyproject.toml",
  "Pipfile.lock": "Pipfile",
  "Gemfile.lock": "Gemfile",
  "composer.lock": "composer.json",
  "go.sum": "go.mod",
};

export const isLockfile = (p: string) => path.posix.basename(p) in LOCKFILES;

/** lockfile-churn: a lockfile changed while the manifest next to it did not. */
export function lockfileChurn(ctx: FlagContext): Flag | null {
  const changed = new Set(ctx.changes.files.map((f) => f.path));
  const churned = ctx.changes.files.filter((f) => {
    const manifest = LOCKFILES[path.posix.basename(f.path)];
    if (!manifest) return false;
    const dir = path.posix.dirname(f.path);
    return !changed.has(dir === "." ? manifest : `${dir}/${manifest}`);
  });
  if (churned.length === 0) return null;
  return makeFlag(
    "lockfile-churn",
    `${churned.map((f) => f.path).join(", ")} changed, but the manifest beside it did not.`,
    {
      files: churned.map((f) => f.path),
      evidence: churned.map(diffRef),
    },
  );
}

/** large-diff: more changed lines than the configured limit. Lockfiles and binaries are not counted. */
export function largeDiff(ctx: FlagContext): Flag | null {
  const counted = ctx.changes.files.filter((f) => !f.binary && !isLockfile(f.path));
  const total = counted.reduce((n, f) => n + f.added + f.removed, 0);
  const limit = ctx.activity.config.largeDiffLines;
  if (total <= limit) return null;
  return makeFlag(
    "large-diff",
    `${total} lines changed across ${counted.length} files, above the limit of ${limit}.`,
    {
      files: [],
    },
  );
}

/**
 * unmentioned-change: code files the final message never names. Docs,
 * lockfiles and binary assets are left out, and a file counts as mentioned
 * when its path, its file name, or its name without the extension appears in
 * the message ("the tokenizer" names tokenizer.ts).
 */
export function unmentionedChange(ctx: FlagContext): Flag | null {
  const message = (ctx.activity.session.finalMessage?.text ?? "").toLowerCase();
  const mentioned = (p: string) => {
    const base = path.posix.basename(p).toLowerCase();
    const stem = base.replace(/\.[^.]+$/, "");
    return (
      message.includes(p.toLowerCase()) ||
      message.includes(base) ||
      (stem.length >= 4 &&
        new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(message))
    );
  };
  const unmentioned = ctx.changes.files.filter(
    (f) =>
      !f.binary &&
      !isLockfile(f.path) &&
      !ctx.activity.isDocFile(f.path) &&
      !BINARY_ASSET.test(f.path) &&
      !mentioned(f.path),
  );
  if (unmentioned.length <= ctx.activity.config.unmentionedFiles) return null;
  const names = unmentioned.map((f) => f.path);
  return makeFlag(
    "unmentioned-change",
    `${names.length} changed files are not mentioned in the final message: ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}.`,
    { files: names, evidence: unmentioned.slice(0, 10).map(diffRef) },
  );
}

const BINARY_ASSET = /\.(?:png|jpe?g|gif|webp|svg|ico|mp4|mov|webm|pdf|woff2?|ttf|zip)$/i;
