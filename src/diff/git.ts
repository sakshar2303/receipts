import { execFile } from "node:child_process";
import { ReceiptsError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import type { FileDiff } from "../types.js";
import { decodeUtf8, parseUnifiedDiff } from "./patch.js";

/** The hash of git's empty tree: a valid base when the first commit is the agent's. */
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const DIFF_FLAGS = ["--no-color", "--no-ext-diff", "--no-textconv", "-M", "--unified=3"];

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs git with an argument array, never through a shell, so nothing from a
 * transcript or a ref name can be interpreted as a command.
 */
export function git(repo: string, args: readonly string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repo, "-c", "core.quotepath=off", ...args],
      {
        encoding: "buffer",
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, GIT_PAGER: "cat" },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 128) : 0;
        resolve({ code, stdout: decodeUtf8(stdout), stderr: decodeUtf8(stderr) });
      },
    );
  });
}

export async function isGitRepo(repo: string): Promise<boolean> {
  const result = await git(repo, ["rev-parse", "--is-inside-work-tree"]);
  return result.code === 0 && result.stdout.trim() === "true";
}

/** Resolves a ref to a commit hash, or throws a usage error that says what to pass instead. */
export async function resolveCommit(
  repo: string,
  ref: string,
  flag: "--base" | "--head",
): Promise<string> {
  const result = await git(repo, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${ref}^{commit}`,
  ]);
  if (result.code !== 0) {
    throw new ReceiptsError(
      `Ref "${ref}" does not exist in ${repo}. Pass an existing branch, tag or commit with ${flag}, for example ${flag} main.`,
      ExitCode.Usage,
    );
  }
  return result.stdout.trim();
}

/** Diff between two commits, or between a commit and the working tree (head undefined). */
export async function diffRefs(repo: string, base: string, head?: string): Promise<FileDiff[]> {
  const args = ["diff", ...DIFF_FLAGS, base, ...(head ? [head] : []), "--"];
  const result = await git(repo, args);
  if (result.code !== 0) throw new Error(`git diff failed: ${result.stderr.trim()}`);
  const files = parseUnifiedDiff(result.stdout);
  return head ? files : [...files, ...(await untrackedFiles(repo))];
}

/**
 * `git diff <ref>` leaves out untracked files, and new files an agent created
 * are usually untracked. Diff each one against /dev/null so they show as added.
 */
async function untrackedFiles(repo: string): Promise<FileDiff[]> {
  const listed = await git(repo, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = listed.stdout.split("\0").filter(Boolean);
  const files: FileDiff[] = [];
  for (const path of paths) {
    // --no-index exits 1 when the files differ, which is always the case here.
    const result = await git(repo, ["diff", ...DIFF_FLAGS, "--no-index", "--", "/dev/null", path]);
    const [file] = parseUnifiedDiff(result.stdout);
    if (file) files.push({ ...file, path, oldPath: path, status: "added" });
  }
  return files;
}

/** The repository's default branch: origin's HEAD if known, otherwise main or master. */
export async function defaultBranch(repo: string): Promise<string | null> {
  const remote = await git(repo, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (remote.code === 0 && remote.stdout.trim()) return remote.stdout.trim();
  for (const name of ["main", "master"]) {
    const local = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]);
    if (local.code === 0) return name;
  }
  return null;
}

export async function currentBranch(repo: string): Promise<string | null> {
  const result = await git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return result.code === 0 ? result.stdout.trim() : null;
}

export async function mergeBase(repo: string, a: string, b: string): Promise<string | null> {
  const result = await git(repo, ["merge-base", a, b]);
  return result.code === 0 ? result.stdout.trim() : null;
}

/**
 * The commit HEAD pointed at when the session started: the parent of the oldest
 * commit made since then. Returns the empty tree if that commit has no parent.
 */
export async function headBefore(repo: string, sinceIso: string): Promise<string | null> {
  const result = await git(repo, ["rev-list", "--reverse", `--since=${sinceIso}`, "HEAD"]);
  const oldest = result.stdout.split("\n").find(Boolean);
  if (!oldest) return null;
  const parent = await git(repo, ["rev-parse", "--verify", "--quiet", `${oldest}^`]);
  return parent.code === 0 ? parent.stdout.trim() : EMPTY_TREE;
}

/** Commits on HEAD made strictly after the given time (committer date). */
export async function commitsAfter(repo: string, iso: string): Promise<number> {
  const after = new Date(Date.parse(iso) + 1000).toISOString();
  const result = await git(repo, ["rev-list", "--count", `--since=${after}`, "HEAD"]);
  return result.code === 0 ? Number(result.stdout.trim()) || 0 : 0;
}

/** The newest commit on HEAD made at or before the given time. */
export async function lastCommitBefore(repo: string, iso: string): Promise<string | null> {
  const result = await git(repo, ["rev-list", "-1", `--until=${iso}`, "HEAD"]);
  const hash = result.stdout.trim();
  return result.code === 0 && hash ? hash : null;
}
