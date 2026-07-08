#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

const SAMPLE_RATE = 44100;
const DEFAULT_BPM = 110;
const DEFAULT_BEATS = 4;
const DEFAULT_WAVE = "saw";
const PAD_DEFAULT_BARS = 2;
const PAD_STEPS_PER_BEAT = 4;
const PAD_MAX_CHORD_KEYS = 9;
const PAD_KEYS = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const PAD_MAX_BARS = 16;
const NOTE_TO_SEMITONE = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11
};

function parseArgs(argv) {
  const args = {
    bpm: DEFAULT_BPM,
    beats: DEFAULT_BEATS,
    wave: DEFAULT_WAVE,
    loop: false,
    prog: "",
    config: "music.json",
    set: "",
    pad: false,
    bars: PAD_DEFAULT_BARS,
    drums: null
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--bpm") args.bpm = Number(argv[++i]);
    else if (token === "--beats") args.beats = Number(argv[++i]);
    else if (token === "--wave") args.wave = String(argv[++i] || "").toLowerCase();
    else if (token === "--prog") args.prog = String(argv[++i] || "");
    else if (token === "--config") args.config = String(argv[++i] || "music.json");
    else if (token === "--set") args.set = String(argv[++i] || "");
    else if (token === "--pad") args.pad = true;
    else if (token === "--bars") args.bars = Number(argv[++i]);
    else if (token === "--loop") args.loop = true;
    else if (token === "--help" || token === "-h") args.help = true;
  }

  return args;
}

function showHelp() {
  console.log(`
Terminal Synt - mini sequencer da terminale

Uso:
  node synt.js --prog "Am F C G" --bpm 120 --beats 4 --wave saw
  node synt.js --prog "Dm/2 G/2 Cmaj7/4" --loop
  node synt.js --set chill1
  node synt.js --config custom-music.json --set 2
  node synt.js --pad --bpm 124 --bars 4 --set drive

Opzioni:
  --prog   Progressione accordi (separati da spazio o virgola)
           Ogni accordo puo avere durata in beat: Am/2 oppure G:4
  --bpm    BPM (default: ${DEFAULT_BPM})
  --beats  Beat di default per accordo (default: ${DEFAULT_BEATS})
  --wave   Forma d'onda: sine | square | saw | tri
  --config File config JSON (default: music.json)
  --set    Nome preset o indice preset nel file config
  --pad    Modalita pad: registra drum e accordi da tastiera
  --bars   Numero battute per il loop pad (default: ${PAD_DEFAULT_BARS})
  --loop   Riproduce in loop finche non premi Ctrl+C
  --help   Mostra questa guida
`);
}

function safeReadJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseDrumPatternString(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  return Array.from(cleaned).map((ch) => /[xX1*oO]/.test(ch));
}

function normalizeDrums(raw) {
  if (!raw || typeof raw !== "object") return null;

  const stepsPerBeatRaw = Number(raw.stepsPerBeat);
  const stepsPerBeat = Number.isFinite(stepsPerBeatRaw)
    ? Math.max(1, Math.min(8, Math.floor(stepsPerBeatRaw)))
    : 4;

  const kick = parseDrumPatternString(raw.kick);
  const snare = parseDrumPatternString(raw.snare);
  const hat = parseDrumPatternString(raw.hat);
  const clap = parseDrumPatternString(raw.clap);

  if (!kick && !snare && !hat && !clap) return null;

  return {
    stepsPerBeat,
    kick,
    snare,
    hat,
    clap
  };
}

function normalizePreset(raw, fallbackName) {
  if (!raw || typeof raw !== "object") return null;

  const preset = {
    name: String(raw.name || fallbackName || "preset").trim(),
    prog: String(raw.prog || raw.progression || "").trim(),
    bpm: raw.bpm === undefined ? undefined : Number(raw.bpm),
    beats: raw.beats === undefined ? undefined : Number(raw.beats),
    wave: raw.wave === undefined ? undefined : String(raw.wave).toLowerCase(),
    loop: raw.loop === undefined ? undefined : Boolean(raw.loop),
    drums: normalizeDrums(raw.drums)
  };

  if (!preset.prog) return null;
  return preset;
}

