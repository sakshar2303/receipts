import path from "node:path";

/** Windows transcripts use backslashes and drive letters; compare everything in POSIX form. */
export function toPosix(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):\//, (_m, drive: string) => `${drive.toLowerCase()}:/`);
}

/** Path relative to the session cwd when it lives inside it, otherwise the absolute path. */
export function relativeToCwd(absPath: string, cwd: string): string {
  const file = toPosix(absPath);
  const base = toPosix(cwd).replace(/\/+$/, "");
  if (base && file.startsWith(`${base}/`)) return file.slice(base.length + 1);
  if (!path.posix.isAbsolute(file) && !/^[a-z]:\//.test(file)) return file.replace(/^\.\//, "");
  return file;
}

export function resolveAgainstCwd(p: string, cwd: string): string {
  const file = toPosix(p);
  if (path.posix.isAbsolute(file) || /^[a-z]:\//.test(file)) return file;
  return path.posix.join(toPosix(cwd), file);
}
