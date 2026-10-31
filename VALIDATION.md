# Validation record

**Date:** October 31, 2026

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
| Audio submission policy | live partials are display-only; raw final transcript stays in trace and the editable prompt; suggestions require explicit Apply; never auto-submit |

The compact contract moved exact IDs, state references, versions, units, retained objects, locked
constraints, required checks, and unknown-term construction into application code. The model emits
only semantic bed/desk/internal-crib changes and clarification; the application preserves the exact
submitted prompt as `changedPreference`. Audience prompts use **baby bed**. `baby bed`, `baby-bed`,
`baby cot`, and technical `crib` map to stable `crib-standard`. The runtime schema keeps every compact
intent value available;
application validation handles directional transitions, scoped negation, ambiguity, retained state,
and fail-closed furniture recognition. Exact `qwen3-0.6b-generic-gpu:2` remains the stage-validated
built-in default after passing the corrected semantic gate.

The October 30 UI adds an explicit Turn B recovery action, visible requirements and exact pair
measurements, red/green SVG dimension callouts, and application-owned 50 mm-grid direct manipulation.
Manual placement keeps model/tool history intact, reuses the same deterministic validator, rejects
stale or invalid previews, and records separate provenance before creating a new accepted application
layout version.

The independent reset/speech revision advances renderer and controller state synchronously to a
persisted reset generation and v0, clearing the editable prompt, submitted transcript state, raw
audio trace, pending/applied suggestion and undo provenance, recording state, accepted layout,
manual preview, pointer drag, and focus before native reset settles. Renderer cleanup releases
microphone tracks while main revokes the active audio lease and starts the authoritative controller
reset. Native cancellation remains bounded. A timeout stays v0 and quarantined; automatic readiness
recovery can re-enable controls only for the same v0 generation, and stale bootstrap/result payloads
are rejected. Repeated Reset and a subsequent recording use a fresh ownership lease.

Speech suggestions require a direct local governing action in a small token span before the
candidate. Punctuation, coordinators, subordinators, or an explicit new subject between the action
and candidate reject the suggestion; an action from an earlier clause is never inherited. Quoted
wording, travel/luggage context, and local negation (`not`, `never`, `don't`, `no need to`, `no
longer`, `without`, `avoid`, `exclude`, `rather than`, and `not anymore`) remain literal. `creep`
requires local positive baby-bed/crib evidence, and `queen size bag` requires direct keep/retain or
plausible local bed/layout evidence. The exact raw transcript is inserted first; Apply is explicit,
Dismiss leaves raw, and Apply remains undoable before Send.

## Commands run

```powershell
npm install --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm rebuild electron esbuild foundry-local-sdk
npm run probe:foundry
$env:LAYOUT_BENCHMARK_MODELS="qwen3-0.6b-generic-gpu:2"
$env:LAYOUT_BENCHMARK_REQUIRED_MODELS="qwen3-0.6b-generic-gpu:2"
npm run benchmark:layout
Remove-Item Env:LAYOUT_BENCHMARK_MODELS
Remove-Item Env:LAYOUT_BENCHMARK_REQUIRED_MODELS
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
npm run probe:reset
npm run probe:stream-owner
npm run probe:microphone-permission
npm run capture:ui
```

## Results

