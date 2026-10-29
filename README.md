# Foundry Local New Home Layout Demo

A stage-ready Windows prototype for a 15-minute Microsoft Ignite level-300 demo. A local model
interprets multi-turn furniture requirements, proposes a runtime-constrained structured invocation,
and the Electron application validates and executes deterministic geometry before rendering a 2D
room plan.

![Stage UI](docs/screenshots/stage-ui.png)

## What is real

- **Inference:** `foundry-local-sdk@2.2.1`, in-process through `ChatSession`.
- **Default model target:** exact catalog ID `qwen3-0.6b-generic-gpu:2`.
- **Execution provider:** `WebGPUExecutionProvider`, registered from the Foundry Local
  `webgpu-ep-0.2.1-win-x64` bundle.
- **Default live speech-to-text:** exact catalog ID
  `nemotron-speech-streaming-en-0.6b-generic-cpu:3` through native v2.2.1 `AudioSession`,
  PCM `ItemQueue`, `CPUExecutionProvider`, English only.
- **Bounded live PCM path:** after an explicit button click and permission grant, an
  `AudioWorklet` captures microphone frames, the renderer resamples them to PCM16LE/16 kHz/mono,
  and a typed `ipcRenderer.invoke` pump preserves chunk order with an eight-chunk bound. Main
  validates stream identity, sequence, chunk size, total bytes, and native queue capacity before
  pushing each copied `Item.bytes(...)` frame.
- **Main-owned stream lifecycle:** main captures the initiating `webContents`, frame, ownership
  session, and stream ID. Navigation, reload, renderer loss, frame/webContents destruction, or
  window close revokes that owner and cancels the stream; partials can only return to the captured
  frame and never a replacement renderer.
- **Explicit fallback:** exact `openai-whisper-tiny-generic-cpu:4` is available only through the
  visibly labeled **Whisper Tiny fallback (record then transcribe)** action. The stage default
  remains Nemotron; the fallback loads only after that explicit user choice and never activates
  silently.
- **Transcript review:** speech text is placed into the editable Manual prompt. It is never
  auto-submitted and never bypasses the existing structured planning/tool pipeline. On Send, the
  display transitions from `Live draft — not sent` to the exact edited submitted prompt.
- **Structured planning:** Foundry Local runtime-enforced JSON Schema output contains only a compact
  semantic intent delta (`bed`, `desk`, `crib`, `changedPreference`, and clarification). Every
  supported compact intent value remains available in the runtime schema; application code validates
  the model choice against explicit wording and accepted state, including directional replacements,
  scoped negation, ambiguity, and fail-closed unsupported furniture. Clearly negated replacements
  preserve the accepted item; ambiguous multi-action negation requires clarification and preserves
  every slot. Action-object extraction distinguishes unsupported variants such as California King
  and twin beds from the supported regular King, without treating clearance prose as furniture. The
  app then derives exact catalog IDs, retained state, versions, units, locked constraints, and
  clarification evidence before invoking `compare_layout_options`. Length-truncated or otherwise
  partial JSON is rejected and never executed.
- **Geometry:** application-owned room bounds, door swing, reserved-zone overlap, furniture
  collision, and 250 mm furniture-clearance checks.
- **Rendering:** Electron renderer with an SVG room plan and an inspectable structured trace.
- **Failure evidence:** one rejected preview is always rendered with checks and conflicts from that
  same option. Cross-option rejection reasons are separate in the typed result and developer trace.

There is no cloud inference or speech endpoint, OS online speech service, CLI subprocess,
image-generation pipeline, hidden canned model response, TTS, or success-shaped fallback.

## Layout model decision

The previous full `CompareLayoutOptionsInput` contract made Qwen2.5 1.5B generate roughly
650–730 bytes and 198–223 output tokens per attempt, while copying application-owned state. The
five-turn baseline took 23.955–38.893 seconds and four turns needed a correction attempt.

The corrected compact contract keeps all semantic enums available and emits accepted JSON of roughly
143–205 bytes while application code derives the unchanged full tool input and enforces stale state,
retained state, unsupported furniture, transition direction, scoped negation, ambiguity, and
invented-ID protections. Exact `qwen3-0.6b-generic-gpu:2` passed all 16 fixed-gate scenarios,
including negated bed/desk transitions and unsupported California King, twin-bed, and moon-pod
requests. It loaded in 3.608 seconds and measured 6.022 seconds warm median / 9.944 seconds warm
maximum. Other candidates were not rerun for this final semantic gate.