function loadConfigPresets(configPath) {
  const abs = path.resolve(process.cwd(), configPath || "music.json");
  const parsed = safeReadJson(abs);
  if (!parsed) return [];

  let items = [];
  if (Array.isArray(parsed)) items = parsed;
  else if (Array.isArray(parsed.sets)) items = parsed.sets;
  else if (Array.isArray(parsed.presets)) items = parsed.presets;
  else if (typeof parsed === "object") items = [parsed];

  return items
    .map((p, i) => normalizePreset(p, `set-${i + 1}`))
    .filter(Boolean);
}

function loadLoopFolderPresets() {
  const loopDir = path.resolve(process.cwd(), "loop");
  if (!fs.existsSync(loopDir)) return [];

  const files = fs
    .readdirSync(loopDir)
    .filter((name) => name.toLowerCase().endsWith(".json"));

  const presets = [];
  for (const fileName of files) {
    const abs = path.join(loopDir, fileName);
    const parsed = safeReadJson(abs);
    const preset = normalizePreset(parsed, path.parse(fileName).name);
    if (preset) presets.push({ ...preset, sourceFile: fileName });
  }

  return presets;
}

function resolvePresetById(presets, setValue) {
  if (!setValue) return null;
  const id = String(setValue).trim().toLowerCase();
  if (!id) return null;

  const asIndex = Number(id);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= presets.length) {
    return presets[asIndex - 1];
  }

  return presets.find((p) => p.name.toLowerCase() === id) || null;
}

function applyPreset(args, preset) {
  args.prog = preset.prog;
  if (Number.isFinite(preset.bpm)) args.bpm = preset.bpm;
  if (Number.isFinite(preset.beats)) args.beats = preset.beats;
  if (preset.wave) args.wave = preset.wave;
  if (typeof preset.loop === "boolean") args.loop = preset.loop;
  if (preset.drums) args.drums = preset.drums;
  return args;
}

