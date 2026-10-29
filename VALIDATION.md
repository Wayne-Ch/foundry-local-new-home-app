# Validation record

**Date:** October 29, 2026

**Platform:** Windows 11 Enterprise x64, build `10.0.26300`

**Device:** HP EliteBook 8 G1a, AMD Ryzen AI 7 PRO 350, Radeon 860M, 64 GB RAM

## Selected runtime

| Item | Validated value |
|---|---|
| SDK | `foundry-local-sdk@2.2.1` |
| Node | `26.13.0` |
| Electron | `42.3.3` |
| Model alias | `qwen3-0.6b` |
| Exact model ID | `qwen3-0.6b-generic-gpu:2` |
| Target source | Built-in stage default; no model alias fallback |
| Model cache size | 529 MB |
| Device | GPU |
| Execution provider | `WebGPUExecutionProvider` |
| EP bundle | `webgpu-ep-0.2.1-win-x64` |
| Inference endpoint | none |
| Planning mode | runtime intent-delta JSON Schema -> app-derived tool invocation |
| Visible response | application-rendered typed evidence |
| Default audio model alias | `nemotron-speech-streaming-en-0.6b` |
| Exact default audio model ID | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` |
| Default audio model size | 696 MB |
| Audio device / EP | CPU / `CPUExecutionProvider` |
| Audio language | English |
| Default audio path | AudioWorklet -> PCM16LE 16 kHz mono -> typed bounded chunks -> native `AudioSession` PCM `ItemQueue` |
| Explicit fallback | `openai-whisper-tiny-generic-cpu:4`, 131 MB, temporary owner-only WAV URI |
| Audio submission policy | live partials are display-only; final transcript is editable; never auto-submit |

The compact contract moved exact IDs, state references, versions, units, retained objects, locked
constraints, required checks, and unknown-term construction into application code. The model emits
only semantic bed/desk/crib changes, the user change text, and clarification. Exact
`qwen3-0.6b-generic-gpu:2` was the fastest stage-appropriate candidate by measured warm maximum and
also improved model load and median latency over the previous default.

## Commands run

```powershell
npm install --no-audit --no-fund
npm install-scripts approve esbuild foundry-local-sdk
npm rebuild esbuild foundry-local-sdk
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

## Results

| Check | Result |
|---|---|
| TypeScript | Pass |
| Biome lint/format | Pass |
| Unit tests | 14 files / 140 tests pass; Vitest reported 1.06 s |
| Electron/Vite build | Pass |
| Actual Electron smoke launch + SDK/catalog initialization | Pass |
| Electron renderer-owner reload/close probe | Pass; both streams canceled, ownership session advanced, stale partial routing rejected, no uncaught exception or unhandled rejection |
| Electron microphone permission probe | Pass |
| Turn A Queen + desk | Feasible |
| Turn B King + desk | No feasible option; one closet conflict |
| Turn C Queen + crib + compact desk | Feasible |
| King + desk + crib | No feasible bounded option |
| Adversarial negation/correction | Feasible Queen + compact desk |
| Exact default model/EP enforced | Pass; integration asserts exact ID and canonical WebGPU EP |
| Compact intent contract | Pass; model schema contains no IDs, state refs, dimensions, placements, fit, conflicts, or geometry verdict |
| App-derived authority fields | Pass; exact IDs, versions, units, state ref, retained IDs, locked constraints, required checks, and unknowns are derived |
| Candidate quality gate | 7/7 exact cached candidates passed 9/9 scenarios in one attempt each |
| Unsupported item | Pass; dresser forces clarification and app-derived missing-dimension evidence |
| Stale/invented protections | Pass; stale state, invented IDs, and extra geometry/verdict fields are rejected |
| Paraphrases | Pass; Queen/regular desk, King/keep desk, and Queen/crib/flexible desk |
| Empty-cache preparation path | Pass; direct regression covers catalog lookup, model download, EP registration, and load |
| Rejected-preview evidence consistency | Pass; preview checks/conflicts come from one exact option |
| Model/EP cached and loadable | Pass |
| External inference endpoint used | No |
| Labeled browser visual-preview screenshot | `docs/screenshots/stage-ui.png` |
| Real Nemotron integration | 31 changing partials; exact English words; 100% key-word recall |
| Nemotron model/EP | Exact `nemotron-speech-streaming-en-0.6b-generic-cpu:3` on CPU EP |
| Nemotron timing | Cached prepare 7,192 ms; first partial 1,283 ms; stop-to-final 109 ms |
| Real Whisper fallback integration | Exact English transcript; 100% key-word recall |
| Whisper fallback model/EP | Exact `openai-whisper-tiny-generic-cpu:4` on CPU EP |
| Whisper fallback timing | Cached prepare 5,248 ms; final transcription 258 ms |
| Failed audio-mode switching | Pass; requested mode is shown not ready while the previously working model remains loaded when target resolution fails |
| Transcript submission state | Pass; the exact edited prompt becomes submitted/processing and never remains labeled `not sent` after Send |
| Partial JSON execution gate | Pass; `finishReason: "length"` is retried/rolled back and never reaches geometry |
| Reset timeout quarantine | Pass; late native turn is rolled back, controls remain blocked, and the session is replaced before readiness returns |
| Audio temp cleanup | Pass; real integration capture files before/after both empty |
| Shutdown orphan recovery | Pass; locked owned capture remains reported, a new store purges it, nonmatching files remain, and path escape is rejected |
| Audio external endpoint | No |