## Audio model decision

Nemotron English streaming is the stage default because the UI now uses its actual advantage:
revising local captions while the user is still speaking. The same deterministic 5.53-second phrase
produced 31 display revisions, first text at **1.303 s**, and the final aggregate transcript **100 ms**
after input ended. Cached model preparation took **3.100 s** on the validated machine. The exact
model is 696 MB on CPU/`CPUExecutionProvider`.

Whisper Tiny remains the explicit smaller fallback: 131 MB on CPU, **1.807 s** cached preparation,
and **211 ms** record-then-transcribe time for the same phrase. It does not emit live subtitles.
Choosing it requires the labeled fallback action; no error path rewrites the model selection.

The live subtitle stream is display-only evidence. On **Stop**, the app waits for Nemotron's final
`SpeechResult`, places only that final transcript into the editable Manual prompt, and stops. The
user must click **Send** before Qwen receives text. Qwen's layout plan is a separate complete,
JSON-Schema-constrained response that must finish normally and pass application validation before
geometry can run.

The similarly named `nemotron-3.5-asr-streaming-0.6b-generic-cpu:3` model was not selected or
downloaded. This demo makes no multilingual or Chinese claim. There is no TTS, cloud speech service,
or external inference endpoint.

## Important implementation decision

The pinned v2.2.1 native `ToolCallItem` path was tested first. The cached small models either
truncated/rejected the call, emitted parallel duplicate calls, or dropped a required multi-turn
constraint. The app therefore uses the escalation path agreed for this demo:

1. `ChatSession` performs real local multi-turn inference.
2. Foundry Local applies a compact intent-delta JSON Schema grammar to the model output.
3. The app validates prompt intent and derives IDs, units, versions, state, retained furniture,
   clarification evidence, and locked constraints.
4. The app validates and invokes the full deterministic layout tool input.
5. The visible response is labeled **Application evidence** and is rendered from the typed tool
   result. Optional free-form model summarization is intentionally disabled because it contradicted
   correct geometry during validation.

This mode is shown in the developer trace as
`Runtime-guided intent-delta JSON schema -> app-derived tool invocation`; it is not presented as a
native function-call marker.

## Install and run

Prerequisites:

- Windows x64 or Arm64, Linux x64 or Arm64, or Apple-silicon macOS supported by Foundry Local
  v2.2.1. Only Windows x64 was validated here.
- Node.js 20 or newer. The validated machine used Node `26.13.0`.
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
3. Select **Prepare Nemotron live**. The separate badge shows the exact
   `nemotron-speech-streaming-en-0.6b-generic-cpu:3` ID and **LIVE** mode.
4. Select **Start recording** and speak for at most 20 seconds. The **Live draft — not sent** panel
   revises while speech is arriving and the timer remains visible.
5. Select **Stop**. The final aggregate transcript is placed into **Manual prompt**.
6. Review or edit the transcript, then select **Send**. Stop never submits automatically; Send
   changes the draft label to submitted/processing and shows the exact edited prompt.
7. If Nemotron deterministically fails, the UI exposes
   **Whisper Tiny fallback (record then transcribe)**. Selecting it is an explicit model switch;
   record again, wait for the final Whisper transcript, then review and click **Send**.
