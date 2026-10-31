// `npm run video`: renders docs/demo.mp4 and its poster from the bundled demo.
// Every frame is drawn by headless Chrome over the DevTools protocol: a camera
// that zooms and pans, a cursor, verdict stamps and subtitles. The narration is
// the macOS `say` voice (VOICE=... to change it), and every sound effect and the
// music bed are synthesised here with ffmpeg, so nothing is downloaded. Needs
// macOS and ffmpeg. Run after `npm run screenshots`, which writes the demo
// report and terminal output to .receipts/shots/.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";

const ROOT = process.cwd();
const SHOTS = path.join(ROOT, ".receipts", "shots");
const WORK = path.join(ROOT, ".receipts", "video");
const FRAMES = path.join(WORK, "frames");
const AUDIO = path.join(WORK, "audio");
const W = 1920;
const H = 1080;
const FPS = 30;
const RATE = 48000;
const VOICE = process.env.VOICE ?? "Daniel";
rmSync(WORK, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });
mkdirSync(AUDIO, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" });
const ffmpeg = (...args) => run("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const seconds = (file) =>
  Number(
    run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]),
  );

// ---------------------------------------------------------------- inputs

const receipt = JSON.parse(readFileSync(path.join(SHOTS, "report", "report.json"), "utf8"));
const idOf = (verdict, text) =>
  receipt.claims.find((c) => c.verdict === verdict && c.text.includes(text))?.id;
const build = idOf("contradicted", "build");
const tests = idOf("stale", "tests");
const skipFlag = receipt.flags.findIndex((f) => f.id === "test-skipped");
const report = pathToFileURL(path.join(SHOTS, "report", "report.html")).href;
const site = pathToFileURL(path.join(ROOT, "docs", "index.html")).href;
const output =
  /<pre>([\s\S]*)<\/pre>/.exec(readFileSync(path.join(SHOTS, "terminal.html"), "utf8"))?.[1] ?? "";

// The real-session result for the narration, read from the committed eval.
const results = readFileSync(path.join(ROOT, "eval", "results.md"), "utf8");
const real = results.slice(results.indexOf("## Real sessions"));
const fv = /False-verified rate\*\*\s*\|\s*\*\*[\d.]+%\*\* \((\d+) of (\d+)\)/.exec(real);
const resultLine =
  fv && fv[1] === "0"
    ? `On forty-five real agent replies, Receipts marked ${fv[2]} claims verified. Not one of them was wrong.`
    : "On forty-five real agent replies, almost every claim it marked verified held up.";

// ---------------------------------------------------------------- narration

const LINES = {
  intro:
    "Your coding agent just told you it's done. All tests pass. The build succeeds. But did it actually check?",
  terminal:
    "Receipts reads the agent's session and the git diff, finds every claim in its final message, and checks each one against what actually ran.",
  count: "Nine claims. Only two are proven.",
  report: "Every claim gets a verdict, and a link to its evidence.",
  build: "The agent said the build succeeds. The last build exited with code two. Contradicted.",
  stale:
    "All tests pass? They did, at step eight. Then the agent edited the test file, and never ran the tests again. That's stale.",
  flags: "It also flags what the agent never mentioned. Here, it quietly skipped a test.",
  gate: "Put it in a pre-push hook or in CI, and a false claim fails the check.",
  results: resultLine,
  end: "Free, local, and open source. Your agent says it's done. Check the receipts.",
};
const voice = {};
for (const [name, text] of Object.entries(LINES)) {
  const aiff = path.join(AUDIO, `${name}.aiff`);
  run("say", ["-v", VOICE, "-r", "178", "-o", aiff, text]);
  voice[name] = { file: aiff, length: seconds(aiff), text };
}

