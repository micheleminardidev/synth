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
```

## Parametri

- `--prog` progressione accordi (spazio o virgola)
- `--bpm` tempo
- `--beats` beat di default per accordo
- `--wave` `sine | square | saw | tri`
- `--config` file JSON preset (default `music.json`)
- `--set` nome o indice preset
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
			"loop": false
		}
	]
}
```

Puoi anche usare un singolo oggetto JSON dentro `loop/*.json` con gli stessi campi.
