// `npm run video`: renders docs/demo.mp4 and its poster from the bundled demo,
// following docs/demo-script.md. Frames come from headless Chrome over the
// DevTools protocol, with a drawn cursor and on-screen captions instead of a
// voice, so the video works muted. Needs ffmpeg. Run after `npm run screenshots`,
// which writes the demo report and terminal output to .receipts/shots/.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";

const ROOT = process.cwd();
const SHOTS = path.join(ROOT, ".receipts", "shots");
const WORK = path.join(ROOT, ".receipts", "video");
const FRAMES = path.join(WORK, "frames");
const W = 1440;
const H = 900;
rmSync(WORK, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const receipt = JSON.parse(readFileSync(path.join(SHOTS, "report", "report.json"), "utf8"));
const idOf = (verdict, text) =>
  receipt.claims.find((c) => c.verdict === verdict && c.text.includes(text))?.id;
const build = idOf("contradicted", "build");
const tests = idOf("stale", "tests");
const skipFlag = receipt.flags.findIndex((f) => f.id === "test-skipped");
const report = pathToFileURL(path.join(SHOTS, "report", "report.html")).href;
const output =
  /<pre>([\s\S]*)<\/pre>/.exec(readFileSync(path.join(SHOTS, "terminal.html"), "utf8"))?.[1] ?? "";

// Pages of our own: a terminal and an end card, in the report's palette.
const page = (name, css, body) => {
  const file = path.join(WORK, `${name}.html`);
  writeFileSync(
    file,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}${css}</style></head><body>${body}</body></html>`,
  );
  return pathToFileURL(file).href;
};
const terminalPage = page(
  "terminal",
  `body{background:#fbfaf7;display:flex;align-items:flex-start;justify-content:center;padding-top:56px;box-sizing:border-box}
.frame{width:1200px;background:#121211;color:#e9e6df;border-radius:4px;border:1px solid #2b2925}
.bar{border-bottom:1px solid #2b2925;padding:10px 18px;font:13px ui-monospace,Menlo,monospace;color:#a19b90}
pre{margin:0;padding:20px 24px 24px;font:15px/1.6 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre;min-height:200px}
.b{font-weight:700}.dim,.gray{color:#a19b90}.red{color:#ef8a83}.green{color:#79b886}.yellow{color:#e0b552}.magenta{color:#a99be6}
.caret{display:inline-block;width:9px;height:18px;background:#e9e6df;vertical-align:-3px}`,
  `<div class="frame"><div class="bar">Terminal</div><pre id="t"></pre></div>`,
);
const endPage = page(
  "end",
  `body{background:#fbfaf7;color:#161514;display:flex;flex-direction:column;justify-content:center;padding:0 160px;box-sizing:border-box}
h1{font:600 52px/1.15 "Iowan Old Style",Charter,Georgia,serif;margin:0 0 28px;max-width:900px}
.rule{border-top:1px dashed #e3ded3;margin:8px 0 28px;width:900px}
p{font:20px ui-monospace,"SF Mono",Menlo,monospace;margin:0 0 14px;color:#6b665d}p b{color:#161514;font-weight:400}`,
  `<h1>Your agent says it's done. Check the receipts.</h1><div class="rule"></div>
<p><b>npx github:sakshar2303/receipts check demo --open</b></p><p>github.com/sakshar2303/receipts</p>`,
);

// The overlay: a caption bar and an arrow cursor, drawn into every page.
const OVERLAY = `(() => {
  if (window.__ov) return;
  const cap = document.createElement("div");
  cap.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#161514;color:#fbfaf7;font:500 21px/1.4 -apple-system,system-ui,sans-serif;padding:18px 48px;text-align:center;transition:none";
  const cur = document.createElement("div");
  cur.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M1 1v24l6-6 4 9 4-2-4-9h8z" fill="#161514" stroke="#fbfaf7" stroke-width="1.5"/></svg>';
  cur.style.cssText = "position:fixed;z-index:100000;left:-40px;top:-40px;pointer-events:none";
  const ring = document.createElement("div");
  ring.style.cssText = "position:fixed;z-index:99998;width:28px;height:28px;margin:-14px 0 0 -14px;border:2px solid #b3261e;border-radius:50%;opacity:0;pointer-events:none";
  document.body.append(cap, ring, cur);
  window.__ov = { cap, cur, ring };
})()`;

const { browser, close } = await launchChrome();
const tab = await openPage(browser);
const frames = [];
let cursor = { x: W - 200, y: H - 200 };

async function frame(seconds) {
  const file = path.join(FRAMES, `${String(frames.length).padStart(4, "0")}.png`);
  writeFileSync(file, await tab.shot());
  frames.push({ file, seconds });
  return file;
}
async function open(url, scheme = "light") {
  await tab.view(W, H, scheme);
  await tab.goto(url);
  await tab.evaluate(OVERLAY);
  await tab.evaluate(`__ov.cur.style.left="${cursor.x}px";__ov.cur.style.top="${cursor.y}px"`);
}
const caption = (text) =>
  tab.evaluate(
    `__ov.cap.textContent=${JSON.stringify(text)};__ov.cap.style.display=${text ? '"block"' : '"none"'}`,
  );
const centre = (selector) =>
  tab.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 120)), y: Math.round(r.top + r.height / 2) }; })()`);
async function moveTo(target, steps = 10) {
  const from = cursor;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    cursor = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
    await tab.evaluate(`__ov.cur.style.left="${cursor.x}px";__ov.cur.style.top="${cursor.y}px"`);
    await frame(1 / 30);
  }
}
async function click(action) {
  await tab.evaluate(
    `__ov.ring.style.left="${cursor.x + 2}px";__ov.ring.style.top="${cursor.y + 2}px";__ov.ring.style.opacity="1"`,
  );
  await frame(0.12);
  await tab.evaluate(action);
  await new Promise((r) => setTimeout(r, 150));
  await tab.evaluate(`__ov.ring.style.opacity="0"`);
}
async function type(text, seconds = 0.045) {
  for (let i = 1; i <= text.length; i++) {
    await tab.evaluate(
      `document.getElementById("t").innerHTML = '<span class="dim">$ </span>' + ${JSON.stringify(text.slice(0, i))}.replace(/&/g,"&amp;").replace(/</g,"&lt;") + '<span class="caret"></span>'`,
    );
    await frame(seconds);
  }
}
const scrollTo = (selector, offset = 90) =>
  tab.evaluate(
    `window.scrollTo(0, document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top + scrollY - ${offset})`,
  );

let poster;
try {
  // 1. The command.
  const run = "npx github:sakshar2303/receipts check demo --open";
  await open(terminalPage);
  await caption(
    "Coding agents end with a confident summary. Receipts checks it against what actually ran.",
  );
  await type(run);
  await frame(0.6);
  await tab.evaluate(
    `document.getElementById("t").innerHTML = '<span class="dim">$ </span>' + ${JSON.stringify(run)} + "\\n\\n" + ${JSON.stringify(output.trim())}`,
  );
  await caption(
    "Nine claims in the agent's final message. Two are proven. Two are false, and two were true once but not any more.",
  );
  await frame(5.5);

  // 2. The report, and the contradicted build claim.
  await open(`${report}?video`);
  await caption("The report opens in the browser: every claim, its verdict, and why.");
  await frame(3);
  await caption(
    'The agent said "the build succeeds". The last build exited 2. One click shows the step and its output.',
  );
  await moveTo(await centre(`.claim[data-id="${build}"] .claim-text`));
  await click(`location.hash = "#claim=${build}&open=${build}"`);
  await frame(5);
  poster = frames.at(-1).file;

  // 3. The stale test claim, on the timeline.
  await caption(
    '"All tests pass" was true at step 8. Then the agent edited the test file and never ran the tests again.',
  );
  await moveTo(await centre(`.claim[data-id="${tests}"] .claim-text`));
  await click(`location.hash = "#filter=stale&claim=${tests}&open=${tests}"`);
  await frame(2.5);
  await scrollTo(".timeline", 240);
  await frame(4);

  // 4. Flags.
  await caption("Flags catch what the agent did not mention. Here it skipped a test.");
  await scrollTo('section[aria-labelledby="h-flags"]');
  await frame(1);
  await moveTo(await centre(`[data-flag="${skipFlag}"]`));
  await click(`document.querySelector('[data-flag="${skipFlag}"]').click()`);
  await frame(4);

  // 5. Keyboard and theme.
  await tab.evaluate("window.scrollTo(0, 0)");
  await caption(
    "Keyboard: j and k move between claims, 1 to 5 filter by verdict, / searches. One self-contained file, nothing leaves your machine.",
  );
  await click(`location.hash = "#filter=contradicted"`);
  await frame(3);
  await moveTo(await centre("#theme"));
  await click(`document.getElementById("theme").click()`);
  await frame(3);

  // 6. --fail-on.
  const gate =
    'npx github:sakshar2303/receipts check demo --fail-on contradicted,stale --quiet; echo "exit $?"';
  cursor = { x: W + 40, y: H + 40 };
  await open(terminalPage);
  await caption("In a pre-push hook or CI, --fail-on turns a false claim into a failed check.");
  await type(gate, 0.03);
  await frame(0.6);
  await tab.evaluate(
    `document.getElementById("t").innerHTML = '<span class="dim">$ </span>' + ${JSON.stringify(gate).replace(/</g, "\\u003c")}.replace(/&/g,"&amp;") + "\\nexit 1\\n" + '<span class="dim">$ </span><span class="caret"></span>'`,
  );
  await frame(4.5);

  // 7. End card.
  await open(endPage);
  await caption(
    "An agent can also run it on its own draft reply before it says it is done: a skill and an MCP server are included.",
  );
  await frame(4);
  await caption("");
  await frame(3);
} finally {
  await close();
}

// Join the frames, each held for its own duration, into an H.264 MP4.
const list = frames.map((f) => `file '${f.file}'\nduration ${f.seconds.toFixed(3)}`).join("\n");
writeFileSync(path.join(WORK, "frames.txt"), `${list}\nfile '${frames.at(-1).file}'\n`);
const mp4 = path.join(ROOT, "docs", "demo.mp4");
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  path.join(WORK, "frames.txt"),
  "-vf",
  `scale=${W}:${H}:flags=lanczos,fps=30,format=yuv420p`,
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "22",
  "-movflags",
  "+faststart",
  mp4,
]);
copyFileSync(poster, path.join(ROOT, "docs", "assets", "demo-poster.png"));
const seconds = frames.reduce((s, f) => s + f.seconds, 0);
console.log(
  `  docs/demo.mp4 (${seconds.toFixed(1)} s, ${frames.length} frames)\n  docs/assets/demo-poster.png`,
);
