import { existsSync } from "node:fs";
import path from "node:path";
import { ReceiptsError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import type { ChangeSet, Session } from "../types.js";
import {
  currentBranch,
  defaultBranch,
  diffRefs,
  EMPTY_TREE,
  commitsAfter,
  headBefore,
  isGitRepo,
  lastCommitBefore,
  mergeBase,
  resolveCommit,
} from "./git.js";
import { readPatchFile } from "./patch.js";
import { agentCommitted } from "./timeline.js";
import { changeSetFromTranscript } from "./transcript.js";

export interface DiffOptions {
  /** Repository to diff; defaults to the session's working directory. */
  repo?: string;
  base?: string;
  head?: string;
  /** Read this patch instead of running git. */
  diffFile?: string;
}

export const NO_GIT_NOTICE = "No git diff available. Using the agent's own edit records.";

/**
 * Picks the best available record of what changed:
 * an explicit patch, then git, then the transcript's own edit calls.
 */
export async function loadChangeSet(
  session: Session,
  options: DiffOptions = {},
): Promise<ChangeSet> {
  if (options.diffFile) {
    return {
      source: "patch",
      label: path.basename(options.diffFile),
      files: readPatchFile(options.diffFile),
    };
  }

  const repo = options.repo ?? session.cwd;
  if (!repo || !existsSync(repo) || !(await isGitRepo(repo))) {
    if (options.base || options.head) {
      throw new ReceiptsError(
        `${repo || "The session folder"} is not a git repository, so --base and --head cannot be used. Pass --repo or --diff.`,
        ExitCode.Usage,
      );
    }
    return {
      source: "transcript",
      label: "agent edit records",
      files: changeSetFromTranscript(session),
      notice: NO_GIT_NOTICE,
    };
  }

  if (options.base) {
    const base = await resolveCommit(repo, options.base, "--base");
    const head = options.head ? await resolveCommit(repo, options.head, "--head") : undefined;
    return {
      source: "git",
      label: `${options.base}...${options.head ?? "working tree"}`,
      files: await diffRefs(repo, base, head),
    };
  }
  if (options.head) {
    throw new ReceiptsError(
      "--head needs --base. Pass both, for example --base main --head HEAD.",
      ExitCode.Usage,
    );
  }

  return defaultChangeSet(repo, session);
}

export const LATER_COMMITS_NOTICE =
  "Commits were made after this session ended, so this compares only commits made during the session. Pass --base and --head to choose another range.";
export const MOVED_ON_NOTICE =
  "The repository has commits made after this session ended, so the working tree may include later work. Pass --base and --head to choose the range.";

/**
 * Without --base: compare HEAD to the working tree. When the agent committed,
 * HEAD already contains the work, so start from the merge-base with the
 * default branch (feature branch) or the commit HEAD was on when the session
 * started. For a past session the repository may have moved on since; then
 * the range stops at the last commit made before the session ended.
 */
async function defaultChangeSet(repo: string, session: Session): Promise<ChangeSet> {
  const endedAt = session.steps.at(-1)?.at ?? "";
  const later = endedAt ? await commitsAfter(repo, endedAt) : 0;
  const { base, label } = await defaultBase(repo, session);

  if (later > 0 && agentCommitted(session)) {
    const head = await lastCommitBefore(repo, endedAt);
    if (head) {
      return {
        source: "git",
        label: `${label}...session end`,
        files: await diffRefs(repo, base, head),
        notice: LATER_COMMITS_NOTICE,
      };
    }
  }
  return {
    source: "git",
    label: `${label}...working tree`,
    files: await diffRefs(repo, base),
    ...(later > 0 ? { notice: MOVED_ON_NOTICE } : {}),
  };
}

async function defaultBase(
  repo: string,
  session: Session,
): Promise<{ base: string; label: string }> {
  const head = await resolveOptional(repo, "HEAD");
  if (!head) return { base: EMPTY_TREE, label: "empty repository" };
  if (!agentCommitted(session)) return { base: head, label: "HEAD" };

  const branch = await currentBranch(repo);
  const main = await defaultBranch(repo);
  if (branch && main && branch !== main && !main.endsWith(`/${branch}`)) {
    const mb = await mergeBase(repo, main, "HEAD");
    if (mb) return { base: mb, label: main };
  }
  if (session.startedAt) {
    const before = await headBefore(repo, session.startedAt);
    if (before) return { base: before, label: "session start" };
  }
  return { base: head, label: "HEAD" };
}

async function resolveOptional(repo: string, ref: string): Promise<string | null> {
  try {
    return await resolveCommit(repo, ref, "--base");
  } catch {
    return null;
  }
}
