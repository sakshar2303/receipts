// `npm run video`: renders the demo film, docs/demo.mp4 (1080p60) and a 4K60
// master in .receipts/video/, from the bundled demo. scripts/video/stage.html
// draws every frame as a pure function of time; this script captures the
// report as 4K textures, writes the narration with the best installed macOS
// voice (a Premium voice when there is one; VOICE=... overrides), times every
// scene to the narration, renders the frames over the DevTools protocol, and
// synthesises the soundtrack in scripts/video/sound.mjs. Needs macOS and ffmpeg.
// Run after `npm run screenshots`, which writes the demo report.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";
import { Bus, SR, soundtrack } from "./video/sound.mjs";

const ROOT = process.cwd();
const SHOTS = path.join(ROOT, ".receipts", "shots");
const WORK = path.join(ROOT, ".receipts", "video");
const FRAMES = path.join(WORK, "frames");
// PREVIEW=1 renders a quick low-frame-rate 1080p draft to .receipts/video/preview.mp4.
const PREVIEW = Boolean(process.env.PREVIEW);
const FPS = PREVIEW ? 6 : Number(process.env.FPS ?? 60);
rmSync(WORK, { recursive: true, force: true });
mkdirSync(FRAMES, { recursive: true });

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 26 });
const ffmpeg = (...args) => run("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const seconds = (file) =>
  Number(
    run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]),
  );

// ---------------------------------------------------------------- the report as textures

const receipt = JSON.parse(readFileSync(path.join(SHOTS, "report", "report.json"), "utf8"));
const build = receipt.claims.find(
  (c) => c.verdict === "contradicted" && c.text.includes("build"),
)?.id;
const reportUrl = pathToFileURL(path.join(SHOTS, "report", "report.html")).href;
const pageRect = (tab, selector) =>
  tab.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; })()`);

const { browser, close } = await launchChrome();
const tab = await openPage(browser);
const ASSETS = {};
await tab.view(1440, 900, "light", false, 2);
await tab.goto(`${reportUrl}?a`);
writeFileSync(path.join(WORK, "tex-a.png"), await tab.capture(".masthead", ".panes", { pad: 0 }));
ASSETS.a = { src: "tex-a.png", counts: await pageRect(tab, ".strip") };
await tab.goto(`${reportUrl}?b#claim=${build}&open=${build}`);
await tab.evaluate("window.scrollTo(0, 0)");
writeFileSync(path.join(WORK, "tex-b.png"), await tab.capture(".masthead", ".panes", { pad: 0 }));
ASSETS.b = { src: "tex-b.png", ev: await pageRect(tab, `#ev-${build}`) };

// ---------------------------------------------------------------- narration

const voices = run("say", ["-v", "?"]).split("\n");
const pick = (re) =>
  voices.map((l) => /^(.+?)\s{2,}(en_[A-Z]{2})/.exec(l)).find((m) => m && re.test(m[1]))?.[1];
const VOICE = process.env.VOICE ?? pick(/\(Premium\)/) ?? pick(/\(Enhanced\)/) ?? "Daniel";
const RATE = /Premium|Enhanced/.test(VOICE) ? "182" : "176";

const results = readFileSync(path.join(ROOT, "eval", "results.md"), "utf8");
const real = results.slice(results.indexOf("## Real sessions"));
const fv = /False-verified rate\*\*\s*\|\s*\*\*[\d.]+%\*\* \((\d+) of (\d+)\)/.exec(real);
const [wrong, marked] = fv ? [Number(fv[1]), Number(fv[2])] : [0, 0];