Final command outputs from the October 28 run:

| Command | Result |
|---|---|
| `npm run probe:foundry` | Pass; exact selected default cached; exact task/device/EP/cache metadata recorded for all candidates |
| `npm run benchmark:layout` | Pass; 7 exact candidates, 9 scenarios each, isolated process per model |
| `npm run lint` | 60 files checked |
| `npm run typecheck` | Pass |
| `npm test` | 14 files / 140 tests; Vitest reported 1.06 s |
| `npm run build` | Pass; 115 renderer modules |
| `npm run smoke:electron` | Pass, including its required rebuild |
| `npm run probe:stream-owner` | Pass; real reload and close both cancel the captured renderer-owned stream |
| `npm run probe:microphone-permission` | Pass, including its required rebuild |
| `npm run capture:ui` | Pass; 388,449-byte labeled screenshot, including rebuild |
| `npm run test:audio-integration` | Pass; 5,248 ms prepare, 258 ms transcription |
| `npm run test:nemotron-integration` | Pass; 31 partials, 1,283 ms first partial, 109 ms stop-to-final |
| `npm run test:integration` | Pass; five real Qwen3 turns, 2.677–4.453 s, one attempt each |

## Layout latency profile

The legacy full-input baseline used exact
`qwen2.5-1.5b-instruct-generic-gpu:4`. It required the model to reproduce fixed IDs, versions,
state references, retained objects, units, and clarification details.

| Legacy turn | Attempts | Generation | Validation | Total | Prompt tokens | Output tokens | Prompt / schema / output bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| A · Queen + desk | 1 | 23,945 ms | 4.722 ms | 23,955 ms | 748 | 210 | 1,043 / 1,812 / 697 |
| B · King replacement | 2 | 36,029 ms | 1.066 ms | 36,037 ms | 1,285 | 198 | 1,310 / 1,758 / 653 |
| C · Add crib | 2 | 25,789 ms | 0.698 ms | 25,795 ms | 1,820 | 212 | 1,355 / 1,754 / 700 |
| Controlled failure | 2 | 27,797 ms | 0.558 ms | 27,806 ms | 2,378 | 223 | 1,369 / 1,773 / 729 |
| Negation/correction | 2 | 38,882 ms | 0.721 ms | 38,893 ms | 2,943 | 219 | 1,367 / 1,769 / 721 |

Legacy cached model load was 8,120 ms. The current selected-default app integration measured:

The legacy capture ran at task start under Node 24.22.2; the host toolchain exposed Node 26.13.0
for the final isolated candidate suite and regression. SDK 2.2.1, hardware, cache, EP, prompts, and
models remained fixed. The same-process-version candidate ranking is therefore the authoritative
model-selection evidence; the legacy comparison remains the measured contract-path before/after.

