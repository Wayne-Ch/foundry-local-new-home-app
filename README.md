# Foundry Local New Home Layout Demo

A stage-ready Windows prototype for a 15-minute Microsoft Ignite level-300 demo. A local model
interprets multi-turn furniture requirements, proposes a runtime-constrained structured invocation,
and the Electron application validates and executes deterministic geometry before rendering a 2D
room plan.

![Stage UI](docs/screenshots/stage-ui.png)

## What is real

- **Inference:** `foundry-local-sdk@2.2.1`, in-process through `ChatSession`.
- **Default model target:** exact catalog ID `qwen2.5-1.5b-instruct-generic-gpu:4`.
- **Execution provider:** `WebGPUExecutionProvider`, registered from the Foundry Local
  `webgpu-ep-0.2.1-win-x64` bundle.
- **Local speech-to-text:** exact catalog ID `openai-whisper-tiny-generic-cpu:4` through native
  `AudioSession`, `CPUExecutionProvider`, English only.
- **Push-to-talk boundary:** the renderer records only after a button click and permission grant,
  resamples to bounded PCM16LE/16 kHz/mono, and sends it through typed IPC. Main writes a temporary
  WAV because v2.2.1 rejects one-shot inline audio, transcribes locally, and deletes the file in
  every path.
- **Transcript review:** speech text is placed into the editable Manual prompt. It is never
  auto-submitted and never bypasses the existing structured planning/tool pipeline.
- **Structured planning:** Foundry Local runtime-enforced JSON Schema output. The application then
  invokes `compare_layout_options` with the validated object.
- **Geometry:** application-owned room bounds, door swing, reserved-zone overlap, furniture
  collision, and 250 mm furniture-clearance checks.
- **Rendering:** Electron renderer with an SVG room plan and an inspectable structured trace.
- **Failure evidence:** one rejected preview is always rendered with checks and conflicts from that
  same option. Cross-option rejection reasons are separate in the typed result and developer trace.

There is no cloud inference or speech endpoint, OS online speech service, CLI subprocess,
image-generation pipeline, hidden canned model response, TTS, or success-shaped fallback.

## Audio model decision

The app implements **record then transcribe**, not live streaming. Three cached/prepared English
candidates were measured with the same deterministic 5.53-second stage phrase:

| Candidate | Size | Path | Load | Transcription |
|---|---:|---|---:|---:|
| Whisper Tiny CPU | 131 MB | temporary WAV URI | 1.14 s | 0.17–0.28 s |
| Whisper Base CPU | 205 MB | temporary WAV URI | 1.44 s | 0.36–0.43 s |
| Nemotron Speech Streaming EN CPU | 696 MB | PCM `ItemQueue` | 2.70 s | 0.93–0.97 s buffered |

Nemotron was also measured in true real-time streaming mode: first text at 1.29 s and final output
189 ms after input ended. That is valuable for live partial captions, but this UI intentionally waits
for **Stop & transcribe** and inserts one editable draft. Whisper Tiny and Nemotron had comparable
stop-to-final latency in the measured paths. Whisper Tiny was selected because it was already cached,
had a much smaller offline footprint, was faster in the buffered record-then-transcribe benchmark,
and this UI does not use partial streaming. The authorized 696 MB Nemotron benchmark download was
removed after measurement.

The v2.2.1 catalog also exposed `nemotron-3.5-asr-streaming-0.6b-generic-cpu:3` at 756 MB. It was
uncached and was not downloaded because multilingual/Chinese input is optional for this milestone.
No Chinese capability is claimed.

## Important implementation decision

The pinned v2.2.1 native `ToolCallItem` path was tested first. The cached small models either
truncated/rejected the call, emitted parallel duplicate calls, or dropped a required multi-turn
constraint. The app therefore uses the escalation path agreed for this demo:

1. `ChatSession` performs real local multi-turn inference.
2. Foundry Local applies a JSON Schema grammar to the model output.
3. The app validates IDs, units, versions, state, retained furniture, and explicit corrections.
4. The app invokes the deterministic layout tool.
5. The visible response is labeled **Application evidence** and is rendered from the typed tool
   result. Optional free-form model summarization is intentionally disabled because it contradicted
   correct geometry during validation.

This mode is shown in the developer trace as
`Runtime-guided JSON schema -> app tool invocation`; it is not presented as a native function-call
marker.