// ---------------------------------------------------------------- pages of our own

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
  `body{background:#0d0d0c;display:flex;align-items:flex-start;justify-content:center;padding-top:70px;box-sizing:border-box}
.frame{width:1560px;background:#121211;color:#e9e6df;border-radius:6px;border:1px solid #2b2925}
.bar{border-bottom:1px solid #2b2925;padding:12px 20px;display:flex;gap:8px}
.bar i{width:12px;height:12px;border-radius:50%;background:#3a3834;display:inline-block}
pre{margin:0;padding:26px 30px 30px;font:19px/1.6 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre;min-height:220px}
.b{font-weight:700}.dim,.gray{color:#a19b90}.red{color:#ef8a83}.green{color:#79b886}.yellow{color:#e0b552}.magenta{color:#a99be6}
.caret{display:inline-block;width:11px;height:22px;background:#e9e6df;vertical-align:-4px}`,
  `<div class="frame"><div class="bar"><i></i><i></i><i></i></div><pre id="t"></pre></div>`,
);
const introPage = page(
  "intro",
  `body{background:#0d0d0c;color:#e9e6df;display:flex;flex-direction:column;justify-content:center;padding:0 220px;box-sizing:border-box;overflow:hidden}
.chat{font:30px/1.5 ui-monospace,"SF Mono",Menlo,monospace;color:#a19b90;min-height:50px}
.chat b{color:#e9e6df;font-weight:400}
h1{font:600 120px/1.02 "Iowan Old Style",Charter,Georgia,serif;margin:46px 0 0;opacity:0;transform:translateY(30px)}
.wall{position:fixed;inset:0;font:16px/1.9 ui-monospace,Menlo,monospace;color:#e9e6df;opacity:.05;white-space:pre;overflow:hidden;z-index:-1}`,
  `<div class="wall" id="wall"></div><div class="chat" id="chat"></div><h1 id="h">Your agent says<br>it's done.</h1>`,
);

// ---------------------------------------------------------------- the overlay

// Subtitles, a cursor, a click ring, a stamp and a fade, drawn above the page
// and outside <body>, so the camera transform on <body> never moves them.
const OVERLAY = `(() => {
  if (window.__ov) return;
  const el = (css, html = "") => { const d = document.createElement("div"); d.style.cssText = css; d.innerHTML = html; document.documentElement.append(d); return d; };
  window.__ov = {
    sub: el("position:fixed;left:50%;bottom:54px;transform:translateX(-50%);z-index:100001;max-width:1500px;width:max-content;background:rgba(13,13,12,.88);color:#fbfaf7;font:500 34px/1.35 -apple-system,system-ui,sans-serif;padding:16px 30px;border-radius:6px;text-align:center;display:none"),
    ring: el("position:fixed;z-index:100002;width:44px;height:44px;margin:-22px 0 0 -22px;border:3px solid #ef8a83;border-radius:50%;opacity:0"),
    cur: el("position:fixed;z-index:100003;left:-60px;top:-60px", '<svg width="34" height="46" viewBox="0 0 22 30"><path d="M1 1v24l6-6 4 9 4-2-4-9h8z" fill="#161514" stroke="#fbfaf7" stroke-width="1.6"/></svg>'),
    stamp: el("position:fixed;left:50%;top:44%;z-index:100000;font:800 92px/1 ui-monospace,Menlo,monospace;letter-spacing:.1em;padding:18px 34px;border:9px solid currentColor;border-radius:8px;opacity:0;background:rgba(251,250,247,.84);text-transform:uppercase;white-space:nowrap"),
    fade: el("position:fixed;inset:0;z-index:100004;background:#0d0d0c;opacity:1"),
  };
  document.documentElement.style.overflow = "hidden";
})()`;

// ---------------------------------------------------------------- the recorder

const { browser, close } = await launchChrome();
const tab = await openPage(browser);
const frames = [];
const events = [];
let clock = 0;
let cursor = { x: W + 60, y: H + 60 };
let cam = { x: 0, y: 0, s: 1 };
let shake = { x: 0, y: 0 };

