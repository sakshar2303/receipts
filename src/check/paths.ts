import path from "node:path";

/** Cleans a path as written in a claim: backticks, "./", trailing punctuation and slashes. */
export function cleanClaimPath(subject: string): string {
  return subject
    .trim()
    .replace(/^`|`$/g, "")
    .replace(/^\.\//, "")
    .replace(/[.,;:]+$/, "");
}

/**
 * Files a claimed path refers to. Agents write paths loosely ("auth.ts",
 * "src/auth.ts", "docs/"), so match exactly, then by suffix, then by basename,
 * and treat a trailing slash or an extension-less path with a slash as a folder.
 */
export function matchPaths(subject: string, candidates: readonly string[]): string[] {
  const raw = cleanClaimPath(subject);
  const isDir = raw.endsWith("/") || (raw.includes("/") && !/\.[A-Za-z0-9]+$/.test(raw));
  const s = raw.replace(/\/+$/, "");
  if (!s) return [];
  return candidates.filter((c) => {
    if (c === s) return true;
    if (isDir) return c.startsWith(`${s}/`) || c.includes(`/${s}/`);
    if (c.endsWith(`/${s}`) || s.endsWith(`/${c}`)) return true;
    return !s.includes("/") && path.posix.basename(c) === s;
  });
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "file",
  "files",
  "code",
  "module",
  "folder",
  "directory",
  "only",
  "just",
  "into",
  "from",
  "now",
  "all",
  "its",
  "our",
  "your",
  "some",
]);

/** Lowercase word stems of a phrase or path, for loose topical matching. */
export function tokens(text: string): Set<string> {
  return new Set(
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((w) => w.replace(/(?:ing|es|s)$/, ""))
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

export function sharesToken(a: Set<string>, b: Set<string>): boolean {
  for (const t of a) if (b.has(t)) return true;
  return false;
}