const TEXT = {
  cold1: "Your coding agent says it's done. Every box is ticked.",
  cold2: "But did it actually check?",
  title: "Meet Receipts.",
  pipe: "It reads the agent's transcript and the git diff, pulls every claim out of its final message, and checks each one against what actually ran.",
  rep1: "Every claim gets a verdict, linked to its evidence.",
  rep2: "Nine claims. Only two are proven.",
  rep3: "The agent said the build succeeds. The last build exited with code two. Contradicted.",
  stale:
    "All tests passed at step eight. Then the agent edited the tests, and never ran them again. That claim is stale.",
  flags: "It also flags what the agent never mentioned, like a test it quietly skipped.",
  gate: "Wire it into a pre-push hook or CI, and a false claim never ships.",
  nums:
    wrong === 0
      ? `On forty-five real agent replies, it marked ${marked} claims verified. Not one was wrong.`
      : "On forty-five real agent replies, almost every claim it marked verified held up.",
  outro: "Free. Local. Open source. Your agent says it's done. Check the receipts.",
};
const VO = {};
for (const [k, text] of Object.entries(TEXT)) {
  const file = path.join(WORK, `vo-${k}.aiff`);
  run("say", ["-v", VOICE, "-r", RATE, "-o", file, text]);
  VO[k] = { file, len: seconds(file), text };
}

// ---------------------------------------------------------------- the timeline

const scenes = [];
const lines = [];
const flashes = [];
const events = [];
let cursor = 0;
/** Starts a scene `overlap` seconds before the previous one ends. */
function addScene(id, make, overlap = 0.45) {
  const start = Math.max(0, cursor - overlap);
  const s = { id, start, marks: {}, shakes: [] };
  const end = make(s, (k, at) => {
    lines.push({ start: start + at, end: start + at + VO[k].len, text: VO[k].text, vo: k });
    return at + VO[k].len;
  });
  s.end = start + end;
  scenes.push(s);
  cursor = s.end;
  return s;
}
/** Where in a line a phrase is spoken, by its share of the characters. */
const phraseAt = (k, from, phrase) =>
  from + (VO[k].text.indexOf(phrase) / VO[k].text.length) * VO[k].len;
const fx = (name, at, gain = 1, len) => events.push({ name, at, gain, ...(len ? { len } : {}) });

const cold = addScene(
  "s-cold",
  (s, say) => {
    s.marks.checks = 1.2;
    const end1 = say("cold1", 0.5);
    s.marks.glitch = Math.max(end1 + 0.25, s.marks.checks + 4 * 0.42 + 0.4);
    s.marks.question = s.marks.glitch + 0.85;
    return say("cold2", s.marks.question + 0.1) + 0.9;
  },
  0,
);
const title = addScene("s-title", (s, say) => {
  say("title", 0.9);
  s.marks.stamp = 2.7;
  s.shakes.push(s.marks.stamp);
  s.shakeAmp = 22;
  return 5.2;
});
flashes.push({ at: title.start + title.marks.stamp + 0.22, len: 0.35, amount: 0.55 });
const pipe = addScene("s-pipe", (s, say) => {
  const end = say("pipe", 0.6);
  s.marks.converge = phraseAt("pipe", 0.6, "and checks each one");
  s.marks.fan = s.marks.converge + 1.25;
  return Math.max(end + 0.8, s.marks.fan + 5 * 0.28 + 1.4);
});
const report = addScene("s-report", (s, say) => {
  const e1 = say("rep1", 0.9);
  s.marks.counts = e1 + 0.15;
  const e2 = say("rep2", s.marks.counts + 0.5);
  s.marks.dive = e2 + 0.35;
  s.marks.open = s.marks.dive + 0.6;
  const e3 = say("rep3", s.marks.dive + 0.5);
  s.marks.stamp = phraseAt("rep3", s.marks.dive + 0.5, "Contradicted");
  s.shakes.push(s.marks.stamp);
  return Math.max(e3, s.marks.stamp + 0.5) + 1.2;
});
flashes.push({ at: report.start + report.marks.stamp + 0.22, len: 0.25, amount: 0.25 });
const stale = addScene("s-stale", (s, say) => {
  const from = 1.4;
  const end = say("stale", from);
  s.marks.pass = phraseAt("stale", from, "step eight") - 0.2;
  s.marks.edits = phraseAt("stale", from, "Then the agent edited");
  s.marks.decay = phraseAt("stale", from, "and never ran");
  s.marks.stamp = phraseAt("stale", from, "is stale") + 0.15;
  s.shakes.push(s.marks.stamp);
  return end + 1.3;
});
const flags = addScene("s-flags", (s, say) => {
  const end = say("flags", 0.5);
  s.marks.type = phraseAt("flags", 0.5, "like a test") - 0.2;
  s.marks.flag = s.marks.type + 0.85;
  s.marks.chips = s.marks.flag + 0.8;
  return Math.max(end + 0.6, s.marks.chips + 11 * 0.12 + 1.2);
});
const gate = addScene("s-gate", (s, say) => {
  s.marks.out = 1.7;
  const end = say("gate", 0.4);
  s.marks.block = Math.max(s.marks.out + 1.5, phraseAt("gate", 0.4, "never ships"));
  s.shakes.push(s.marks.block);
  s.shakeAmp = 26;
  return Math.max(end, s.marks.block + 0.6) + 1.2;
});
flashes.push({ at: gate.start + gate.marks.block + 0.2, len: 0.3, amount: 0.3 });
const nums = addScene("s-nums", (s, say) => {
  const end = say("nums", 0.8);
  s.marks.flip = 0.9;
  return Math.max(end + 1.2, s.marks.flip + 4 * 0.45 + 2.2);
});
const outro = addScene("s-outro", (s, say) => {
  const end = say("outro", 0.7);
  s.marks.stamp = phraseAt("outro", 0.7, "Check the receipts") + 0.5;
  s.shakes.push(s.marks.stamp);
  return end + 3.2;
});
flashes.push({ at: outro.start + outro.marks.stamp + 0.22, len: 0.3, amount: 0.3 });
const TOTAL = cursor;

