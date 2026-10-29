// Runs after the build: catches bundling mistakes that unit tests (which run
// the TypeScript sources) cannot see.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const bundle = readFileSync("dist/receipts.js", "utf8");
if (/["']sqlite["']/.test(bundle)) {
  console.error("smoke: the bundle imports 'sqlite' without the node: prefix");
  process.exit(1);
}

const help = execFileSync(process.execPath, ["dist/receipts.js", "--help"], { encoding: "utf8" });
if (!help.includes("Exit codes:")) {
  console.error("smoke: --help output is missing the exit codes");
  process.exit(1);
}

try {
  execFileSync(process.execPath, ["dist/receipts.js", "sessions", "--db", "missing.db"], {
    stdio: "pipe",
  });
  console.error("smoke: a missing database should fail");
  process.exit(1);
} catch (error) {
  if (error.status !== 3) {
    console.error(`smoke: a missing database should exit 3, got ${error.status}`);
    process.exit(1);
  }
}
// A real database read exercises the bundled node:sqlite import end to end.
const dbPath = path.join(mkdtempSync(path.join(tmpdir(), "receipts-smoke-")), "opencode.db");
const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE session (id text, parent_id text, directory text, title text, time_created integer, time_updated integer);
  CREATE TABLE message (id text, session_id text, time_created integer, data text);
  CREATE TABLE part (id text, message_id text, session_id text, time_created integer, data text);
  INSERT INTO session VALUES ('ses_smoke', NULL, '/work/app', 'Smoke session', 0, 0);
`);
db.close();
const listing = execFileSync(process.execPath, ["dist/receipts.js", "sessions", "--db", dbPath], {
  encoding: "utf8",
});
if (!listing.includes("ses_smoke")) {
  console.error("smoke: sessions --db did not list the smoke session");
  process.exit(1);
}
console.log("smoke: ok");