| Intent-delta turn | Attempts | Generation | Validation | Total | Prompt tokens | Output tokens | Prompt / schema / output bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| A · Queen + desk | 1 | 4,439 ms | 6.266 ms | 4,453 ms | 218 | 57 | 269 / 472 / 190 |
| B · King replacement | 1 | 2,673 ms | 0.779 ms | 2,677 ms | 339 | 50 | 240 / 430 / 160 |
| C · Add crib | 1 | 3,147 ms | 1.539 ms | 3,152 ms | 462 | 59 | 280 / 460 / 198 |
| Controlled failure | 1 | 3,462 ms | 0.559 ms | 3,467 ms | 596 | 61 | 282 / 466 / 199 |
| Negation/correction | 1 | 3,708 ms | 0.490 ms | 3,712 ms | 731 | 60 | 288 / 476 / 208 |

The real app maximum fell from 38,893 ms to 4,453 ms (**88.5% reduction**) and every turn fell to
one attempt. In the isolated warm benchmark, the selected model measured 2,681 ms median and
3,624 ms maximum, a **90.7% reduction** from the legacy maximum.

## Exact model benchmark

`npm run benchmark:layout` ran each cached candidate in a fresh process against A/B/C, controlled
failure, correction, unsupported-dresser clarification, stale/invented protections, and three
paraphrases. All nine model scenarios completed in one bounded attempt; all deterministic
geometry/status results matched the baseline. Selection ranked lowest warm maximum first, then warm
median, then model load.

| Exact candidate | Task | Device / EP | Cached size | Load | Warm median / max | Attempts / failures | Peak process RSS | Result |
|---|---|---|---:|---:|---:|---:|---:|---|
| `qwen2.5-0.5b-instruct-vitis-npu:3` | `chat-completion` | NPU / Vitis AI | 528 MB | 8,095 ms | 5,191 / 7,039 ms | 9 / 0 | 4,625 MB | Pass |
| `qwen3-0.6b-generic-gpu:2` | `chat-completion` | GPU / WebGPU | 529 MB | 2,926 ms | 2,681 / 3,624 ms | 9 / 0 | 9,947 MB | **Selected** |
| `qwen3.5-0.8b-generic-gpu:2` | `vision-language-chat` | GPU / WebGPU | 1,341 MB | 9,967 ms | 2,091 / 4,140 ms | 9 / 0 | 5,471 MB | Pass |
| `qwen3.5-2b-generic-gpu:2` | `vision-language-chat` | GPU / WebGPU | 3,201 MB | 11,034 ms | 4,414 / 5,534 ms | 9 / 0 | 7,280 MB | Pass |
| `qwen3.5-4b-generic-gpu:2` | `vision-language-chat` | GPU / WebGPU | 5,486 MB | 11,060 ms | 9,589 / 12,710 ms | 9 / 0 | 15,364 MB | Quality pass; misses latency target |
| `qwen3-1.7b-generic-gpu:2` | `chat-completion` | GPU / WebGPU | 1,421 MB | 4,419 ms | 5,002 / 6,519 ms | 9 / 0 | 11,018 MB | Pass |
| `qwen2.5-1.5b-instruct-generic-gpu:4` | `chat-completion` | GPU / WebGPU | 1,546 MB | 5,472 ms | 2,818 / 3,900 ms | 9 / 0 | 3,961 MB | Pass; previous default |

Peak RSS is whole-process mapped working-set evidence, not dedicated model or VRAM allocation.
All three cached Qwen3.5 variants proved compatible with pinned v2.2.1 `ChatSession`, text-only
requests, disabled thinking, and JSON Schema guidance despite catalog task
`vision-language-chat`; readiness now permits that task for explicit overrides.

No 9B model was downloaded: the task explicitly prohibited it, no 9B candidate was cached, and a
larger download would work against the latency and footprint objective after a 529 MB candidate
already passed the full gate.

## Audio model evidence

Pinned v2.2.1 API evidence:

- Nemotron live input is implemented directly with the JS v2.2.1 `AudioSession`,
  `Item.audioDescriptor("pcm", 16000, 1)`, borrowed `ItemQueue`, copied `Item.bytes(...)` frames,
  `markFinished()`, streamed `SpeechSegment` items, and the terminal aggregate `SpeechResult`.
- Whisper file transcription is covered by the JS `AudioSession` tests with
  `Item.audioFromUri(...)` and `language: "en"` as an explicit fallback only.
- Typed inline `Item.audioFromData("wav", bytes)` was measured and rejected by the v2.2.1 native
  runtime: inline audio without `ItemQueue` is not yet supported.