const TL = {
  scenes,
  lines,
  flashes,
  tiles: [
    {
      value: String(wrong),
      label: "claims wrongly marked verified, on 45 real agent replies",
      green: wrong === 0,
    },
    { value: String(marked), label: "claims it marked verified, each checked by hand" },
    { value: "11", label: "risk flags, from skipped tests to leaked secrets" },
    { value: "<1", label: "second for a 528-step session, all on your machine" },
  ],
};

// ---------------------------------------------------------------- sound effects on the timeline

const S = (s, k) => s.start + s.marks[k];
for (let i = 0; i < 24; i++) fx("key", cold.start + 0.3 + i / 32, 0.6);
for (let i = 0; i < 4; i++) fx("pop", S(cold, "checks") + i * 0.42, 0.8);
fx("glitch", S(cold, "glitch"), 1);
fx("whoosh", S(cold, "question") - 0.1, 0.8, 0.6);
fx("riser", S(title, "stamp") - 2.6 + 0.2, 1.1, 2.6);
fx("print", title.start + 0.2, 0.9, title.marks.stamp - 0.6);
fx("impact", S(title, "stamp") + 0.2, 1.2);
fx("stamp", S(title, "stamp") + 0.2, 1);
for (let i = 0; i < 3; i++) fx("whoosh", pipe.start + 0.15 + i * 0.25, 0.7, 0.7);
fx("whoosh", S(pipe, "converge"), 1, 0.9);
fx("impact", S(pipe, "converge") + 0.8, 0.45);
for (let i = 0; i < 5; i++) fx("stamp", S(pipe, "fan") + i * 0.28 + 0.12, 0.45);
fx("whoosh", report.start, 0.9, 1.1);
fx("blip", S(report, "counts") + 0.6, 1);
fx("whoosh", S(report, "dive"), 0.8, 1.1);
fx("blip", S(report, "dive") + 1.1, 1);
fx("stamp", S(report, "stamp") + 0.2, 1);
fx("whoosh", stale.start + 0.2, 0.5, 1.2);
for (let i = 1; i <= 15; i++) fx("clack", stale.start + 0.3 + i * 0.06, 0.35);
fx("chime", S(stale, "pass"), 1);
for (let i = 0; i < 3; i++) fx("stamp", S(stale, "edits") + i * 0.35 + 0.38, 0.55);
fx("down", S(stale, "decay"), 1);
fx("stamp", S(stale, "stamp") + 0.2, 1);
for (let i = 0; i < 5; i++) fx("key", S(flags, "type") + i * 0.12, 0.9);
fx("whoosh", S(flags, "flag"), 0.6, 0.6);
fx("buzz", S(flags, "flag") + 0.1, 0.5);
for (let i = 0; i < 11; i++) fx("clack", S(flags, "chips") + i * 0.12, 0.55);
for (let i = 0; i < 20; i++) fx("key", gate.start + 0.3 + i / 18, 0.6);
for (let i = 0; i < 4; i++) fx("blip", S(gate, "out") + i * 0.35, 0.7);
fx("buzz", S(gate, "block") + 0.15, 1.2);
fx("impact", S(gate, "block") + 0.2, 0.8);
for (let i = 0; i < 4; i++) {
  const value = TL.tiles[i].value;
  for (let j = 0; j < value.length; j++) {
    const start = S(nums, "flip") + i * 0.45 + j * 0.12;
    for (let k = 0; k < 16; k++) fx("clack", start + k / 18, 0.3);
  }
}
fx("chime", S(nums, "flip") + 0.9, 0.6);
fx("print", outro.start + 0.4, 0.7, outro.marks.stamp - 0.8);
fx("stamp", S(outro, "stamp") + 0.2, 1);
fx("impact", S(outro, "stamp") + 0.2, 0.9);