async function choosePresetInteractive(rl, presets, label) {
  if (presets.length === 0) return null;

  console.log(`\nPreset disponibili (${label}):`);
  for (let i = 0; i < presets.length; i += 1) {
    const p = presets[i];
    const source = p.sourceFile ? ` | file: ${p.sourceFile}` : "";
    const bpm = Number.isFinite(p.bpm) ? p.bpm : DEFAULT_BPM;
    const beats = Number.isFinite(p.beats) ? p.beats : DEFAULT_BEATS;
    const wave = p.wave || DEFAULT_WAVE;
    console.log(`${i + 1}. ${p.name} -> ${p.prog} (bpm:${bpm} beats:${beats} wave:${wave})${source}`);
  }

  const choice = await ask("Scegli numero preset (Invio per saltare): ", rl);
  if (!choice) return null;

  const idx = Number(choice);
  if (!Number.isInteger(idx) || idx < 1 || idx > presets.length) {
    console.log("Selezione non valida, continuo senza preset.");
    return null;
  }

  return presets[idx - 1];
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function parseChordSymbol(symbol) {
  const m = /^([A-G](?:#|b)?)(.*)$/.exec(symbol.trim());
  if (!m) return null;

  const root = m[1];
  const quality = (m[2] || "").toLowerCase();

  let intervals = [0, 4, 7];
  if (quality.startsWith("m") && !quality.startsWith("maj")) intervals = [0, 3, 7];
  if (quality.includes("dim")) intervals = [0, 3, 6];
  if (quality.includes("aug")) intervals = [0, 4, 8];
  if (quality.includes("sus2")) intervals = [0, 2, 7];
  if (quality.includes("sus4")) intervals = [0, 5, 7];

  if (quality.includes("maj7")) intervals = [...intervals, 11];
  else if (quality.includes("7")) intervals = [...intervals, 10];

  if (quality.includes("add9")) intervals = [...intervals, 14];

  const semitone = NOTE_TO_SEMITONE[root];
  if (semitone === undefined) return null;

  const rootMidi = 48 + semitone;
  const notes = intervals.map((itv) => rootMidi + itv);

  // Raddoppio all'ottava per un suono piu pieno.
  return [...notes, ...notes.map((n) => n + 12)].map(midiToFreq);
}

function parseProgression(input, defaultBeats) {
  const tokens = input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const out = [];
  for (const tok of tokens) {
    const m = /^([^/:]+)(?:[/:](\d+))?$/.exec(tok);
    if (!m) continue;
    const chord = m[1];
    const beats = m[2] ? Number(m[2]) : defaultBeats;
    if (!Number.isFinite(beats) || beats <= 0) continue;
    out.push({ chord, beats });
  }

  return out;
}

function osc(phase, wave) {
  if (wave === "sine") return Math.sin(phase);
  if (wave === "square") return Math.sign(Math.sin(phase)) || 1;
  if (wave === "tri") {
    const x = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
    return 1 - 4 * Math.abs(x - 0.5);
  }
  // saw
  const x = ((phase / (2 * Math.PI)) % 1 + 1) % 1;
  return 2 * x - 1;
}

function clampUnit(v) {
  return Math.max(-1, Math.min(1, v));
}

function playPreviewBeep(freqHz, durationMs) {
  const safeFreq = Math.max(37, Math.min(32767, Math.floor(freqHz || 440)));
  const safeDuration = Math.max(20, Math.min(400, Math.floor(durationMs || 80)));

  if (process.platform === "win32") {
    const script = `[console]::Beep(${safeFreq},${safeDuration})`;
    const child = spawn("powershell", ["-NoProfile", "-Command", script], {
      stdio: "ignore"
    });
    child.unref();
    return;
  }

  // Fallback semplice su altri sistemi.
  process.stdout.write("\u0007");
}

function previewDrumKey(keyName) {
  if (keyName === "z") {
    playPreviewBeep(90, 70);
    return;
  }
  if (keyName === "x") {
    playPreviewBeep(210, 80);
    return;
  }
  if (keyName === "c") {
    playPreviewBeep(1300, 30);
    return;
  }
  if (keyName === "v") {
    playPreviewBeep(320, 110);
  }
}

function previewChordKey(keyName, keyToChord) {
  const chord = keyToChord[keyName];
  if (!chord) return;

  const freqs = parseChordSymbol(chord);
  if (!freqs || freqs.length === 0) return;

  // Preview veloce: nota radice traslata in range piu udibile per beep.
  const root = freqs[0];
  const audible = root < 220 ? root * 3 : root * 1.5;
  playPreviewBeep(audible, 120);
}

function uniqueChordsFromProg(prog) {
  const parsed = parseProgression(prog || "", DEFAULT_BEATS);
  const unique = [];
  for (const item of parsed) {
    if (!unique.includes(item.chord)) unique.push(item.chord);
  }
  return unique;
}

async function waitEnter(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    await ask(question, rl);
  } finally {
    rl.close();
  }
}

function quantizeToStep(timeMs, durationMs, totalSteps) {
  if (durationMs <= 0) return 0;
  const ratio = Math.max(0, Math.min(0.999999, timeMs / durationMs));
  return Math.floor(ratio * totalSteps);
}

function deriveLoopTimingFromElapsed(elapsedMs, bpm, stepsPerBeat) {
  const stepsPerBar = 4 * stepsPerBeat;
  const stepMs = (60 / bpm) * 1000 / stepsPerBeat;
  const minSteps = stepsPerBar;
  const maxSteps = PAD_MAX_BARS * stepsPerBar;

  const rawSteps = Math.max(minSteps, Math.round(elapsedMs / stepMs));
  const alignedSteps = Math.min(maxSteps, Math.max(minSteps, Math.ceil(rawSteps / stepsPerBar) * stepsPerBar));
  const bars = alignedSteps / stepsPerBar;
  const durationMs = Math.round(alignedSteps * stepMs);

  return { bars, totalSteps: alignedSteps, durationMs };
}

function addKick(buffer, startSample) {
  const duration = Math.floor(SAMPLE_RATE * 0.22);
  for (let i = 0; i < duration; i += 1) {
    const idx = startSample + i;
    if (idx >= buffer.length) break;
    const t = i / SAMPLE_RATE;
    const f = 110 - 70 * t;
    buffer[idx] += Math.sin(2 * Math.PI * f * t) * Math.exp(-16 * t) * 0.95;
  }
}

function addSnare(buffer, startSample) {
  const duration = Math.floor(SAMPLE_RATE * 0.16);
  for (let i = 0; i < duration; i += 1) {
    const idx = startSample + i;
    if (idx >= buffer.length) break;
    const t = i / SAMPLE_RATE;
    const noise = (Math.random() * 2 - 1) * Math.exp(-28 * t) * 0.45;
    const tone = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-20 * t) * 0.2;
    buffer[idx] += noise + tone;
  }
}

function addHat(buffer, startSample) {
  const duration = Math.floor(SAMPLE_RATE * 0.06);
  for (let i = 0; i < duration; i += 1) {
    const idx = startSample + i;
    if (idx >= buffer.length) break;
    const t = i / SAMPLE_RATE;
    buffer[idx] += (Math.random() * 2 - 1) * Math.exp(-95 * t) * 0.18;
  }
}

function addClap(buffer, startSample) {
  const offsets = [0, 0.012, 0.024].map((s) => Math.floor(s * SAMPLE_RATE));
  for (const off of offsets) {
    const duration = Math.floor(SAMPLE_RATE * 0.045);
    for (let i = 0; i < duration; i += 1) {
      const idx = startSample + off + i;
      if (idx >= buffer.length) break;
      const t = i / SAMPLE_RATE;
      buffer[idx] += (Math.random() * 2 - 1) * Math.exp(-80 * t) * 0.14;
    }
  }
}

function addChordStab(buffer, startSample, chord, wave, durationSamples) {
  const freqs = parseChordSymbol(chord);
  if (!freqs || freqs.length === 0) return;

  const phases = freqs.map(() => 0);
  const phaseInc = freqs.map((f) => (2 * Math.PI * f) / SAMPLE_RATE);
  const attack = Math.max(1, Math.floor(SAMPLE_RATE * 0.008));
  const release = Math.max(1, Math.floor(SAMPLE_RATE * 0.18));

  for (let i = 0; i < durationSamples; i += 1) {
    const idx = startSample + i;
    if (idx >= buffer.length) break;

    let env = 0.9;
    const tail = durationSamples - i;
    if (i < attack) env = i / attack;
    else if (tail < release) env = tail / release;

    let s = 0;
    for (let t = 0; t < freqs.length; t += 1) {
      s += osc(phases[t], wave) * 0.15;
      phases[t] += phaseInc[t];
      if (phases[t] > 2 * Math.PI) phases[t] -= 2 * Math.PI;
    }

    buffer[idx] += s * env;
  }
}

function renderPadLoop(options) {
  const bpm = options.bpm;
  const bars = options.bars;
  const wave = options.wave;
  const stepsPerBeat = options.stepsPerBeat;
  const drumPattern = options.drumPattern;
  const chordPattern = options.chordPattern;

  const totalSteps = bars * 4 * stepsPerBeat;
  const loopSamples = Math.floor((60 / bpm) * 4 * bars * SAMPLE_RATE);
  const stepSamples = Math.max(1, Math.floor(loopSamples / totalSteps));
  const chordLength = Math.max(stepSamples * 6, Math.floor((60 / bpm) * SAMPLE_RATE * 1.35));
  const out = new Float32Array(loopSamples);

  for (let step = 0; step < totalSteps; step += 1) {
    const from = step * stepSamples;

    if (drumPattern.kick[step]) addKick(out, from);
    if (drumPattern.snare[step]) addSnare(out, from);
    if (drumPattern.hat[step]) addHat(out, from);
    if (drumPattern.clap[step]) addClap(out, from);

    const chord = chordPattern[step];
    if (chord) addChordStab(out, from, chord, wave, chordLength);
  }

  let peak = 0;
  for (let i = 0; i < out.length; i += 1) {
    peak = Math.max(peak, Math.abs(out[i]));
  }

  const gain = peak > 0.98 ? 0.98 / peak : 1;
  for (let i = 0; i < out.length; i += 1) {
    out[i] = clampUnit(out[i] * gain);
  }

  return out;
}

function buildDrumBufferForSequence(totalSamples, bpm, totalBeats, drumsConfig) {
  const out = new Float32Array(totalSamples);
  const stepsPerBeat = drumsConfig && Number.isFinite(drumsConfig.stepsPerBeat)
    ? Math.max(1, Math.min(8, Math.floor(drumsConfig.stepsPerBeat)))
    : 4;

  const totalSteps = Math.max(1, Math.ceil(totalBeats * stepsPerBeat));
  const stepSamples = Math.max(1, Math.floor((60 / bpm) * SAMPLE_RATE / stepsPerBeat));
  const halfBeatStep = Math.max(1, Math.floor(stepsPerBeat / 2));

  const hasCustom = Boolean(drumsConfig && (drumsConfig.kick || drumsConfig.snare || drumsConfig.hat || drumsConfig.clap));

  for (let step = 0; step < totalSteps; step += 1) {
    const from = step * stepSamples;
    if (from >= totalSamples) break;

    if (hasCustom) {
      const hitKick = drumsConfig.kick && drumsConfig.kick.length > 0 && drumsConfig.kick[step % drumsConfig.kick.length];
      const hitSnare = drumsConfig.snare && drumsConfig.snare.length > 0 && drumsConfig.snare[step % drumsConfig.snare.length];
      const hitHat = drumsConfig.hat && drumsConfig.hat.length > 0 && drumsConfig.hat[step % drumsConfig.hat.length];
      const hitClap = drumsConfig.clap && drumsConfig.clap.length > 0 && drumsConfig.clap[step % drumsConfig.clap.length];

      if (hitKick) addKick(out, from);
      if (hitSnare) addSnare(out, from);
      if (hitHat) addHat(out, from);
      if (hitClap) addClap(out, from);
      continue;
    }

    const onBeat = step % stepsPerBeat === 0;
    const beatIndex = Math.floor(step / stepsPerBeat);

    if (onBeat) addKick(out, from);
    if (onBeat && (beatIndex % 4 === 1 || beatIndex % 4 === 3)) addSnare(out, from);
    if (step % halfBeatStep === 0) addHat(out, from);
  }

  return out;
}

async function capturePadEvents(options) {
  const durationMs = options.durationMs;
  const validKeys = options.validKeys || [];
  const stopKeys = new Set((options.stopKeys || ["return", "enter"]).map((k) => String(k).toLowerCase()));
  const onAcceptedKey = options.onAcceptedKey;

  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Modalita pad richiede un terminale TTY interattivo.");
  }

  const accepted = new Set(validKeys.map((k) => String(k).toLowerCase()));

  return new Promise((resolve, reject) => {
    const events = [];
    const startedAt = Date.now();
    const wasRaw = Boolean(process.stdin.isRaw);
    let timer = null;
    let finished = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      process.stdin.removeListener("keypress", onKeypress);
      process.stdin.setRawMode(wasRaw);
    };

    const finish = (reason) => {
      if (finished) return;
      finished = true;
      cleanup();
      process.stdout.write("\n");
      resolve({
        events,
        elapsedMs: Date.now() - startedAt,
        stopReason: reason
      });
    };

    const onKeypress = (str, key) => {
      const keyName = (key && key.name ? key.name : str || "").toLowerCase();
      if (!keyName) return;

      if (key && key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Registrazione interrotta (Ctrl+C)."));
        return;
      }

      if (stopKeys.has(keyName)) {
        finish("manual-stop");
        return;
      }

      if (!accepted.has(keyName)) return;

      events.push({ key: keyName, timeMs: Date.now() - startedAt });
      process.stdout.write(".");
      if (typeof onAcceptedKey === "function") onAcceptedKey(keyName);
    };

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("keypress", onKeypress);

    if (Number.isFinite(durationMs) && durationMs > 0) {
      timer = setTimeout(() => {
        finish("timeout");
      }, durationMs);
    }
  });
}

