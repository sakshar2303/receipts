import path from "node:path";
import { relativeToCwd, toPosix } from "../ingest/paths.js";
import { splitChain } from "./commands.js";

/** A file a shell command wrote. path null means "some files, which ones is unknown". */
export interface ShellWrite {
  path: string | null;
  what: string;
}

// Inline scripts are often read-only inspection ("node -e 'console.log(...)'");
// they count as writers only when their text calls a file-writing API.
const INLINE_SCRIPT = /^(?:python3?|node|perl|ruby|bash|sh|zsh)\s+(?:-\s*$|-\s*<<|-[ce]\b|-\s)/;
const WRITE_API =
  /\bopen\([^)]*['"][wa]\+?b?['"]|\.write(?:_text|_bytes)?\(|writeFile|appendFile|\brmSync|\bunlink|renameSync|shutil\.|os\.(?:remove|rename|replace)|copyFile/;

const UNKNOWN_WRITERS: [RegExp, string][] = [
  [
    /^(?:\S+\s+)*(?:prettier\b.*--write|eslint\b.*--fix|ruff\s+(?:format|check\b.*--fix)|black\b|gofmt\s+-w|cargo\s+fmt|rustfmt)\b/,
    "a formatter",
  ],
  [/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:format|fmt|fix|lint:fix)\b/, "a formatter"],
  [
    /^git\s+(?:checkout(?!\s+-[bB]\b)|restore|apply|am|stash\s+(?:pop|apply)|reset\s+--hard|merge|pull|rebase|cherry-pick|revert)\b/,
    "a git command",
  ],
  [/^patch\b/, "patch"],
];

const LOCKFILES: Record<string, string[]> = {
  npm: ["package.json", "package-lock.json"],
  pnpm: ["package.json", "pnpm-lock.yaml"],
  yarn: ["package.json", "yarn.lock"],
  bun: ["package.json", "bun.lockb", "bun.lock"],
};

/**
 * Files a shell command may have changed. Edit and write tool calls are not
 * the only way an agent changes code: on real data, heredocs, `sed -i` and
 * inline scripts wrote files the edit records never mention. Static reading
 * only; nothing is executed.
 */
export function shellWrites(command: string, sessionCwd: string): ShellWrite[] {
  const writes: ShellWrite[] = [];
  let dir = sessionCwd;
  const add = (p: string, what: string) => {
    const clean = p.replace(/^['"]|['"]$/g, "");
    if (!clean || clean === "/dev/null" || clean.startsWith("&") || clean.startsWith("$")) return;
    const abs = path.posix.isAbsolute(toPosix(clean))
      ? toPosix(clean)
      : path.posix.join(toPosix(dir), clean);
    writes.push({ path: relativeToCwd(abs, sessionCwd), what });
  };

  for (const { text } of splitChain(command)) {
    const s = text.replace(/^[A-Za-z_]\w*=\S*\s+/, "");
    const cd = /^cd\s+(\S+)$/.exec(s);
    if (cd?.[1]) {
      dir = path.posix.isAbsolute(cd[1]) ? cd[1] : path.posix.join(toPosix(dir), cd[1]);
      continue;
    }
    // Quoted text can hold ">" (awk, echo); only unquoted redirects write files.
    const unquoted = s.replace(/'[^']*'|"[^"]*"/g, "''");
    for (const m of unquoted.matchAll(/(?:^|[^\d&<>])>>?\s*([^\s;&|<>]+)/g))
      add(m[1] ?? "", "a redirect");

    // Arguments from the unquoted form: quoted scripts and empty suffixes drop out.
    const words = unquoted.replace(/\s*\d?>>?\s*\S+/g, "").split(/\s+/);
    const args = words.slice(1).filter((w) => w && w !== "''" && !w.startsWith("-"));
    const cmd = words[0] ?? "";
    if ((cmd === "sed" && /\s-i/.test(s)) || (cmd === "perl" && /\s-\w*i/.test(s))) {
      // An unquoted sed script ("s/a/b/") comes before the files.
      const files = /^(?:s\W|\d*[dp]$|\/)/.test(args[0] ?? "") ? args.slice(1) : args;
      for (const a of files) add(a, cmd === "sed" ? "sed -i" : "perl -i");
    } else if (cmd === "tee") {
      for (const a of args) add(a, "tee");
    } else if (cmd === "mv" || cmd === "cp") {
      if (cmd === "mv") for (const a of args.slice(0, -1)) add(a, "mv");
      const target = args.at(-1);
      if (target) add(target, cmd);
    } else if (cmd === "rm" || cmd === "touch") {
      for (const a of args) add(a, cmd);
    } else if (
      /^(?:npm|pnpm|yarn|bun)$/.test(cmd) &&
      /\s(?:i|install|add|remove|rm|uninstall|un|update|upgrade)\b/.test(s)
    ) {
      for (const f of LOCKFILES[cmd] ?? []) add(f, `${cmd} install`);
    } else if (INLINE_SCRIPT.test(s)) {
      if (WRITE_API.test(command)) writes.push({ path: null, what: "an inline script" });
    } else {
      const unknown = UNKNOWN_WRITERS.find(([re]) => re.test(s));
      if (unknown) writes.push({ path: null, what: unknown[1] });
    }
  }
  return writes;
}
