// `npm run screenshots`: renders the README images from the bundled demo, which
// is synthetic fixture data, so no real path, name or transcript can appear.
// Run after `npm run build`. Writes PNGs at 2x to docs/assets/.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";

const ROOT = process.cwd();
const WORK = path.join(ROOT, ".receipts", "shots");
const OUT = path.join(ROOT, "docs", "assets");
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });

const cli = (args, env = {}) =>
  execFileSync(process.execPath, [path.join(ROOT, "dist", "receipts.js"), ...args], {
    cwd: WORK,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: undefined, OLLAMA_HOST: "http://127.0.0.1:9", ...env },
  });

cli(["check", "demo", "--no-llm", "--format", "all", "--out", "report", "--quiet"]);
const receipt = JSON.parse(readFileSync(path.join(WORK, "report", "report.json"), "utf8"));
const idOf = (verdict, text) =>
  receipt.claims.find((c) => c.verdict === verdict && c.text.includes(text))?.id;
const staleTests = idOf("stale", "tests");
const contradictedBuild = idOf("contradicted", "build");
const skipFlag = receipt.flags.findIndex((f) => f.id === "test-skipped");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const page = (title, css, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${body}</body></html>`;

// Terminal output, coloured as a terminal shows it.
const ANSI = { 1: "b", 2: "dim", 31: "red", 32: "green", 33: "yellow", 35: "magenta", 90: "gray" };
function ansiToHtml(text) {
  let open = 0;
  const sgr = new RegExp(`${String.fromCharCode(27)}\\[(\\d+)m`, "g");
  return esc(text).replace(sgr, (_m, code) => {
    if (code === "0" || code === "22" || code === "39") {
      const close = "</span>".repeat(open);
      open = 0;
      return close;
    }
    open++;
    return `<span class="${ANSI[code] ?? ""}">`;
  });
}
const terminal = cli(["check", "demo", "--no-llm", "--format", "terminal", "--out", "report"], {
  FORCE_COLOR: "1",
});
writeFileSync(
  path.join(WORK, "terminal.html"),
  page(
    "Terminal",
    `body{margin:0;background:#fbfaf7;padding:48px}
.frame{max-width:1040px;margin:0 auto;background:#121211;color:#e9e6df;border-radius:4px;border:1px solid #2b2925}
.bar{border-bottom:1px solid #2b2925;padding:8px 16px;font:12px ui-monospace,Menlo,monospace;color:#a19b90}
pre{margin:0;padding:16px 20px 20px;font:13px/1.55 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre}
.b{font-weight:700}.dim,.gray{color:#a19b90}.red{color:#ef8a83}.green{color:#79b886}.yellow{color:#e0b552}.magenta{color:#a99be6}`,
    `<div class="frame"><div class="bar">$ npx github:sakshar2303/receipts check demo</div><pre>${ansiToHtml(terminal)}</pre></div>`,
  ),
);

// The Markdown receipt, rendered the way a pull request comment shows it.
function markdownToHtml(md) {
  const inline = (s) =>
    esc(s)
      .replace(/\\\|/g, "|")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/&lt;sub&gt;(.*)&lt;\/sub&gt;/g, "<sub>$1</sub>");
  const out = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("### ")) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (line.startsWith("| ")) {
      const rows = [];
      while (lines[i]?.startsWith("| ")) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.slice(2, -2).split(/(?<!\\) \| /);
      out.push(
        `<table><thead><tr>${cells(rows[0])
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .slice(2)
          .map(
            (r) =>
              `<tr>${cells(r)
                .map((c) => `<td>${inline(c)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
    } else if (line.startsWith("- ")) {
      const items = [];
      while (lines[i]?.startsWith("- ")) items.push(`<li>${inline(lines[i++].slice(2))}</li>`);
      i--;
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (line.startsWith("> ")) out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  return out.join("\n");
}
writeFileSync(
  path.join(WORK, "markdown.html"),
  page(
    "Markdown",
    `body{margin:0;background:#fbfaf7;padding:48px;color:#161514;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.comment{max-width:1040px;margin:0 auto;background:#fff;border:1px solid #e3ded3;border-radius:4px}
.head{border-bottom:1px solid #e3ded3;padding:8px 16px;font-size:12px;color:#6b665d;background:#f3f1ec}
.body{padding:16px 24px 24px}h3{font-size:18px;margin:8px 0 16px}
table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:13px}th,td{border:1px solid #e3ded3;padding:6px 10px;text-align:left;vertical-align:top}
th{background:#f3f1ec}code{font:12px ui-monospace,Menlo,monospace;background:#f3f1ec;padding:1px 4px;border-radius:3px}
sub{color:#6b665d}ul{padding-left:20px}`,
    `<div class="comment"><div class="head">Pull request comment, pasted from <code>receipts check demo --format md</code></div><div class="body">${markdownToHtml(
      readFileSync(path.join(WORK, "report", "report.md"), "utf8"),
    )}</div></div>`,
  ),
);

const report = pathToFileURL(path.join(WORK, "report", "report.html")).href;
const { browser, close } = await launchChrome();
const tab = await openPage(browser);
const save = (name, png) => {
  writeFileSync(path.join(OUT, name), png);
  console.log(`  docs/assets/${name}`);
};
try {
  const hero = `#claim=${staleTests}&open=${contradictedBuild}`;
  for (const scheme of ["light", "dark"]) {
    await tab.view(1280, 900, scheme);
    await tab.goto(`${report}?${scheme}${hero}`);
    save(`report-${scheme}.png`, await tab.capture(".masthead", ".panes", { maxHeight: 1400 }));
  }

  await tab.view(1280, 900, "light");
  await tab.goto(`${report}?stale#filter=stale&claim=${staleTests}&open=${staleTests}`);
  save("evidence-stale.png", await tab.capture(".panes", ".legend"));

  await tab.goto(`${report}?flags`);
  await tab.evaluate(`document.querySelector('[data-flag="${skipFlag}"]').click()`);
  save("flags-skipped.png", await tab.capture('section[aria-labelledby="h-flags"]'));

  await tab.view(390, 844, "light", true);
  await tab.goto(`${report}?mobile`);
  save("mobile.png", await tab.capture(".masthead", ".panes > section:first-child", { pad: 0 }));

  await tab.view(1280, 900, "light");
  await tab.goto(pathToFileURL(path.join(WORK, "terminal.html")).href);
  save("terminal.png", await tab.capture(".frame", ".frame", { tight: true }));
  await tab.goto(pathToFileURL(path.join(WORK, "markdown.html")).href);
  save("markdown.png", await tab.capture(".comment", ".comment", { tight: true }));
} finally {
  await close();
}