function buildChordKeyMap(args) {
  const fromProg = uniqueChordsFromProg(args.prog);
  const fallback = ["Am", "F", "C", "G"];
  const chords = (fromProg.length > 0 ? fromProg : fallback).slice(0, PAD_MAX_CHORD_KEYS);

  return chords.map((chord, i) => ({ key: PAD_KEYS[i], chord }));
}

async function recordDrumPattern(bpm, stepsPerBeat) {
  const drumMap = { z: "kick", x: "snare", c: "hat", v: "clap" };
  const stepsPerBar = 4 * stepsPerBeat;
  const minRecordMs = Math.floor((60 / bpm) * 1000);

  console.log("\n[PAD] Drum REC: z=kick x=snare c=hat v=clap");
  console.log("[PAD] Premi INVIO quando vuoi chiudere il loop drum.");
  console.log("[PAD] Ogni tasto registrato stampa un punto.");
  await waitEnter("[PAD] Premi Invio per iniziare la registrazione drum... ");

  const rec = await capturePadEvents({
    validKeys: Object.keys(drumMap),
    stopKeys: ["return", "enter"],
    onAcceptedKey: (keyName) => {
      previewDrumKey(keyName);
    }
  });

  const elapsed = Math.max(minRecordMs, rec.elapsedMs);
  const loopInfo = deriveLoopTimingFromElapsed(elapsed, bpm, stepsPerBeat);
  const pattern = {
    kick: Array(loopInfo.totalSteps).fill(0),
    snare: Array(loopInfo.totalSteps).fill(0),
    hat: Array(loopInfo.totalSteps).fill(0),
    clap: Array(loopInfo.totalSteps).fill(0)
  };

  for (const ev of rec.events) {
    const step = quantizeToStep(ev.timeMs, loopInfo.durationMs, loopInfo.totalSteps);
    const instrument = drumMap[ev.key];
    if (instrument) pattern[instrument][step] = 1;
  }

  const kickHits = pattern.kick.reduce((a, v) => a + v, 0);
  const snareHits = pattern.snare.reduce((a, v) => a + v, 0);
  const hatHits = pattern.hat.reduce((a, v) => a + v, 0);
  const clapHits = pattern.clap.reduce((a, v) => a + v, 0);
  console.log(`[PAD] Loop drum: ${loopInfo.bars} bars (${loopInfo.totalSteps} step). Hits k:${kickHits} s:${snareHits} h:${hatHits} c:${clapHits}`);

  return { pattern, loopInfo };
}

