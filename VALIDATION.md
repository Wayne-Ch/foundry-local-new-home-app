# Validation record

**Date:** October 28, 2026

**Platform:** Windows 11 Enterprise x64, build `10.0.26300`

**Device:** HP EliteBook 8 G1a, AMD Ryzen AI 7 PRO 350, Radeon 860M, 64 GB RAM

## Selected runtime

| Item | Validated value |
|---|---|
| SDK | `foundry-local-sdk@2.2.1` |
| Node | `24.22.2` |
| Electron | `42.3.3` |
| Model alias | `qwen2.5-1.5b` |
| Exact model ID | `qwen2.5-1.5b-instruct-generic-gpu:4` |
| Target source | Built-in stage default; no model alias fallback |
| Model cache size | 1,546 MB |
| Device | GPU |
| Execution provider | `WebGPUExecutionProvider` |
| EP bundle | `webgpu-ep-0.2.1-win-x64` |
| Inference endpoint | none |
| Planning mode | runtime JSON Schema -> app tool invocation |
| Visible response | application-rendered typed evidence |
| Audio model alias | `whisper-tiny` |
| Exact audio model ID | `openai-whisper-tiny-generic-cpu:4` |
| Audio model size | 131 MB |
| Audio device / EP | CPU / `CPUExecutionProvider` |
| Audio language | English |
| Audio path | record -> PCM16LE 16 kHz mono -> temp WAV URI -> native `AudioSession` |
| Audio submission policy | editable draft; never auto-submit |

Qwen2.5 1.5B was the smallest cached model that passed the entire staged and adversarial acceptance.
Qwen3 1.7B is smaller (1,421 MB) but failed the crib correction after three bounded attempts.

## Commands run

```powershell
npm install --no-audit --no-fund
npm install-scripts approve esbuild foundry-local-sdk
npm rebuild esbuild foundry-local-sdk
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
npm run probe:microphone-permission
npm run capture:ui
```

## Results

| Check | Result |
|---|---|
| TypeScript | Pass |
| Biome lint/format | Pass |
| Unit tests | 80/80 pass |
| Electron/Vite build | Pass |
| Actual Electron smoke launch + SDK/catalog initialization | Pass |
| Electron microphone permission probe | Pass |
| Turn A Queen + desk | Feasible |
| Turn B King + desk | No feasible option; one closet conflict |
| Turn C Queen + crib + compact desk | Feasible |
| King + desk + crib | No feasible bounded option |
| Adversarial negation/correction | Feasible Queen + compact desk |
| Exact default model/EP enforced | Pass; integration asserts exact ID and canonical WebGPU EP |
| Empty-cache preparation path | Pass; direct regression covers catalog lookup, model download, EP registration, and load |
| Rejected-preview evidence consistency | Pass; preview checks/conflicts come from one exact option |
| Model/EP cached and loadable | Pass |
| External inference endpoint used | No |
| Labeled browser visual-preview screenshot | `docs/screenshots/stage-ui.png` |
| Real audio integration | Exact English transcript; 100% key-word recall |
| Audio model/EP | Exact Whisper Tiny ID on CPU EP |
| Audio transcription | 233 ms for 5.53-second deterministic WAV |
| Reset timeout quarantine | Pass; late native turn is rolled back, controls remain blocked, and the session is replaced before readiness returns |
| Audio temp cleanup | Pass; real integration capture files before/after both empty |
| Shutdown orphan recovery | Pass; locked owned capture remains reported, a new store purges it, nonmatching files remain, and path escape is rejected |
| Audio external endpoint | No |

Observed turn durations on this machine:

| Turn | Duration |
|---|---:|
| Queen + desk | 12.1 s |
| King replacement | 22.0 s |
| Add crib | 25.0 s |
| Controlled failure | 30.2 s |
| Adversarial correction | 33.9 s |

The longer turns include one bounded correction request.

## Model-path evidence

| Candidate | Result |
|---|---|
| Qwen3 0.6B GPU, 529 MB | Exhausted 2,048 output tokens without a native tool call |
| Qwen2.5 0.5B NPU, 528 MB | Invalid argument type and empty state reference |
| Qwen2.5 Coder 1.5B GPU, 1,280 MB | Interrupted native tool-call output |
| Qwen3 1.7B GPU, 1,421 MB | Reasoning disabled successfully; failed crib correction |
| Qwen2.5 1.5B GPU, 1,546 MB | Full staged and adversarial flow passed |