| Check | Result |
|---|---|
| TypeScript | Pass |
| Biome lint/format | Pass |
| Required package install scripts | Pass; Electron, esbuild, and Foundry Local SDK are explicitly approved in `package.json`; the valid cached Electron archive was extracted after npm omitted the binary |
| Unit tests | 23 files / 633 tests pass; Vitest reported 1.59 s |
| Electron/Vite build | Pass |
| Actual Electron smoke launch + SDK/catalog initialization | Pass |
| Electron renderer Reset probe | Pass; two real Start-recording/Reset UI cycles used a controlled WAV-backed MediaStream and real Nemotron `AudioSession`; tracks stopped, controller cancellation completed in 7 ms then 5 ms, ownership advanced from session 1 to 2, UI/controller stayed v0, and the fresh recording lease succeeded |
| Electron stream-owner probe | Pass; a real renderer recording produced 2 PCM chunks before reload navigation and a fresh session produced 1 chunk before window close; both renderer tracks stopped, native cancellation completed in 11 ms and 33 ms, ownership advanced from session 1 to 2, stale routing was false, and no destroyed-object or unhandled errors occurred |
| Electron microphone permission probe | Pass |
| Turn A Queen + desk | Feasible |
| Turn B King + desk | No feasible option; one closet conflict |
| Turn C Queen + baby bed + compact desk | Feasible; recovery prompt preserved exactly |
| King + compact desk + baby bed | No feasible bounded option; east preview measures 70 / 250 mm and 170 / 250 mm |
| Recovery action | Pass; visible choice enters the same real Qwen/app validation pipeline and keeps door, closet, window, and 250 mm clearance locked |
| Baby-bed aliases | Pass; `baby bed`, `baby-bed`, `baby cot`, and technical `crib` resolve to `crib-standard` |
| Visible ASR suggestions | Pass; raw text is initial, exact replacements require a direct governing-action token span and explicit Apply, Dismiss preserves raw, Undo restores it, and provenance remains visible; all requested `while`/`because`/`although`/`whereas`/`when`/`after`/`before`/`since`/`if`/`unless` new-subject variants, quoted speech, expanded negation, multiline input, travel/luggage bags, and ordinary `creep` wording are negative-tested |
| Reset consistency | Pass; reset initiation immediately creates one generation-tagged renderer/main v0, clears accepted/transient evidence, rejects stale bootstrap/results, preserves v0 through timeout and late recovery, stops active tracks, releases ownership, and permits a fresh recording lease |
| Manual placement | Pass; coordinate conversion, grid-quantized bounds for non-grid footprints, 50 mm snap, keyboard movement, collision, reserved-zone, door-swing, clearance, valid commit, invalid revert, stale state, and retain-only conversational preservation are covered |
| Renderer interaction | Pass in browser preview; keyboard focus survived repeated SVG redraws, the semantic fieldset exposed placement controls, valid preview -> Apply created state v4 while Beat E remained pending, invalid 226 / 250 mm preview disabled Apply, and Revert restored the accepted layout |
| Requirements / measurements | Pass; accepted and rejected exact-option measurements share the same evaluated option as checks/conflicts |
| Adversarial negation/correction | Feasible Queen + compact desk |
| Exact default model/EP enforced | Pass; integration asserts exact ID and canonical WebGPU EP |
| Compact intent contract | Pass; model schema contains no IDs, state refs, dimensions, placements, fit, conflicts, or geometry verdict |
| App-derived authority fields | Pass; exact IDs, versions, units, state ref, retained IDs, locked constraints, required checks, and unknowns are derived |
| Candidate quality gate | Pass for required default; exact Qwen3 passed 18/18 independently authored scenarios |
| Negated transitions | Pass; prohibited bed/desk replacements preserve accepted items, punctuation scopes clauses, and ambiguous conjunctions require clarification without changing any slot |
| Unsupported item | Pass; California King, twin/twin bed, moon pod, armchair, cabinet, bassinet, night stand, dresser, and likely action-object nouns force clarification while supported intent is preserved |
| Stale/invented protections | Pass; stale state, invented IDs, and extra geometry/verdict fields are rejected |
| Paraphrases | Pass; original cases plus affirmative replace/from-to, scoped-negation correction, negated bed/desk transitions, `baby-bed`, and `baby cot` |
| Empty-cache preparation path | Pass; direct regression covers catalog lookup, model download, EP registration, and load |
| Rejected-preview evidence consistency | Pass; preview checks/conflicts come from one exact option |
| Model/EP cached and loadable | Pass |
| External inference endpoint used | No |
| Labeled browser visual-preview screenshot | `docs/screenshots/stage-ui.png`, 1,600 x 900, 397,297 bytes |
| Real Nemotron integration | 31 changing partials; exact English words; 100% key-word recall |
| Nemotron model/EP | Exact `nemotron-speech-streaming-en-0.6b-generic-cpu:3` on CPU EP |
| Nemotron timing | Cached prepare 5,095 ms; first partial 1,291 ms; stop-to-final 101 ms |
| Real Whisper fallback integration | Exact English transcript; 100% key-word recall |
| Whisper fallback model/EP | Exact `openai-whisper-tiny-generic-cpu:4` on CPU EP |
| Whisper fallback timing | Cached prepare 7,416 ms; final transcription 228 ms |
| Failed audio-mode switching | Pass; requested mode is shown not ready while the previously working model remains loaded when target resolution fails |
| Transcript submission state | Pass; the exact edited prompt becomes submitted/processing and never remains labeled `not sent` after Send |
| Partial JSON execution gate | Pass; `finishReason: "length"` is retried/rolled back and never reaches geometry |
| Reset timeout quarantine | Pass; late native turn is rolled back, controls remain blocked, and the session is replaced before readiness returns |
| Audio temp cleanup | Pass; real integration capture files before/after both empty |
| Shutdown orphan recovery | Pass; locked owned capture remains reported, a new store purges it, nonmatching files remain, and path escape is rejected |
| Audio external endpoint | No |