async function recordChordPattern(durationMs, totalSteps, chordMap) {
  const byKey = {};
  for (const item of chordMap) byKey[item.key] = item.chord;

  console.log("\n[PAD] Chord REC: usa i tasti mappati sotto");
  console.log(chordMap.map((i) => `${i.key}:${i.chord}`).join(" | "));
  console.log("[PAD] Premi INVIO per terminare prima, altrimenti si ferma a fine loop.");
  await waitEnter("[PAD] Premi Invio per registrare gli accordi... ");

  const rec = await capturePadEvents({
    durationMs,
    validKeys: chordMap.map((i) => i.key),
    stopKeys: ["return", "enter"],
    onAcceptedKey: (keyName) => {
      previewChordKey(keyName, byKey);
    }
  });

  const pattern = Array(totalSteps).fill("");

  for (const ev of rec.events) {
    const step = quantizeToStep(ev.timeMs, durationMs, totalSteps);
    const chord = byKey[ev.key];
    if (chord) pattern[step] = chord;
  }

  const chordHits = pattern.filter(Boolean).length;
  console.log(`[PAD] Chord hits registrati: ${chordHits}`);

  return pattern;
}

async function runPadMode(args) {
  const stepsPerBeat = PAD_STEPS_PER_BEAT;

  console.log("\nModalita PAD attiva");
  console.log(`BPM: ${args.bpm}`);
  console.log("[PAD] La lunghezza del loop la scegli tu fermando la Drum REC con Invio.");

  const drumRec = await recordDrumPattern(args.bpm, stepsPerBeat);
  const bars = drumRec.loopInfo.bars;
  const totalSteps = drumRec.loopInfo.totalSteps;
  const durationMs = drumRec.loopInfo.durationMs;

  const chordMap = buildChordKeyMap(args);
  const chordPattern = await recordChordPattern(durationMs, totalSteps, chordMap);

  const audio = renderPadLoop({
    bpm: args.bpm,
    bars,
    wave: args.wave,
    stepsPerBeat,
    drumPattern: drumRec.pattern,
    chordPattern
  });

  const wav = floatToWavBuffer(audio);
  const outFile = path.join(os.tmpdir(), "terminal-synt-pad-loop.wav");
  fs.writeFileSync(outFile, wav);

  console.log("\n[PAD] Loop pronto.");
  console.log(`File audio temporaneo: ${outFile}`);
  console.log("Riproduzione in loop... premi Ctrl+C per fermare.\n");

  const child = playWav(outFile, true);
  const stop = () => {
    if (child && !child.killed) child.kill();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  child.on("error", (err) => {
    console.error(`Errore player audio: ${err.message}`);
    process.exit(1);
  });
}

function renderSequence(prog, bpm, wave, drumsConfig) {
  const beatSamples = Math.floor((60 / bpm) * SAMPLE_RATE);
  const totalBeats = prog.reduce((acc, p) => acc + p.beats, 0);
  const totalSamples = prog.reduce((acc, p) => acc + p.beats * beatSamples, 0);
  const data = new Float32Array(totalSamples);

  let cursor = 0;
  for (const step of prog) {
    const freqs = parseChordSymbol(step.chord);
    if (!freqs) continue;

    const chordSamples = step.beats * beatSamples;
    const phases = freqs.map(() => 0);
    const phaseInc = freqs.map((f) => (2 * Math.PI * f) / SAMPLE_RATE);

    for (let i = 0; i < chordSamples; i += 1) {
      let sample = 0;

      for (let t = 0; t < freqs.length; t += 1) {
        sample += osc(phases[t], wave) * 0.12;
        phases[t] += phaseInc[t];
        if (phases[t] > 2 * Math.PI) phases[t] -= 2 * Math.PI;
      }

      // Enveloping semplice per evitare click tra accordi.
      const attack = Math.floor(SAMPLE_RATE * 0.01);
      const release = Math.floor(SAMPLE_RATE * 0.08);
      const tail = chordSamples - i;
      let env = 0.85;
      if (i < attack) env = i / attack;
      else if (tail < release) env = tail / release;

      data[cursor + i] = Math.max(-1, Math.min(1, sample * env));
    }

    cursor += chordSamples;
  }

  const drums = buildDrumBufferForSequence(totalSamples, bpm, totalBeats, drumsConfig);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = clampUnit(data[i] + drums[i]);
  }

  return data;
}