## Audio model evidence

Pinned v2.2.1 API evidence:

- Whisper file transcription is covered by the JS `AudioSession` tests with
  `Item.audioFromUri(...)` and `language: "en"`.
- Typed inline `Item.audioFromData("wav", bytes)` was measured and rejected by the v2.2.1 native
  runtime: inline audio without `ItemQueue` is not yet supported.
- Nemotron streaming is covered by the pinned JS `AudioSession` PCM `ItemQueue` tests and live audio
  sample.

Catalog and measured comparison:

| Candidate | Initial cache | Catalog size / device / EP | Measured load | Measured transcription |
|---|---|---|---:|---:|
| `openai-whisper-tiny-generic-cpu:4` | Cached | 131 MB / CPU / CPU EP | 1,142 ms | 169–279 ms, exact |
| `openai-whisper-base-generic-cpu:3` | Cached | 205 MB / CPU / CPU EP | 1,441 ms | 362–427 ms, exact |
| `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | Uncached | 696 MB / CPU / CPU EP | 2,699 ms | 932–971 ms buffered, exact except terminal punctuation |
| `nemotron-3.5-asr-streaming-0.6b-generic-cpu:3` | Uncached | 756 MB / CPU / CPU EP | Not run | Not run; multilingual/Chinese unclaimed |

Nemotron English was downloaded once under the authorized under-1-GB evaluation. A real-time PCM
probe produced first text at 1,291 ms and final output 189 ms after the 5.53-second input ended. The
app's UX is record-then-transcribe and does not display partial captions, so that streaming advantage
did not materially improve the stage interaction. Whisper Tiny and Nemotron had comparable
stop-to-final latency in the measured paths. Whisper Tiny was selected for its smaller footprint,
cached availability, faster 169–279 ms buffered record-then-transcribe benchmark, and the absence of
partial streaming in the UI. The rejected Nemotron benchmark model was removed from cache after
measurement.

Final real app-service audio integration:

| Item | Result |
|---|---|
| Fixture | `tests/fixtures/queen-desk.wav`, offline deterministic English, 177,006 bytes |
| Duration | 5,530 ms |
| Prepare manager/catalog/model | 2,013 ms |
| Transcript | “Can a queen size bed and a desk fit here without blocking the closet or the door?” |
| Key-word recall | 7/7 (100%) |
| Transcription | 233 ms |
| Temporary files | none before, none after |
| Endpoint | in-process SDK only |

## Offline and telemetry status

- The selected model is in the shared local cache.
- Whisper Tiny is in the shared cache and must also be loaded before the UI claims voice input is
  offline-ready.
- The required WebGPU EP bundle is installed and registered in the app data directory.
- The default target is resolved by exact model ID from the full public catalog; cache-only alias
  fallback is not used.
- `WebGpuExecutionProvider` from SDK discovery is normalized only to the documented
  `WebGPUExecutionProvider` spelling.
- Alternate model/EP pairs require both `FOUNDRY_MODEL_ID` and
  `FOUNDRY_EXECUTION_PROVIDER`; readiness marks them as environment overrides and does not imply
  stage validation.
- A fresh process loaded the model and completed five turns.
- A fresh process loaded Whisper Tiny and completed deterministic local ASR with no residual audio
  file.
- The app does not configure `serviceEndpoint`, call `startWebService`, or make inference HTTP
  requests.
- `disableNonessentialTelemetry` is enabled.
- Foundry Local reports that a minimal `ProcessInfo` event may still upload.
- The network adapter was not disabled during development; the exact manual full-offline procedure
  is in `DEMO-RUNBOOK.md`.
- Electron `webContents.capturePage()` returned `UnknownVizError` in this host. The actual Electron
  app was smoke-launched separately; the committed screenshot comes from the same renderer in an
  explicitly labeled browser preview.

## Remaining blockers

- No Apple-silicon Mac was available. macOS install, EP selection, model variant, rendering, and
  performance are not validated.
- A physical network-disconnect rehearsal still requires Wayne's manual adapter action.
- Real microphone permission and human-spoken acceptance still require one Wayne interaction:
  **Prepare microphone -> Start recording -> speak the Queen + desk request -> Stop & transcribe ->
  verify/edit -> Send**.
- The local CLI is `0.11.0` while current public CLI is `0.12.1 Preview`; the app does not depend on
  the CLI.