const js = (code) => tab.evaluate(code);
const sfx = (name, at = clock) => events.push({ name, at });
async function snap(duration) {
  const file = path.join(FRAMES, `${String(frames.length).padStart(5, "0")}.jpg`);
  writeFileSync(file, await tab.shot("jpeg", 88));
  frames.push({ file, duration });
  clock += duration;
}
const hold = (s) => (s > 0.01 ? snap(s) : Promise.resolve());
async function animate(s, step) {
  const n = Math.max(1, Math.round(s * FPS));
  for (let i = 1; i <= n; i++) {
    await step(i / n);
    await snap(s / n);
  }
}
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

const applyCam = () =>
  js(
    `document.body.style.transformOrigin="0 0";document.body.style.transform="translate(${-cam.x * cam.s + shake.x}px,${-cam.y * cam.s + shake.y}px) scale(${cam.s})"`,
  );
async function open(url, scheme = "light") {
  await tab.view(W, H, scheme, false, 1);
  await tab.goto(url);
  await js(OVERLAY);
  cam = { x: 0, y: 0, s: 1 };
  await applyCam();
  await js(`__ov.cur.style.left="${cursor.x}px";__ov.cur.style.top="${cursor.y}px"`);
}
async function camTo(target, s) {
  const from = { ...cam };
  await animate(s, async (t) => {
    const e = ease(t);
    cam = {
      x: lerp(from.x, target.x, e),
      y: lerp(from.y, target.y, e),
      s: lerp(from.s, target.s, e),
    };
    await applyCam();
  });
}
/** The camera position that centres a page rectangle at a given zoom. */
const frameRect = (r, s, dy = 0) => ({
  x: r.x + r.w / 2 - W / (2 * s),
  y: r.y + r.h / 2 - H / (2 * s) + dy,
  s,
});
const rect = (selector) =>
  js(`(() => { const b = document.body.style.transform; document.body.style.transform = "none";
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    document.body.style.transform = b; return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })()`);
const toScreen = (p) => ({ x: (p.x - cam.x) * cam.s, y: (p.y - cam.y) * cam.s });

const subtitle = (text) =>
  js(
    `__ov.sub.textContent=${JSON.stringify(text)};__ov.sub.style.display=${text ? '"block"' : '"none"'}`,
  );