function floatToWavBuffer(samples) {
  const numChannels = 2;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = SAMPLE_RATE * blockAlign;
  const dataSize = samples.length * blockAlign;

  const buf = Buffer.alloc(44 + dataSize);
  let o = 0;

  buf.write("RIFF", o); o += 4;
  buf.writeUInt32LE(36 + dataSize, o); o += 4;
  buf.write("WAVE", o); o += 4;
  buf.write("fmt ", o); o += 4;
  buf.writeUInt32LE(16, o); o += 4;
  buf.writeUInt16LE(1, o); o += 2;
  buf.writeUInt16LE(numChannels, o); o += 2;
  buf.writeUInt32LE(SAMPLE_RATE, o); o += 4;
  buf.writeUInt32LE(byteRate, o); o += 4;
  buf.writeUInt16LE(blockAlign, o); o += 2;
  buf.writeUInt16LE(bitsPerSample, o); o += 2;
  buf.write("data", o); o += 4;
  buf.writeUInt32LE(dataSize, o); o += 4;

  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const v = s < 0 ? s * 0x8000 : s * 0x7fff;
    buf.writeInt16LE(v, o); o += 2;
    buf.writeInt16LE(v, o); o += 2;
  }

  return buf;
}

function playWav(filePath, loop) {
  if (process.platform === "win32") {
    const escaped = filePath.replace(/'/g, "''");
    const script = loop
      ? `$p = New-Object Media.SoundPlayer '${escaped}'; while ($true) { $p.PlaySync() }`
      : `(New-Object Media.SoundPlayer '${escaped}').PlaySync()`;

    const child = spawn("powershell", ["-NoProfile", "-Command", script], {
      stdio: "inherit"
    });

    return child;
  }

  const candidates = [
    ["afplay", [filePath]],
    ["aplay", [filePath]],
    ["ffplay", ["-nodisp", "-autoexit", filePath]]
  ];

  for (const [cmd, args] of candidates) {
    try {
      const child = spawn(cmd, args, { stdio: "inherit" });
      child.on("error", () => {});
      return child;
    } catch {
      // Prossimo player.
    }
  }

  throw new Error("Nessun player audio disponibile su questo sistema.");
}

async function ask(question, rl) {
  return new Promise((resolve) => {
    rl.question(question, (ans) => resolve(ans.trim()));
  });
}

async function gatherInput(args) {
  if (args.prog) return args;

  const configPresets = loadConfigPresets(args.config);
  const selectedFromConfig = resolvePresetById(configPresets, args.set);
  if (selectedFromConfig) {
    console.log(`Uso preset da config: ${selectedFromConfig.name}`);
    return applyPreset(args, selectedFromConfig);
  }

  const loopPresets = loadLoopFolderPresets();
  const selectedFromLoop = resolvePresetById(loopPresets, args.set);
  if (selectedFromLoop) {
    console.log(`Uso preset da loop: ${selectedFromLoop.name}`);
    return applyPreset(args, selectedFromLoop);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    let preset = null;

    if (configPresets.length > 0) {
      const useConfig = await ask(`Trovato ${args.config}. Vuoi scegliere un preset? (Y/n): `, rl);
      if (!useConfig || useConfig.toLowerCase() === "y") {
        preset = await choosePresetInteractive(rl, configPresets, args.config);
      }
    }

    if (!preset && loopPresets.length > 0) {
      const useLoop = await ask("Vuoi scegliere un file dalla cartella loop? (Y/n): ", rl);
      if (!useLoop || useLoop.toLowerCase() === "y") {
        preset = await choosePresetInteractive(rl, loopPresets, "loop/");
      }
    }

    if (preset) {
      return applyPreset(args, preset);
    }

    if (args.pad) {
      // In pad mode usiamo una progressione di fallback per mappare i tasti accordo.
      args.prog = "Am F C G";
      return args;
    }

    const prog = await ask("Progressione accordi (es: Am F C G): ", rl);
    const bpmIn = await ask(`BPM [${args.bpm}]: `, rl);
    const beatsIn = await ask(`Beat per accordo [${args.beats}]: `, rl);
    const waveIn = await ask(`Wave (sine/square/saw/tri) [${args.wave}]: `, rl);
    const loopIn = await ask("Loop? (y/N): ", rl);

    if (prog) args.prog = prog;
    if (bpmIn) args.bpm = Number(bpmIn);
    if (beatsIn) args.beats = Number(beatsIn);
    if (waveIn) args.wave = waveIn.toLowerCase();
    if (loopIn.toLowerCase() === "y") args.loop = true;
  } finally {
    rl.close();
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    showHelp();
    return;
  }

  await gatherInput(args);

  if (!args.prog) {
    console.error("Errore: devi specificare una progressione con --prog o da prompt.");
    process.exitCode = 1;
    return;
  }

  if (!Number.isFinite(args.bpm) || args.bpm < 40 || args.bpm > 260) {
    console.error("Errore: BPM non valido (range consigliato 40-260).");
    process.exitCode = 1;
    return;
  }

  if (!["sine", "square", "saw", "tri"].includes(args.wave)) {
    console.error("Errore: --wave deve essere sine, square, saw oppure tri.");
    process.exitCode = 1;
    return;
  }

  if (args.pad) {
    await runPadMode(args);
    return;
  }

  const prog = parseProgression(args.prog, args.beats);
  if (prog.length === 0) {
    console.error("Errore: progressione vuota o non valida.");
    process.exitCode = 1;
    return;
  }

  const audio = renderSequence(prog, args.bpm, args.wave, args.drums);
  const wav = floatToWavBuffer(audio);
  const outFile = path.join(os.tmpdir(), "terminal-synt-preview.wav");
  fs.writeFileSync(outFile, wav);

  console.log(`\nProgressione: ${prog.map((p) => `${p.chord}/${p.beats}`).join(" ")}`);
  console.log(`BPM: ${args.bpm} | Wave: ${args.wave} | Loop: ${args.loop ? "on" : "off"}`);
  console.log(`File audio temporaneo: ${outFile}`);
  console.log("Riproduzione in corso... premi Ctrl+C per fermare.\n");

  const child = playWav(outFile, args.loop);

  const stop = () => {
    if (child && !child.killed) child.kill();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  child.on("exit", () => {
    if (!args.loop) process.exit(0);
  });
  child.on("error", (err) => {
    console.error(`Errore player audio: ${err.message}`);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