8. Existing typed and scripted controls remain available as the stage fallback.
9. Open **Developer trace** to distinguish the display-only ASR stream/final transcript from the
   complete layout-model plan, validation, and geometry evidence.

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
npm run benchmark:layout
npm run typecheck
npm run lint
npm test
Remove-Item Env:FOUNDRY_MODEL_ALIAS -ErrorAction SilentlyContinue
Remove-Item Env:FOUNDRY_MODEL_ID -ErrorAction SilentlyContinue
Remove-Item Env:FOUNDRY_EXECUTION_PROVIDER -ErrorAction SilentlyContinue
npm run test:integration
npm run test:nemotron-integration
npm run test:audio-integration
npm run build
npm run smoke:electron
npm run probe:stream-owner
npm run probe:microphone-permission
npm run capture:ui
```

`npm run test:integration` performs five real local turns:

1. Queen + standard desk: feasible.
2. King replaces Queen while retaining desk: closet conflict.
3. Keep Queen, add crib, revise to compact desk: feasible.
4. King + compact desk + crib: no bounded feasible option.
5. Adversarial correction: do not use King, remove crib, retain Queen + compact desk.

`npm run test:nemotron-integration` loads exact Nemotron, streams deterministic PCM in ordered
100 ms chunks, requires multiple changing partials, captures first-partial and stop-to-final timing,
checks the exact CPU model identity, and verifies the final transcript with no external endpoint.

`npm run test:audio-integration` explicitly selects Whisper Tiny, transcribes
`tests/fixtures/queen-desk.wav`, requires at least 85% key-word recall, asserts no external endpoint,
and proves no temporary capture file remains. The validated transcript was exact:

> Can a queen size bed and a desk fit here without blocking the closet or the door?

The corrected October 29 selected-default integration completed eleven real Qwen turns—including
affirmative and negated transitions plus unsupported variants—in **4.630–11.163 s**. The
unrestricted-schema benchmark measured **6.022 s median / 9.944 s max** for exact
`qwen3-0.6b-generic-gpu:2`; every one of its 16 semantic scenarios passed. The legacy full-input
Qwen2.5 path measured **23.955–38.893 s**.

Evidence is written to ignored local files under `artifacts/`. The committed validation summary is
in [VALIDATION.md](VALIDATION.md).

`smoke:electron` launches the actual Electron app and exits after SDK/catalog initialization.
`probe:stream-owner` reloads and closes a real Electron renderer while a bounded probe stream is
owned, requires both cancellations, rejects stale partial routing, and fails on uncaught exceptions
or unhandled rejections.
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
| Node / npm | `26.13.0` / `11.20.0` |
| Electron | `42.3.3` |
| SDK | `foundry-local-sdk@2.2.1` |
| Runtime observed | ONNX Runtime `1.31.0`, ORT GenAI `0.18.0` |

## Offline readiness

The app uses separate text and audio readiness. Default live voice input is shown as fully ready only
when:

- exact layout model `qwen3-0.6b-generic-gpu:2` and WebGPU EP are ready;
- exact ASR model `nemotron-speech-streaming-en-0.6b-generic-cpu:3` is cached and loaded on CPU;
- no external inference endpoint is configured or started.

Prepare the layout model, Nemotron, and optionally the explicit Whisper Tiny fallback while connected
before the adapter-disconnect rehearsal. The manager sets
`disableNonessentialTelemetry: true`. Foundry Local documents that a minimal
`ProcessInfo` telemetry event may still be attempted. Prepare the model and EP while connected, then
follow the manual adapter-disconnect rehearsal in [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md). Development
did not globally disable the machine network.

## Project map

| Path | Purpose |
|---|---|
| `src/foundry/foundry-service.ts` | SDK lifecycle, model selection, schema-guided multi-turn planning |
| `src/audio/audio-contract.ts` | PCM IPC bounds, partial replacement, final transcript draft, WAV encoding |
| `src/audio/temp-audio-store.ts` | owned temporary WAV creation, retryable cleanup, and startup orphan recovery |
| `src/renderer/audio-capture.ts` | AudioWorklet capture, streaming resampling, ordered bounded chunk pump |
| `src/domain/tool-contract.ts` | strict schema, stale-state checks, explicit intent/retention guards |
| `src/domain/layout-engine.ts` | bounded option enumeration and typed tool result |
| `src/domain/geometry.ts` | deterministic collision, boundary, door-swing, and clearance checks |
| `src/domain/fixture.ts` | verified demo room, catalog dimensions, and known options |
| `src/renderer/renderer.ts` | stage UI, SVG layout, evidence cards, developer trace |
| `scripts/run-foundry-integration.ts` | real-model staged and adversarial acceptance |
| `scripts/run-layout-model-benchmarks.mjs` | isolated exact-candidate latency and quality suite |
| `scripts/run-nemotron-integration.ts` | real Nemotron partial/final streaming and timing acceptance |
| `scripts/run-audio-integration.ts` | explicit Whisper Tiny fallback and cleanup acceptance |
| `tests/` | geometry, schema, state, fixture, and semantic tests |

See [ARCHITECTURE.md](ARCHITECTURE.md), [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md), and
[CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md).

## Scope and limitations

- Footprint and clearance planning only.
- Not infant-safety advice, structural review, accessibility certification, or global optimization.
- Exact measurements are fixture data; images are never used to infer dimensions.
- Bounded known options are evaluated; the engine does not search arbitrary placements.
- Audio is English only. Nemotron provides display-only live captions; Whisper Tiny is an explicit
  record-then-transcribe fallback. There is no Chinese/multilingual claim or TTS.
- The committed deterministic WAV validates ASR, not real microphone permission or human speech.
- Windows was validated. Apple-silicon macOS remains a documented validation blocker.