Final command outputs from the October 31 independent revision run:

| Command | Result |
|---|---|
| `npm run probe:foundry` | Pass; exact selected default cached; exact task/device/EP/cache metadata recorded for all candidates |
| Electron runtime materialization | Pass from the checksum-verified cached 42.3.3 archive after npm postinstall returned without extracting it |
| `npm run benchmark:layout` | Pass; required Qwen3 default passed 18/18; 5,677 ms load, 6,008 ms median, 9,051 ms max |
| `npm run lint` | 79 files checked |
| `npm run typecheck` | Pass |
| `npm test` | 23 files / 633 tests; Vitest reported 1.59 s |
| `npm run build` | Pass; 122 renderer modules |
| `npm run smoke:electron` | Pass, including its required rebuild |
| `npm run probe:reset` | Pass; actual renderer Start/Reset controls, controlled WAV-backed MediaStream, production IPC/controller/owner, real Nemotron stream, 1 PCM chunk per cycle, 7 ms then 5 ms cancellation, stopped tracks, v0 UI/controller, and fresh lease session 2 |
| `npm run probe:stream-owner` | Pass; actual renderer Start recording produced 2 chunks before reload navigation and 1 chunk in fresh session 2 before window close; both tracks and native streams cancelled in 11 ms and 33 ms, stale routing was false, and destroyed-object/unhandled error counts were zero |
| `npm run probe:microphone-permission` | Pass, including its required rebuild |
| `npm run capture:ui` | Pass; 397,297-byte labeled 16:9 screenshot, including rebuild |
| `npm run test:audio-integration` | Pass; 7,416 ms prepare, 228 ms transcription |
| `npm run test:nemotron-integration` | Pass; 31 partials, 1,291 ms first partial, 101 ms stop-to-final |
| `npm run test:integration` | Pass; 13 real Qwen3 turns including explicit recovery, `baby-bed`, `baby cot`, affirmative/negated transitions, and unsupported variants, 2.349–8.841 s |

## Layout latency profile

The legacy full-input baseline used exact
`qwen2.5-1.5b-instruct-generic-gpu:4`. It required the model to reproduce fixed IDs, versions,
state references, retained objects, units, and clarification details.

| Legacy turn | Attempts | Generation | Validation | Total | Prompt tokens | Output tokens | Prompt / schema / output bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| A · Queen + desk | 1 | 23,945 ms | 4.722 ms | 23,955 ms | 748 | 210 | 1,043 / 1,812 / 697 |
| B · King replacement | 2 | 36,029 ms | 1.066 ms | 36,037 ms | 1,285 | 198 | 1,310 / 1,758 / 653 |
| C · Add baby bed | 2 | 25,789 ms | 0.698 ms | 25,795 ms | 1,820 | 212 | 1,355 / 1,754 / 700 |
| Controlled failure | 2 | 27,797 ms | 0.558 ms | 27,806 ms | 2,378 | 223 | 1,369 / 1,773 / 729 |
| Negation/correction | 2 | 38,882 ms | 0.721 ms | 38,893 ms | 2,943 | 219 | 1,367 / 1,769 / 721 |