## Install and run

Prerequisites:

- Windows x64 or Arm64, Linux x64 or Arm64, or Apple-silicon macOS supported by Foundry Local
  v2.2.1. Only Windows x64 was validated here.
- Node.js 20 or newer. The validated machine used Node `24.22.1`.
- npm with install scripts approved for `foundry-local-sdk` and `esbuild`.
- Network access for the first exact-model/EP preparation, unless both are already cached and
  registered.

```powershell
npm install --no-audit --no-fund
npm install-scripts approve esbuild foundry-local-sdk
npm rebuild esbuild foundry-local-sdk
npm run build
npm run start:built
```

In the app:

1. Select **Load local model**.
2. Wait for the green local-runtime badge. The app turns ready only after the exact configured model
   and configured EP are loaded and registered.
3. Select **Prepare microphone**. The separate voice badge becomes ready only when both the layout
   model and Whisper Tiny are loaded.
4. Select **Start recording**, speak for at most 20 seconds, then select **Stop & transcribe**.
5. Review or edit the transcript in **Manual prompt**, then select **Send**. Recording never submits
   automatically.
6. Existing typed and scripted controls remain available as the stage fallback.
7. Open **Developer trace** to distinguish the ASR model/transcript from the layout model plan,
   validation, and geometry evidence.

The validated stage configuration needs no model environment variable. `prepareOffline` resolves the
exact default from the public catalog and can download it into an empty cache.

An alternate runtime requires both exact override variables:

```powershell
$env:FOUNDRY_MODEL_ID = "alternate-exact-model-id:version"
$env:FOUNDRY_EXECUTION_PROVIDER = "CPUExecutionProvider"
npm run start:built
```

The UI and trace label an alternate target as **Override (not stage-validated)**. An override may be
locally ready, but it is never presented as the validated Ignite configuration.
`FOUNDRY_MODEL_ALIAS` is intentionally rejected because an alias can resolve to multiple variants.
Incomplete or rejected overrides are shown as **Invalid environment override** and stop before any
catalog lookup or default-model load; the app never silently falls back to the built-in target.
Use `FOUNDRY_MODEL_CACHE_DIR` only to override the shared cache directory.

## Verification commands

```powershell
npm run probe:foundry
npm run typecheck
npm run lint
npm test
Remove-Item Env:FOUNDRY_MODEL_ALIAS -ErrorAction SilentlyContinue
Remove-Item Env:FOUNDRY_MODEL_ID -ErrorAction SilentlyContinue
Remove-Item Env:FOUNDRY_EXECUTION_PROVIDER -ErrorAction SilentlyContinue
npm run test:integration
npm run test:audio-integration
npm run build
npm run smoke:electron
npm run capture:ui
```

`npm run test:integration` performs five real local turns:

1. Queen + standard desk: feasible.
2. King replaces Queen while retaining desk: closet conflict.
3. Keep Queen, add crib, revise to compact desk: feasible.
4. King + compact desk + crib: no bounded feasible option.
5. Adversarial correction: do not use King, remove crib, retain Queen + compact desk.

`npm run test:audio-integration` loads exact Whisper Tiny, transcribes
`tests/fixtures/queen-desk.wav`, requires at least 85% key-word recall, asserts no external endpoint,
and proves no temporary capture file remains. The validated transcript was exact:

> Can a queen size bed and a desk fit here without blocking the closet or the door?

Evidence is written to ignored local files under `artifacts/`. The committed validation summary is
in [VALIDATION.md](VALIDATION.md).

`smoke:electron` launches the actual Electron app and exits after SDK/catalog initialization.
`capture:ui` captures an explicitly labeled browser-only visual preview because Electron
`webContents.capturePage()` returns `UnknownVizError` in this execution environment.

## Verified public grounding

