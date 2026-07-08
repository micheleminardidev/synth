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
    set: ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--bpm") args.bpm = Number(argv[++i]);
    else if (token === "--beats") args.beats = Number(argv[++i]);
    else if (token === "--wave") args.wave = String(argv[++i] || "").toLowerCase();
    else if (token === "--prog") args.prog = String(argv[++i] || "");
    else if (token === "--config") args.config = String(argv[++i] || "music.json");
    else if (token === "--set") args.set = String(argv[++i] || "");
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

Opzioni:
  --prog   Progressione accordi (separati da spazio o virgola)
           Ogni accordo puo avere durata in beat: Am/2 oppure G:4
  --bpm    BPM (default: ${DEFAULT_BPM})
  --beats  Beat di default per accordo (default: ${DEFAULT_BEATS})
  --wave   Forma d'onda: sine | square | saw | tri
  --config File config JSON (default: music.json)
  --set    Nome preset o indice preset nel file config
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

function normalizePreset(raw, fallbackName) {
  if (!raw || typeof raw !== "object") return null;

  const preset = {
    name: String(raw.name || fallbackName || "preset").trim(),
    prog: String(raw.prog || raw.progression || "").trim(),
    bpm: raw.bpm === undefined ? undefined : Number(raw.bpm),
    beats: raw.beats === undefined ? undefined : Number(raw.beats),
    wave: raw.wave === undefined ? undefined : String(raw.wave).toLowerCase(),
    loop: raw.loop === undefined ? undefined : Boolean(raw.loop)
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

function renderSequence(prog, bpm, wave) {
  const beatSamples = Math.floor((60 / bpm) * SAMPLE_RATE);
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

      // Kick su ogni beat.
      for (let b = 0; b < step.beats; b += 1) {
        const from = b * beatSamples;
        const dt = (i - from) / SAMPLE_RATE;
        if (dt >= 0 && dt < 0.2) {
          const f = 90 - 55 * dt;
          sample += Math.sin(2 * Math.PI * f * dt) * Math.exp(-18 * dt) * 0.85;
        }

        // Hi-hat in levare.
        const fromHat = from + Math.floor(beatSamples / 2);
        const dth = (i - fromHat) / SAMPLE_RATE;
        if (dth >= 0 && dth < 0.05) {
          sample += (Math.random() * 2 - 1) * Math.exp(-85 * dth) * 0.14;
        }

        // Snare su 2 e 4.
        if (b % 4 === 1 || b % 4 === 3) {
          const dts = (i - from) / SAMPLE_RATE;
          if (dts >= 0 && dts < 0.12) {
            sample += (Math.random() * 2 - 1) * Math.exp(-30 * dts) * 0.2;
          }
        }
      }

      data[cursor + i] = Math.max(-1, Math.min(1, sample * env));
    }

    cursor += chordSamples;
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

  const prog = parseProgression(args.prog, args.beats);
  if (prog.length === 0) {
    console.error("Errore: progressione vuota o non valida.");
    process.exitCode = 1;
    return;
  }

  const audio = renderSequence(prog, args.bpm, args.wave);
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