- Nemotron streaming is covered by the pinned JS `AudioSession` PCM `ItemQueue` tests and live audio
  sample.

Catalog and measured comparison:

| Candidate | Initial cache | Catalog size / device / EP | Measured load | Measured transcription |
|---|---|---|---:|---:|
| `openai-whisper-tiny-generic-cpu:4` | Cached explicit fallback | 131 MB / CPU / CPU EP | 5,248 ms current cached prepare | 258 ms, exact |
| `openai-whisper-base-generic-cpu:3` | Cached | 205 MB / CPU / CPU EP | 1,441 ms | 362–427 ms, exact |
| `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | Cached stage default | 696 MB / CPU / CPU EP | 7,192 ms current cached prepare | 31 live revisions; first 1,283 ms; final 109 ms after stop; exact words |
| `nemotron-3.5-asr-streaming-0.6b-generic-cpu:3` | Uncached | 756 MB / CPU / CPU EP | Not run | Not run; multilingual/Chinese unclaimed |

Nemotron English was downloaded once under the authorized under-1-GB policy and remains in the
shared cache as the stage default. The current real-time run produced 31 subtitle revisions, first
text at 1,283 ms, and final output 109 ms after the 5.53-second input ended. The UI displays those
partials only in **Live draft — not sent**. On Stop, it inserts only the terminal aggregate
`SpeechResult` into Manual prompt. On Send, that panel transitions to the exact edited submitted
prompt and a processing/submitted label.

Whisper Tiny remains cached as the explicit smaller fallback. It records first and then returns one
final transcript; it is never selected silently. The similarly named Nemotron 3.5 multilingual
variant was not downloaded, and no Chinese/multilingual capability is claimed.

Final real app-service Nemotron integration:

| Item | Result |
|---|---|
| Fixture | `tests/fixtures/queen-desk.wav`, offline deterministic English, 177,006 bytes |
| Duration | 5,530 ms |
| Prepare manager/catalog/model | 7,192 ms, cached |
| Partial revisions | 31 |
| First partial | “Can” at 1,283 ms |
| Final transcript | “Can a queen size bed and a desk fit here without blocking the closet or the door” |
| Key-word recall | 7/7 (100%) |
| Stop-to-final | 109 ms |
| Total paced stream | 6,095 ms |
| Endpoint | in-process SDK only |

Final real app-service Whisper fallback integration:

| Item | Result |
|---|---|
| Fixture | `tests/fixtures/queen-desk.wav`, offline deterministic English, 177,006 bytes |
| Duration | 5,530 ms |
| Prepare manager/catalog/model | 5,248 ms, cached |
| Transcript | “Can a queen size bed and a desk fit here without blocking the closet or the door?” |
| Key-word recall | 7/7 (100%) |
| Transcription | 258 ms |
| Temporary files | none before, none after |
| Endpoint | in-process SDK only |

## Offline and telemetry status

- The selected model is in the shared local cache.
- Nemotron English is in the shared cache and must be loaded before the UI claims default live voice
  input is offline-ready.
- Whisper Tiny is also cached but is loaded only after explicit fallback selection.
- The required WebGPU EP bundle is installed and registered in the app data directory.
- The default target is resolved by exact model ID from the full public catalog; cache-only alias
  fallback is not used.
- `WebGpuExecutionProvider` from SDK discovery is normalized only to the documented
  `WebGPUExecutionProvider` spelling.
- Alternate model/EP pairs require both `FOUNDRY_MODEL_ID` and
  `FOUNDRY_EXECUTION_PROVIDER`; readiness marks them as environment overrides and does not imply
  stage validation.
- A fresh process loaded the model and completed five turns.
- A fresh process loaded Nemotron and completed deterministic live PCM streaming with multiple
  partials and a final transcript.
- A separate fresh process explicitly loaded Whisper Tiny and completed deterministic fallback ASR
  with no residual audio file.
- A real Electron reload/close probe captured the renderer frame and ownership-session IDs before
  teardown, canceled both active probe streams from main, rejected stale routing, and exited with no
  uncaught exception or unhandled rejection.
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
  **Prepare Nemotron live -> Start recording -> speak the Queen + desk request while confirming
  partial revisions -> Stop -> verify/edit final transcript -> Send**.
- The local CLI is `0.11.0` while current public CLI is `0.12.1 Preview`; the app does not depend on
  the CLI.