- [Foundry Local v2.2.1 release](https://github.com/microsoft/Foundry-Local/releases/tag/v2.2.1)
- [Pinned v2.2.1 README](https://github.com/microsoft/Foundry-Local/blob/v2.2.1/README.md)
- [Pinned native chat sample](https://github.com/microsoft/Foundry-Local/blob/v2.2.1/samples/js/native-chat-completions/app.js)
- [Pinned tool-calling tutorial](https://github.com/microsoft/Foundry-Local/blob/v2.2.1/samples/js/tutorial-tool-calling/app.js)
- [Pinned Electron sample](https://github.com/microsoft/Foundry-Local/tree/v2.2.1/samples/js/electron-chat-application)
- [Pinned audio transcription sample](https://github.com/microsoft/Foundry-Local/tree/v2.2.1/samples/js/audio-transcription-example)
- [Pinned live audio sample](https://github.com/microsoft/Foundry-Local/tree/v2.2.1/samples/js/live-audio-transcription)
- [Pinned chat + audio sample](https://github.com/microsoft/Foundry-Local/tree/v2.2.1/samples/js/chat-and-audio-foundry-local)
- [Pinned v2 inference guide](https://github.com/microsoft/Foundry-Local/blob/v2.2.1/sdk_v2/INFERENCING.md)

As verified on October 28, 2026:

- Latest SDK/runtime package: `foundry-local-sdk@2.2.1`, Node `>=20`.
- Latest public CLI release: `0.12.1 Preview`.
- The validation machine still had CLI `0.11.0`; this app does not invoke or depend on the CLI.
- Public v2.2.1 platforms: Windows, Linux, and Apple-silicon macOS.

## Validated Windows machine

| Item | Value |
|---|---|
| OS | Windows 11 Enterprise, build `10.0.26300`, x64 |
| Device | HP EliteBook 8 G1a 16-inch Notebook Next Gen AI PC |
| CPU/NPU | AMD Ryzen AI 7 PRO 350, 8 cores / 16 logical processors |
| GPU | AMD Radeon 860M |
| Memory | 64 GB installed |
| Node / npm | `24.22.2` / `11.19.1` |
| Electron | `42.3.3` |
| SDK | `foundry-local-sdk@2.2.1` |
| Runtime observed | ONNX Runtime `1.31.0`, ORT GenAI `0.18.0` |

## Offline readiness

The app uses separate text and audio readiness. Voice input is shown as fully ready only when:

- exact layout model `qwen2.5-1.5b-instruct-generic-gpu:4` and WebGPU EP are ready;
- exact ASR model `openai-whisper-tiny-generic-cpu:4` is cached and loaded on CPU;
- no external inference endpoint is configured or started.

Prepare both models while connected before the adapter-disconnect rehearsal. The manager sets
`disableNonessentialTelemetry: true`. Foundry Local documents that a minimal
`ProcessInfo` telemetry event may still be attempted. Prepare the model and EP while connected, then
follow the manual adapter-disconnect rehearsal in [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md). Development
did not globally disable the machine network.

## Project map

| Path | Purpose |
|---|---|
| `src/foundry/foundry-service.ts` | SDK lifecycle, model selection, schema-guided multi-turn planning |
| `src/audio/audio-contract.ts` | PCM IPC bounds, WAV encoding, recorder state, editable transcript draft |
| `src/audio/temp-audio-store.ts` | tracked temporary WAV creation and deletion |
| `src/renderer/audio-capture.ts` | explicit mic capture, decode, downmix, and 16 kHz PCM resampling |
| `src/domain/tool-contract.ts` | strict schema, stale-state checks, explicit intent/retention guards |
| `src/domain/layout-engine.ts` | bounded option enumeration and typed tool result |
| `src/domain/geometry.ts` | deterministic collision, boundary, door-swing, and clearance checks |
| `src/domain/fixture.ts` | verified demo room, catalog dimensions, and known options |
| `src/renderer/renderer.ts` | stage UI, SVG layout, evidence cards, developer trace |
| `scripts/run-foundry-integration.ts` | real-model staged and adversarial acceptance |
| `scripts/run-audio-integration.ts` | real Whisper Tiny transcription and cleanup acceptance |
| `tests/` | geometry, schema, state, fixture, and semantic tests |

See [ARCHITECTURE.md](ARCHITECTURE.md), [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md), and
[CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md).

## Scope and limitations

- Footprint and clearance planning only.
- Not infant-safety advice, structural review, accessibility certification, or global optimization.
- Exact measurements are fixture data; images are never used to infer dimensions.
- Bounded known options are evaluated; the engine does not search arbitrary placements.
- Audio is English record-then-transcribe only; no live captions, Chinese claim, or TTS.
- The committed deterministic WAV validates ASR, not real microphone permission or human speech.
- Windows was validated. Apple-silicon macOS remains a documented validation blocker.