function say(name, at = clock) {
  events.push({ voice: name, at });
  return subtitle(voice[name].text);
}
const showCursor = (on) => js(`__ov.cur.style.opacity="${on ? 1 : 0}"`);
async function moveTo(p, s = 0.6) {
  const from = { ...cursor };
  await animate(s, async (t) => {
    const e = ease(t);
    cursor = { x: lerp(from.x, p.x, e), y: lerp(from.y, p.y, e) };
    await js(`__ov.cur.style.left="${cursor.x}px";__ov.cur.style.top="${cursor.y}px"`);
  });
}
async function click(action) {
  sfx("click");
  await js(
    `__ov.ring.style.left="${cursor.x + 4}px";__ov.ring.style.top="${cursor.y + 4}px";__ov.ring.style.opacity="1"`,
  );
  await snap(0.1);
  await js(action);
  await new Promise((r) => setTimeout(r, 200));
  // The report scrolls a selected claim into view; the camera does the moving instead.
  await js("window.scrollTo(0, 0)");
  await js(`__ov.ring.style.opacity="0"`);
}
async function stamp(text, color, rotate = -8) {
  sfx("thump", clock + 0.18);
  // Monospace letters plus spacing are about 0.72em wide; keep the stamp within 1500 px.
  const size = Math.min(92, Math.floor(1500 / (text.length * 0.72)));
  await js(
    `__ov.stamp.textContent=${JSON.stringify(text)};__ov.stamp.style.color="${color}";__ov.stamp.style.fontSize="${size}px"`,
  );
  await animate(0.26, (t) => {
    const e = 1 - (1 - t) ** 3;
    return js(
      `__ov.stamp.style.opacity="${Math.min(1, t * 2)}";__ov.stamp.style.transform="translate(-50%,-50%) rotate(${rotate}deg) scale(${lerp(2.6, 1, e)})"`,
    );
  });
  await animate(0.3, (t) => {
    const k = (1 - t) * 14;
    shake = { x: Math.sin(t * 40) * k, y: Math.cos(t * 33) * k };
    return applyCam();
  });
  shake = { x: 0, y: 0 };
  await applyCam();
}
const unstamp = () => animate(0.25, (t) => js(`__ov.stamp.style.opacity="${1 - t}"`));
async function fadeOut(s = 0.4) {
  sfx("whoosh");
  await animate(s, (t) => js(`__ov.fade.style.opacity="${t}"`));
}
const fadeIn = (s = 0.4) => animate(s, (t) => js(`__ov.fade.style.opacity="${1 - t}"`));
/** Holds until the narration that started at `from` has finished, plus a pause. */
const until = (from, name, pause = 0.35) => hold(from + voice[name].length + pause - clock);
async function type(text, perChar = 0.04) {
  for (let i = 1; i <= text.length; i++) {
    if (text[i - 1] !== " ") sfx("key");
    await js(
      `document.getElementById("t").innerHTML='<span class="dim">$ </span>'+${JSON.stringify(text.slice(0, i))}.replace(/&/g,"&amp;").replace(/</g,"&lt;")+'<span class="caret"></span>'`,
    );
    await snap(perChar);
  }
}
/** Real-time capture of a page's own CSS animations; each frame is held for the time it took. */
async function live(s) {
  const start = Date.now();
  let last = start;
  while (Date.now() - start < s * 1000) {
    const file = path.join(FRAMES, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, await tab.shot("jpeg", 88));
    const now = Date.now();
    frames.push({ file, duration: (now - last) / 1000 });
    clock += (now - last) / 1000;
    last = now;
  }
}

// ---------------------------------------------------------------- the film