// ---------------------------------------------------------------- frames

let html = readFileSync(path.join(ROOT, "scripts", "video", "stage.html"), "utf8");
html = html.replace(
  "<script>",
  `<script>window.TL=${JSON.stringify(TL)};window.ASSETS=${JSON.stringify(ASSETS)};</script>\n<script>`,
);
writeFileSync(path.join(WORK, "stage.html"), html);
// Headless Chrome occasionally stops answering a capture on long runs; a frame
// that takes too long restarts the browser and the render resumes from it.
const stageUrl = pathToFileURL(path.join(WORK, "stage.html")).href;
let session = { close, tab };
const within = (promise, ms) =>
  Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
async function openStage() {
  await within(session.tab.view(1920, 1080, "dark", false, PREVIEW ? 1 : 2), 15000);
  await within(session.tab.goto(stageUrl), 20000);
  await new Promise((r) => setTimeout(r, 800));
}
await openStage();
const N = Math.ceil(TOTAL * FPS);
const started = Date.now();
let poster;
for (let f = 0; f < N;) {
  const t = f / FPS;
  const file = path.join(FRAMES, `${String(f).padStart(5, "0")}.jpg`);
  try {
    await within(session.tab.evaluate(`render(${t.toFixed(5)}, ${f})`), 15000);
    writeFileSync(file, await within(session.tab.shot("jpeg", 92), 15000));
  } catch (error) {
    process.stdout.write(`  frame ${f}: ${error.message}; restarting Chrome\n`);
    await within(session.close(), 5000).catch(() => undefined);
    try {
      const fresh = await within(launchChrome(), 20000);
      session = { close: fresh.close, tab: await within(openPage(fresh.browser), 15000) };
      await openStage();
    } catch (again) {
      process.stdout.write(`  restart failed (${again.message}); trying again\n`);
    }
    continue;
  }
  if (!poster && t >= S(report, "stamp") + 0.6) poster = file;
  if (f % 600 === 0)
    process.stdout.write(`  frame ${f}/${N} (${((Date.now() - started) / 1000).toFixed(0)} s)\n`);
  f++;
}
await session.close();

// ---------------------------------------------------------------- sound