Legacy cached model load was 8,120 ms. The corrected selected-default app integration measured:

The legacy capture ran at task start under Node 24.22.2; the host toolchain exposed Node 26.13.0
for the final isolated candidate suite and regression. SDK 2.2.1, hardware, cache, EP, prompts, and
models remained fixed. The same-process-version candidate ranking is therefore the authoritative
model-selection evidence; the legacy comparison remains the measured contract-path before/after.

| Intent-delta turn | Attempts | Generation | Validation | Total | Prompt tokens | Output tokens | Prompt / schema / output bytes |
|---|---:|---:|---:|---:|---:|---:|---:|
| A · Queen + desk | 2 | 7,897 ms | 22.910 ms | 7,930 ms | 958 | 65 | 1,461 / 1,998 / 168 |
| B · King replacement | 2 | 6,522 ms | 4.650 ms | 6,532 ms | 1,423 | 64 | 1,323 / 1,998 / 168 |
| C · Add baby bed | 2 | 8,227 ms | 3.302 ms | 8,239 ms | 1,905 | 64 | 1,469 / 1,998 / 168 |
| Controlled failure | 2 | 7,886 ms | 7.572 ms | 7,899 ms | 2,389 | 64 | 1,416 / 1,998 / 171 |
| Adversarial correction | 2 | 8,834 ms | 2.374 ms | 8,841 ms | 2,855 | 64 | 1,421 / 1,998 / 174 |
| Replace King with Queen | 1 | 4,899 ms | 1.040 ms | 4,903 ms | 1,604 | 32 | 463 / 999 / 86 |
| From King to Queen | 1 | 5,198 ms | 1.855 ms | 5,204 ms | 1,744 | 32 | 479 / 999 / 86 |
| Scoped negation | 1 | 5,564 ms | 1.240 ms | 5,568 ms | 1,890 | 32 | 500 / 999 / 86 |
| Baby-bed alias | 1 | 2,423 ms | 1.365 ms | 2,427 ms | 431 | 32 | 511 / 999 / 85 |
| Baby-cot alias | 1 | 2,346 ms | 1.374 ms | 2,349 ms | 431 | 32 | 511 / 999 / 85 |
| Negated bed + desk transitions | 2 | 4,499 ms | 1.457 ms | 4,503 ms | 663 | 64 | 1,534 / 1,998 / 167 |
| Unsupported California King | 2 | 4,706 ms | 4.057 ms | 4,713 ms | 609 | 64 | 1,322 / 1,998 / 175 |
| Unsupported twin + moon pod | 2 | 5,718 ms | 4.718 ms | 5,728 ms | 619 | 64 | 1,344 / 1,998 / 175 |

The historical October 29 real-app maximum was 11,162 ms. The October 31 thirteen-turn integration
with explicit recovery and baby-bed aliases measured 2,349–8,841 ms while preserving the compact
semantic contract. The extra bounded attempt on several turns remains visible rather than hidden by
prompt-preselected enums.

## Exact model benchmark

The corrected benchmark kept all semantic enums unrestricted and used independently authored intent,
candidate, status, and selection expectations. It covered A/B/C, controlled failure, correction,
unsupported-furniture clarifications, negated transitions, and nine paraphrases including
`baby-bed` and `baby cot`. The
runner now exits nonzero when a required candidate or selected result fails; isolated rejected
candidate evidence is still retained. The stage-validated built-in default remains selected when it
passes the full gate.

| Exact candidate | Task | Device / EP | Cached size | Load | Warm median / max | Attempts / failures | Peak process RSS | Result |
|---|---|---|---:|---:|---:|---:|---:|---|
| `qwen3-0.6b-generic-gpu:2` | `chat-completion` | GPU / WebGPU | 529 MB | 5,677 ms | 6,008 / 9,051 ms | 35 / 0 | 9,935 MB | **Selected; required gate pass, 18/18** |

