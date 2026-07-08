# Terminal Synt (Node.js)

Mini sequencer da terminale: scrivi una progressione di accordi, imposti BPM e ascolti subito il beat synth.

## Avvio rapido

```bash
npm start -- --prog "Am F C G" --bpm 120 --beats 4 --wave saw
```

Usa un preset dal file `music.json`:

```bash
npm start -- --set chill1
```

Oppure per indice preset:

```bash
npm start -- --set 2
```

Oppure apri la modalita interattiva:

```bash
npm start
```

## Esempi

```bash
npm start -- --prog "Dm/2 G/2 Cmaj7/4" --bpm 100 --wave tri
npm start -- --prog "Am F C G" --loop
npm start -- --pad --bpm 124 --bars 4 --set drive
```

## Parametri

- `--prog` progressione accordi (spazio o virgola)
- `--bpm` tempo
- `--beats` beat di default per accordo
- `--wave` `sine | square | saw | tri`
- `--config` file JSON preset (default `music.json`)
- `--set` nome o indice preset
- `--pad` registrazione live da tastiera (drum + accordi)
- `--bars` battute per il loop in modalita pad (default `2`)
- `--loop` ripetizione continua

Durata per singolo accordo:
- `Am/2` oppure `G:4`

## Note

- Su Windows usa PowerShell con `Media.SoundPlayer` per riprodurre un file WAV temporaneo.
- L'audio viene generato in modo procedurale (accordi + kick/hat/snare sintetici).
- In modalita interattiva, se trova `music.json` o file JSON in `loop/`, ti chiede quale preset riprodurre.

## Formato music.json

```json
{
	"sets": [
		{
			"name": "chill1",
			"prog": "Am F C G",
			"bpm": 110,
			"beats": 4,
			"wave": "saw",
			"loop": false,
			"drums": {
				"stepsPerBeat": 4,
				"kick": "x...x...x...x...",
				"snare": "....x.......x...",
				"hat": "x.x.x.x.x.x.x.x.",
				"clap": "................"
			}
		}
	]
}
```

Puoi anche usare un singolo oggetto JSON dentro `loop/*.json` con gli stessi campi.

Pattern drum:
- `x` (oppure `1`, `*`, `o`) = hit
- `.` = pausa
- la stringa viene ripetuta in loop per tutta la progressione

## Modalita pad

Flusso:
- Registra prima la base drum da tastiera
- Poi registra gli accordi sulla stessa durata
- Il risultato viene renderizzato e mandato in loop
- decidi tu quando chiudere la registrazione drum premendo `Invio`

Comando:

```bash
npm start -- --pad --bpm 120 --bars 2 --set chill1
```

Controlli registrazione drum:
- `z` kick
- `x` snare
- `c` hi-hat
- `v` clap

Controlli registrazione accordi:
- tasti `a s d f g h j k l`
- mappati automaticamente sugli accordi unici della progressione/preset corrente
- se non c'e una progressione: fallback `Am F C G`

Note pad:
- la lunghezza loop viene presa dalla durata della Drum REC (stop manuale con `Invio`)
- Chord REC usa la stessa lunghezza loop (puoi fermare prima con `Invio`)
- durante la registrazione ogni hit stampa un punto `.`
- durante la registrazione senti una preview audio immediata ad ogni tasto
- playback finale sempre in loop, stop con `Ctrl+C`
