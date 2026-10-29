import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { inputNotFound } from "../errors.js";

/** The report.html inside a folder, or the file itself. */
export function reportFile(target: string): string {
  const file =
    existsSync(target) && statSync(target).isDirectory()
      ? path.join(target, "report.html")
      : target;
  if (!existsSync(file)) {
    throw inputNotFound(
      `No report at ${file}. Run "receipts check" first, or pass the folder it wrote to.`,
    );
  }
  return path.resolve(file);
}

/** Opens a local file in the default browser, without a shell. */
export function openInBrowser(file: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [file]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", file]]
        : ["xdg-open", [file]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {
    process.stderr.write(`receipts: could not open a browser; the report is at ${file}\n`);
  });
  child.unref();
}
