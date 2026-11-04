# Enhanced New Home App

Enhanced New Home App extends
[New Home App](https://github.com/Wayne-Ch/foundry-local-new-home-app/tree/main) with an exact sample
floor-plan workflow, local vision analysis, imported-room planning, direct furniture adjustment,
and optional local speech input. All model inference runs through Foundry Local in the Electron
application; deterministic application code owns measurements, placement checks, and fit results.

![Enhanced New Home App](docs/screenshots/stage-ui.png)

Use [DEMO-GUIDE.md](DEMO-GUIDE.md) for the complete manual test and presentation flow.

## What it does

- Starts with no active room.
- Loads the packaged floor-plan fixture as a preview, then analyzes its visible room topology with a
  local VLM before activating imported geometry.
- Provides an explicit **Use default room** path that remains separate from floor-plan analysis.
- Runs the guided `A -> B -> C -> D -> E` layout story with accepted and rejected options.
- Preserves the accepted layout when a later request has no feasible option.
- Lets users adjust accepted furniture on a `50 mm` grid with pointer or keyboard input.
- Accepts typed prompts or reviewed local speech transcripts.
- Returns to the no-room state through **Reset**.

## Requirements

- Windows 11 x64
- Git for Windows
- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported
- npm `>=11.18.0`, required for `npm install-scripts`
- Internet access for installation and first model/runtime preparation
- Several GB of free disk space for dependencies and model assets
- A WebGPU-capable graphics adapter with a current driver for the layout model
- A microphone only for voice-path testing; typed and scripted flows work without one

Known-good toolchain versions are Node `26.13.0` and npm `11.20.0`. The floor-plan VLM runs on
`CPUExecutionProvider`.

## Quick start

Open PowerShell in the parent folder where the checkout should be created:

```powershell
node --version
npm --version
git clone --branch enhanced-new-home-app --single-branch https://github.com/Wayne-Ch/foundry-local-new-home-app.git enhanced-new-home-app
Set-Location -LiteralPath '.\enhanced-new-home-app'
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run build
npm run start:built
```

First preparation downloads local model and execution-provider assets. Stay online and keep the app
open until the selected setup operation finishes. Later layout and speech turns can run from the
local cache.

### Layout-model setup controls

| Setup state | Visible control | Action |
|---|---|---|
| Cold, empty shared model cache | **Prepare offline** | Select it while online and wait for preparation to finish. |
| Warm shared cache with a fresh product root | **Load local model** | Select it to load the cached model for this app. |
| Model cached; product-specific WebGPU provider registration still needed | **Load local model** | Select it; provider registration does not change the label. |
| Loaded READY state | **Local model ready** | Continue when the green ready state is visible. |

After the layout model is ready, either:

1. Select **Load sample floor plan**, confirm the preview-only state, and select **Analyze layout**;
   or
2. Select **Use default room** to activate the built-in bedroom directly.

## Key behavior

- **Floor-plan fixture:** The app accepts only
  [`public/assets/floor-plan/sample-master-bedroom.png`](public/assets/floor-plan/sample-master-bedroom.png)
  or a renamed byte-for-byte copy. Modified, re-encoded, or arbitrary images are rejected.
- **Imported room:** The VLM identifies a rectangular room, printed room label, door opening, and
  window opening. The application applies the documented `3650 x 3950 mm` scale and canonical
  door, window, closet, and clearance geometry.
- **Accepted and rejected layouts:** A and C produce accepted layouts. B and E open their rejected
  options while keeping the previous accepted layout available through **Show accepted layout**.
  **Inspect rejected option** returns to the same rejected result without starting another turn.
- **Manual adjustment:** D uses direct manipulation only. A valid **Apply** creates a new accepted
  application layout version; **Revert** discards the current preview.
- **Speech input:** Nemotron live speech displays partial text as a draft. **Stop** places the final
  transcript in **Manual prompt** without submitting it. Suggestions require explicit action, and
  **Send** remains separate.
- **Reset:** **Reset** clears the active room, prompt, transcript, layout, preview, and manual
  adjustment state and returns to **Choose a room to begin**.

## Runtime and architecture

- `foundry-local-sdk@2.2.1` runs in process; the app does not start a cloud, loopback, or CLI
  inference endpoint.
- The layout target is `qwen3-0.6b-generic-gpu:2` on `WebGPUExecutionProvider`.
- The optional floor-plan VLM is `qwen3.5-0.8b-generic-cpu:3` on
  `CPUExecutionProvider`.
- The live English speech model is
  `nemotron-speech-streaming-en-0.6b-generic-cpu:3`.
- **Use Whisper Tiny fallback (record then transcribe)** explicitly selects
  `openai-whisper-tiny-generic-cpu:4`.
- Models produce bounded semantic or topology output. Application code derives catalog IDs, state,
  dimensions, placements, checks, and final layout results.

## Development checks

Run the checks relevant to your change:

```powershell
npm run typecheck
npm run lint
npm run check:release-contract
npm test
npm run build
```

## Limitations

- The documented setup is Windows 11 x64. macOS packaging, model selection, rendering, and
  performance are untested.
- Floor-plan import supports only the exact packaged fixture or a byte-identical renamed copy. It is
  not general floor-plan or CAD ingestion.
- The layout engine evaluates bounded known options rather than arbitrary global optimization.
- Audio input is English only. Multilingual ASR, TTS, and online speech services are not supported.
- The app plans furniture footprints and clearances. It does not provide structural,
  accessibility-certification, clinical, or infant-safety advice.

## Documentation

- [Demo and test guide](DEMO-GUIDE.md)
- [Sample floor-plan provenance and derivation](docs/asset-provenance/sample-master-bedroom.md)