Peak RSS is whole-process mapped working-set evidence, not dedicated model or VRAM allocation. The
other cached candidates were not rerun under this final corrected semantic gate, so prior quality
claims are intentionally not carried forward.

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
| `openai-whisper-tiny-generic-cpu:4` | Cached explicit fallback | 131 MB / CPU / CPU EP | 7,416 ms current cached prepare | 228 ms, exact |
| `openai-whisper-base-generic-cpu:3` | Cached | 205 MB / CPU / CPU EP | 1,441 ms | 362–427 ms, exact |
| `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | Cached stage default | 696 MB / CPU / CPU EP | 5,095 ms current cached prepare | 31 live revisions; first 1,291 ms; final 101 ms after stop; exact words |
| `nemotron-3.5-asr-streaming-0.6b-generic-cpu:3` | Uncached | 756 MB / CPU / CPU EP | Not run | Not run; multilingual/Chinese unclaimed |

Nemotron English was downloaded once under the authorized under-1-GB policy and remains in the
shared cache as the stage default. The current real-time run produced 31 subtitle revisions, first
text at 1,291 ms, and final output 101 ms after the 5.53-second input ended. The UI displays those
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
| Prepare manager/catalog/model | 5,095 ms, cached |
| Partial revisions | 31 |
| First partial | “Can” at 1,291 ms |
| Final transcript | “Can a queen size bed and a desk fit here without blocking the closet or the door” |
| Key-word recall | 7/7 (100%) |
| Stop-to-final | 101 ms |
| Total paced stream | 6,216 ms |
| Endpoint | in-process SDK only |

Final real app-service Whisper fallback integration:

| Item | Result |
|---|---|
| Fixture | `tests/fixtures/queen-desk.wav`, offline deterministic English, 177,006 bytes |
| Duration | 5,530 ms |
| Prepare manager/catalog/model | 7,416 ms, cached |
| Transcript | “Can a queen size bed and a desk fit here without blocking the closet or the door?” |
| Key-word recall | 7/7 (100%) |
| Transcription | 228 ms |
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
- The real Electron Reset probe used two renderer Start/Reset cycles, returned state v0 after each,
  stopped both renderer tracks, canceled both native streams, and acquired ownership session 2.
- The separate real Electron stream-owner probe recorded through reload navigation and window close,
  stopped both renderer tracks, canceled both native streams, advanced ownership from session 1 to 2,
  rejected stale routing, and exited with no destroyed-object, uncaught, or unhandled error.
- The app does not configure `serviceEndpoint`, call `startWebService`, or make inference HTTP
  requests.
- `disableNonessentialTelemetry` is enabled.
- Foundry Local reports that a minimal `ProcessInfo` event may still upload.
- The network adapter was not disabled during development; the exact manual full-offline procedure
  is in `DEMO-RUNBOOK.md`.
- The deterministic Nemotron/Whisper fixture remains the honest Queen + desk recording. It was not
  regenerated or relabeled for this change.
- Electron `webContents.capturePage()` returned `UnknownVizError` in this host. The actual Electron
  app was smoke-launched separately; the committed screenshot comes from the same renderer in an
  explicitly labeled browser preview.

## Remaining blockers

- No Apple-silicon Mac was available. macOS install, EP selection, model variant, rendering, and
  performance are not validated.
- A physical network-disconnect rehearsal still requires Wayne's manual adapter action.
- Real microphone permission and human-spoken acceptance still require one Wayne interaction:
  **Prepare Nemotron live -> Start recording -> say “Keep the Queen bed. Add a baby bed. Use a
  compact desk. Keep the closet clear.” -> confirm partial revisions -> Stop -> verify the raw trace,
  visible suggestion label if present, and editable draft -> Send -> confirm
  `queen-crib-compact-v1`**.
- The local CLI is `0.11.0` while current public CLI is `0.12.1 Preview`; the app does not depend on
  the CLI.
