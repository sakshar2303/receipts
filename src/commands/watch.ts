import { unwatchFile, watchFile } from "node:fs";
import { ReceiptsError } from "../errors.js";
import { runCheck, type CheckOptions, type Io } from "./check.js";
import { resolveTarget } from "./target.js";

export interface WatchOptions {
  /** How often to look at the session files, in milliseconds. */
  interval?: number;
  /** Stops watching; the CLI never aborts, so Ctrl-C ends it. */
  signal?: AbortSignal;
  /** Called after each check, for tests. */
  onRun?: () => void;
}

/**
 * Runs `check`, then runs it again whenever the session's transcript or
 * database changes. Files are polled rather than watched with fs.watch, which
 * misses SQLite's write-ahead log and appends on some file systems.
 */
export async function watchCheck(
  target: string,
  options: CheckOptions,
  io: Io,
  watch: WatchOptions = {},
): Promise<void> {
  const { files } = await resolveTarget(target, {
    ...(options.db ? { db: options.db } : {}),
    ...(options.repo ? { repo: options.repo, strictRepo: true } : { repo: io.cwd }),
  });
  const interval = watch.interval ?? 1000;

  let running = Promise.resolve();
  let pending = false;
  const check = async (first: boolean) => {
    if (!first) {
      const time = new Date().toTimeString().slice(0, 8);
      io.write(`\nSession changed at ${time}. Checking again.\n\n`);
    }
    try {
      await runCheck(target, first ? options : { ...options, open: false }, io);
    } catch (error) {
      // A transcript caught mid-write can be briefly unreadable; the next change retries.
      if (!(error instanceof ReceiptsError)) throw error;
      io.write(`${error.message}\n`);
    }
    io.write(`\nWatching ${files[0] ?? target}. Press Ctrl-C to stop.\n`);
    watch.onRun?.();
  };
  const schedule = () => {
    if (pending) return;
    pending = true;
    running = running.then(async () => {
      pending = false;
      await check(false);
    });
  };

  await check(true);
  const listener = (now: { mtimeMs: number }, before: { mtimeMs: number }) => {
    if (now.mtimeMs !== before.mtimeMs) schedule();
  };
  for (const file of files) watchFile(file, { interval, persistent: true }, listener);

  await new Promise<void>((resolve) => {
    watch.signal?.addEventListener("abort", () => {
      for (const file of files) unwatchFile(file, listener);
      void running.then(resolve);
    });
  });
}