let poster;
try {
  // 1. Intro: the agent's claim, the line, the stamp.
  await open(introPage);
  await js(
    `document.getElementById("wall").textContent = Array.from({length:60},(_, i)=>String(i+1).padStart(4)+"  $ npm test 2>&1 | tail -20    Edit test/parser.test.ts    $ npm run build    exit 2").join("\\n")`,
  );
  await fadeIn(0.5);
  const t0 = clock;
  await say("intro");
  const claim = "agent ▸ Done. All tests pass. The build succeeds.";
  for (let i = 1; i <= claim.length; i++) {
    if (claim[i - 1] !== " ") sfx("key");
    await js(
      `document.getElementById("chat").innerHTML=${JSON.stringify(claim.slice(0, i))}.replace("agent ▸","<b>agent ▸</b>")`,
    );
    await snap(0.035);
  }
  await animate(0.6, (t) =>
    js(
      `{ const h=document.getElementById("h"); h.style.opacity=${t}; h.style.transform="translateY(${30 * (1 - ease(t))}px)"; }`,
    ),
  );
  await hold(t0 + voice.intro.length - 0.9 - clock);
  await stamp("Check the receipts", "#b3261e", -6);
  await hold(1.1);
  await fadeOut();

  // 2. The terminal.
  cursor = { x: W + 60, y: H + 60 };
  await open(terminalPage);
  await fadeIn(0.3);
  const t1 = clock;
  await say("terminal");
  const command = "npx github:sakshar2303/receipts check demo --open";
  await type(command, 0.04);
  await hold(0.35);
  sfx("key");
  const lines = output.trim().split("\n");
  for (let i = 1; i <= lines.length; i += 2) {
    if (i % 4 === 1) sfx("tick");
    await js(
      `document.getElementById("t").innerHTML='<span class="dim">$ </span>'+${JSON.stringify(command)}+"\\n\\n"+${JSON.stringify(lines.slice(0, i + 1).join("\n"))}`,
    );
    await snap(0.05);
  }
  await until(t1, "terminal", 0.2);
  const t1b = clock;
  await say("count");
  const counts = await rect("pre");
  await camTo(frameRect({ x: counts.x, y: counts.y + 60, w: 1000, h: 100 }, 1.8), 0.9);
  await until(t1b, "count", 0.2);
  await stamp("2 of 9 proven", "#b3261e", -4);
  await hold(0.9);
  await fadeOut();

  // 3. The report, framed on its content (it is about 1100 px wide).
  await open(`${report}?video`);
  const head = await rect("main.wrap");
  const wide = { x: head.x - 40, y: 0, s: W / (head.w + 80) };
  cam = wide;
  await applyCam();
  await subtitle("");
  await fadeIn(0.4);
  await say("report");
  await camTo({ x: wide.x + 20, y: 10, s: wide.s * 1.05 }, voice.report.length + 0.4);

  // 4. The contradicted build claim.
  const t3 = clock;
  await say("build");
  const buildRow = await rect(`.claim[data-id="${build}"] .claim-text`);
  await moveTo(toScreen({ x: buildRow.x + 60, y: buildRow.y + buildRow.h / 2 }));
  await click(`location.hash="#claim=${build}&open=${build}"`);
  await hold(0.4);
  const evidence = await rect(`#ev-${build}`);
  await showCursor(false);
  await camTo(frameRect(evidence, 2.2, 40), 1);
  await hold(t3 + voice.build.length - 1.4 - clock);
  await stamp("Contradicted", "#b3261e");
  poster = frames.at(-1).file;
  await until(t3, "build", 0.5);
  await unstamp();

  // 5. The stale test claim and the timeline.
  await camTo(wide, 0.7);
  await showCursor(true);
  const t4 = clock;
  await say("stale");
  const testRow = await rect(`.claim[data-id="${tests}"] .claim-text`);
  await moveTo(toScreen({ x: testRow.x + 60, y: testRow.y + testRow.h / 2 }));
  await click(`location.hash="#filter=stale&claim=${tests}&open=${tests}"`);
  await hold(0.6);
  await showCursor(false);
  const timeline = await rect('section[aria-labelledby="h-timeline"]');
  await camTo(frameRect(timeline, 1.9), 1.4);
  await hold(t4 + voice.stale.length - 1.0 - clock);
  await stamp("Stale", "#9a6a00");
  await until(t4, "stale", 0.5);
  await unstamp();

  // 6. Flags.
  const t5 = clock;
  await say("flags");
  const flags = await rect('section[aria-labelledby="h-flags"]');
  await camTo(frameRect({ ...flags, h: Math.min(flags.h, 500) }, 1.7), 1.1);
  await showCursor(true);
  const flagRow = await rect(`[data-flag="${skipFlag}"]`);
  await moveTo(toScreen({ x: flagRow.x + 80, y: flagRow.y + flagRow.h / 2 }));
  await click(`document.querySelector('[data-flag="${skipFlag}"]').click()`);
  await hold(0.3);
  await showCursor(false);
  await camTo(frameRect({ ...flagRow, h: flagRow.h + 160 }, 2.4, 40), 1);
  await hold(t5 + voice.flags.length - 1.2 - clock);
  await stamp("Test skipped", "#b3261e", -5);
  await until(t5, "flags", 0.6);
  await fadeOut();

  // 7. The gate.
  cursor = { x: W + 60, y: H + 60 };
  await open(terminalPage);
  await subtitle("");
  await fadeIn(0.3);
  const t6 = clock;
  await say("gate");
  const gate = 'receipts check latest --fail-on contradicted,stale; echo "exit $?"';
  const term = await rect("pre");
  await camTo({ x: term.x - 30, y: term.y - 90, s: 1.7 }, 0.4);
  await type(gate, 0.03);
  await hold(0.3);
  sfx("key");
  await js(
    `document.getElementById("t").innerHTML='<span class="dim">$ </span>'+${JSON.stringify(gate)}.replace(/&/g,"&amp;")+'\\n<span class="red">exit 1</span>\\n<span class="dim">$ </span><span class="caret"></span>'`,
  );
  await hold(0.5);
  await stamp("Push blocked", "#b3261e", -4);
  await until(t6, "gate", 0.5);
  await fadeOut();

  // 8. Results, on the project site.
  await open(`${site}?video`, "dark");
  await js(`window.scrollTo(0, document.getElementById("results").offsetTop + 40)`);
  await subtitle("");
  await fadeIn(0.3);
  const t7 = clock;
  await say("results");
  sfx("chime", clock + 0.4);
  await live(Math.min(3.2, voice.results.length));
  await until(t7, "results", 0.6);
  await fadeOut();

  // 9. The end: the site's hero prints its receipt.
  await open(`${site}?video-end`, "dark");
  await subtitle("");
  const t8 = clock;
  await fadeIn(0.3);
  sfx("print", t8 + 0.5);
  for (const at of [3.2, 3.7, 4.2]) sfx("thump", t8 + at + 0.2);
  await say("end", t8 + 0.6);
  await live(6.2);
  await hold(t8 + 0.6 + voice.end.length + 1.2 - clock);
  await subtitle("");
  await hold(1.4);
} finally {
  await close();
}