const beat = 60 / 112;
const tStamp = S(title, "stamp") + 0.2;
const {
  music,
  drums,
  fx: fxBus,
} = soundtrack({
  duration: TOTAL + 2,
  bpm: 112,
  origin: tStamp,
  events,
  sections: [
    { from: cold.start + 0.4, to: S(cold, "glitch"), kind: "intro" },
    { from: S(cold, "glitch"), to: tStamp - 0.01, kind: "cut" },
    { from: tStamp, to: S(stale, "pass") - 2 * beat, kind: "groove" },
    { from: S(stale, "pass") - 2 * beat, to: nums.start - 8 * beat, kind: "lite" },
    { from: nums.start - 8 * beat, to: nums.start - 0.05, kind: "build" },
    { from: nums.start, to: outro.start, kind: "lite" },
    { from: outro.start, to: TOTAL - 2.5, kind: "full" },
  ],
});
const voice = new Float32Array(music.n);
for (const l of lines) {
  const raw = path.join(WORK, `${l.vo}.f32`);
  ffmpeg("-i", VO[l.vo].file, "-f", "f32le", "-ac", "1", "-ar", String(SR), raw);
  const b = readFileSync(raw);
  const v = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const s0 = Math.round(l.start * SR);
  for (let i = 0; i < v.length && s0 + i < voice.length; i++) voice[s0 + i] += v[i];
}
// The music steps back while the voice speaks.
let env = 0;
const master = new Bus(TOTAL + 2);
for (let i = 0; i < master.n; i++) {
  const a = Math.abs(voice[i]);
  env = a > env ? env + (a - env) * 0.01 : env * 0.99993;
  const duck = 1 - 0.62 * Math.min(1, env * 7);
  const fadeOut = Math.min(1, Math.max(0, (TOTAL + 0.5 - i / SR) / 2.5));
  for (const [ch, out] of [
    ["L", master.L],
    ["R", master.R],
  ]) {
    const x =
      (music[ch][i] * duck * 0.9 + drums[ch][i] * (0.55 + 0.45 * duck)) * fadeOut +
      fxBus[ch][i] * 0.9 +
      voice[i] * 1.25;
    out[i] = Math.tanh(x * 0.9);
  }
}
const inter = new Float32Array(master.n * 2);
for (let i = 0; i < master.n; i++) {
  inter[2 * i] = master.L[i];
  inter[2 * i + 1] = master.R[i];
}
writeFileSync(path.join(WORK, "mix.f32"), Buffer.from(inter.buffer));
const mix = path.join(WORK, "mix.wav");
ffmpeg(
  "-f",
  "f32le",
  "-ar",
  String(SR),
  "-ac",
  "2",
  "-i",
  path.join(WORK, "mix.f32"),
  "-af",
  "loudnorm=I=-14:TP=-1.2:LRA=11",
  "-ar",
  String(SR),
  mix,
);

// ---------------------------------------------------------------- encode

if (PREVIEW) {
  ffmpeg(
    "-framerate",
    String(FPS),
    "-i",
    path.join(FRAMES, "%05d.jpg"),
    "-i",
    mix,
    "-c:v",
    "libx264",
    "-crf",
    "26",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    path.join(WORK, "preview.mp4"),
  );
  console.log(`  preview: ${TOTAL.toFixed(1)} s, voice ${VOICE}`);
  process.exit(0);
}
// The film grain changes every frame, which no encoder can compress; a light
// temporal denoise removes it from the file (it is barely visible anyway) and
// cuts the size about twentyfold.
const encode = (out, scale, crf, audio) =>
  ffmpeg(
    "-framerate",
    String(FPS),
    "-i",
    path.join(FRAMES, "%05d.jpg"),
    "-i",
    mix,
    "-vf",
    `${scale ? `scale=${scale}:flags=lanczos,` : ""}hqdn3d=5:4:9:7`,
    "-c:v",
    "libx264",
    "-preset",
    "faster",
    "-crf",
    String(crf),
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-c:a",
    "aac",
    "-b:a",
    audio,
    "-shortest",
    "-movflags",
    "+faststart",
    out,
  );
encode(path.join(ROOT, "docs", "demo.mp4"), "1920:1080", 22, "192k");
const master4k = path.join(WORK, "receipts-demo-4k.mp4");
encode(master4k, null, 21, "256k");
ffmpeg(
  "-i",
  poster,
  "-vf",
  "scale=1920:1080:flags=lanczos",
  path.join(ROOT, "docs", "assets", "demo-poster.png"),
);
copyFileSync(mix, path.join(WORK, "soundtrack.wav"));
console.log(
  `  docs/demo.mp4 (1080p${FPS}), ${path.relative(ROOT, master4k)} (4K${FPS}): ${TOTAL.toFixed(1)} s, ${N} frames, voice ${VOICE}`,
);