// ---------------------------------------------------------------- sound

/** Writes a mono WAV from an ffmpeg lavfi expression. */
function synth(name, expr, duration, filters = "") {
  const file = path.join(AUDIO, `${name}.wav`);
  ffmpeg(
    "-f",
    "lavfi",
    "-i",
    `aevalsrc='${expr}':s=${RATE}:d=${duration}`,
    ...(filters ? ["-af", filters] : []),
    "-ac",
    "1",
    "-ar",
    String(RATE),
    file,
  );
  return file;
}
const SFX = {
  key: synth(
    "key",
    "0.5*(random(0)-0.5)*exp(-t*320)+0.15*sin(2*PI*3200*t)*exp(-t*500)",
    0.03,
    "highpass=f=1200,volume=0.5",
  ),
  click: synth("click", "0.7*sin(2*PI*1700*t)*exp(-t*90)+0.3*(random(0)-0.5)*exp(-t*300)", 0.06),
  tick: synth("tick", "0.35*sin(2*PI*2400*t)*exp(-t*200)", 0.03),
  thump: synth(
    "thump",
    "0.95*sin(2*PI*(62-26*t)*t)*exp(-t*8)+0.55*(random(0)-0.5)*exp(-t*45)",
    0.55,
    "lowpass=f=2400",
  ),
  whoosh: synth(
    "whoosh",
    "(random(0)-0.5)*sin(PI*t/0.55)",
    0.55,
    "bandpass=f=900:w=1400,volume=0.55",
  ),
  chime: synth(
    "chime",
    "0.28*sin(2*PI*880*t)*exp(-2.6*t)+0.2*sin(2*PI*1318.5*t)*exp(-3*t)+0.12*sin(2*PI*1760*t)*exp(-4*t)",
    1.6,
  ),
  print: synth(
    "print",
    "0.18*(random(0)-0.5)*(0.6+0.4*sin(2*PI*38*t))",
    2.6,
    "bandpass=f=2200:w=1800,afade=t=out:st=2.2:d=0.4",
  ),
};
function samples(file) {
  const out = `${file}.f32`;
  ffmpeg("-i", file, "-f", "f32le", "-ac", "1", "-ar", String(RATE), out);
  const b = readFileSync(out);
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
const total = clock;
const length = Math.ceil(total * RATE);
const effects = new Float32Array(length);
const narration = new Float32Array(length);
function place(track, data, at, gain) {
  const start = Math.round(at * RATE);
  for (let i = 0; i < data.length && start + i < length; i++) track[start + i] += data[i] * gain;
}
const sfxData = Object.fromEntries(Object.entries(SFX).map(([k, f]) => [k, samples(f)]));
for (const e of events) {
  if (e.voice) place(narration, samples(voice[e.voice].file), e.at + 0.05, 1);
  else place(effects, sfxData[e.name], e.at, e.name === "key" ? 0.55 + Math.random() * 0.3 : 0.9);
}
function writeTrack(name, data) {
  const raw = path.join(AUDIO, `${name}.f32`);
  writeFileSync(raw, Buffer.from(data.buffer));
  const wav = path.join(AUDIO, `${name}-track.wav`);
  ffmpeg("-f", "f32le", "-ar", String(RATE), "-ac", "1", "-i", raw, wav);
  return wav;
}
const effectsWav = writeTrack("effects", effects);
const narrationWav = writeTrack("narration", narration);

// A quiet music bed: an A minor, F, C, G pad with a soft pulse and a plucked arpeggio.
const chord = (a, b, c) =>
  `(sin(2*PI*${a}*t)+0.8*sin(2*PI*${b}*t)+0.7*sin(2*PI*${c}*t)+0.5*sin(2*PI*${a / 2}*t))`;
const bar = "mod(t,16)";
const pad = `if(lt(${bar},4),${chord(220, 261.63, 329.63)},if(lt(${bar},8),${chord(174.61, 220, 261.63)},if(lt(${bar},12),${chord(261.63, 329.63, 392)},${chord(196, 246.94, 293.66)})))`;
const arp =
  "sin(2*PI*if(lt(mod(t,1),0.25),440,if(lt(mod(t,1),0.5),523.25,if(lt(mod(t,1),0.75),659.25,523.25)))*t)*exp(-9*mod(t,0.25))";
const pulse = "sin(2*PI*(58-20*mod(t,0.5))*t)*exp(-11*mod(t,0.5))";
const music = synth(
  "music",
  `0.05*${pad}*(0.75+0.25*sin(2*PI*0.125*t))+0.008*${arp}+0.025*${pulse}`,
  total.toFixed(2),
  `lowpass=f=3200,aecho=0.8:0.6:180|360:0.25|0.15,afade=t=in:st=0:d=2,afade=t=out:st=${(total - 3).toFixed(2)}:d=3`,
);
const mix = path.join(AUDIO, "mix.wav");
ffmpeg(
  "-i",
  music,
  "-i",
  effectsWav,
  "-i",
  narrationWav,
  "-filter_complex",
  "[2:a]asplit=2[voice][key];[0:a][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=400[bed];[bed]volume=1.4[bedv];[1:a]volume=0.9[fx];[voice]volume=1.6[vo];[bedv][fx][vo]amix=inputs=3:normalize=0,alimiter=limit=0.95[out]",
  "-map",
  "[out]",
  "-ar",
  String(RATE),
  mix,
);

// ---------------------------------------------------------------- picture and sound together

const list = frames.map((f) => `file '${f.file}'\nduration ${f.duration.toFixed(4)}`).join("\n");
writeFileSync(path.join(WORK, "frames.txt"), `${list}\nfile '${frames.at(-1).file}'\n`);
ffmpeg(
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  path.join(WORK, "frames.txt"),
  "-i",
  mix,
  "-vf",
  `fps=${FPS},format=yuv420p`,
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "21",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-shortest",
  "-movflags",
  "+faststart",
  path.join(ROOT, "docs", "demo.mp4"),
);
ffmpeg("-i", poster, path.join(ROOT, "docs", "assets", "demo-poster.png"));
console.log(
  `  docs/demo.mp4 (${total.toFixed(1)} s, ${frames.length} frames, voice ${VOICE})\n  docs/assets/demo-poster.png`,
);
