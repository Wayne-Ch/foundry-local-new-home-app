# Enhanced New Home App

Enhanced New Home App extends
[New Home App](https://github.com/Wayne-Ch/foundry-local-new-home-app)
and its [standard guide](https://github.com/Wayne-Ch/foundry-local-new-home-app/blob/main/README.md).
It preserves the standard local planning, deterministic geometry, furniture controls, voice input,
and Reset lifecycle while adding:

- a fresh no-room intake state;
- exact sample floor-plan preview and byte-identity validation;
- local VLM topology analysis before imported geometry can appear;
- imported-room `A -> B -> C -> D -> E` planning with door, window, closet, and clearance
  constraints;
- an explicit **Use default room** fallback that is never reported as a successful import.

![Stage UI](docs/screenshots/stage-ui.png)

For the complete first-time route, follow [PLAYTEST.md](PLAYTEST.md). For stage choreography, use
[DEMO-RUNBOOK.md](DEMO-RUNBOOK.md).

## Product contract

- **Local runtime:** `foundry-local-sdk@2.2.1` runs in process. The app does not use a cloud
  inference or speech endpoint, OS online speech, a CLI subprocess, or a loopback inference server.
- **Layout target:** exact `qwen3-0.6b-generic-gpu:2` on
  `WebGPUExecutionProvider`. The model emits only a compact semantic intent delta; application code
  derives authoritative IDs, state, constraints, and tool input.
- **Deterministic authority:** application-owned geometry decides room bounds, door swing, reserved
  zones, collisions, the `250 mm` furniture-clearance rule, exact pair measurements, and every fit
  verdict.
- **Voice input:** exact `nemotron-speech-streaming-en-0.6b-generic-cpu:3` is the English live
  default on CPU. The exact **Use Whisper Tiny fallback (record then transcribe)** control selects
  `openai-whisper-tiny-generic-cpu:4` only after an explicit user action. Stop creates an editable
  draft and never submits it.
- **Direct manipulation:** accepted furniture is pointer- and keyboard-adjustable on a bounded
  `50 mm` grid. Apply revalidates and creates a new application-owned accepted layout version;
  Revert preserves the prior accepted layout.
- **Rejected-flow contract:** B and E automatically open the exact rejected option whose
  placements, measurements, checks, and conflicts are shown. **Show accepted layout** displays the
  preserved, adjustable accepted layout. **Inspect rejected option** returns to the same rejected
  evidence. These switches do not add a Buyer message or rerun inference.
- **Required D step:** D is a required application-owned manual adjustment between C and E. It has
  no scripted model button and must not invoke Qwen.
- **Reset:** Reset returns to the fresh no-room intake state, clears room/transient evidence, stops
  owned recording work, and rejects stale results.

The visible response is labeled **Application evidence** and is rendered from typed deterministic
results. It is not free-form model prose or hidden chain-of-thought.

## Exact floor-plan import boundary

The Enhanced flow starts with no active room. **Load sample floor plan** shows a preview only;
deterministic imported geometry appears only after **Analyze layout** succeeds. **Use default room**
activates the original verified bedroom as an explicit fallback and must never be labeled as a
successful import.

The only supported file is
[`public/assets/floor-plan/sample-master-bedroom.png`](public/assets/floor-plan/sample-master-bedroom.png)
or a renamed byte-for-byte copy:

- PNG, `1020 x 1080`;
- `194,686` bytes;
- SHA-256 `02c90be495d1f64e8adb57c4d00eb81f09fbeb80e885a0066f692026d2145587`.

Modified, re-encoded, or arbitrary drawings reject before canonical geometry is activated. Main
owns the image bytes and gives the renderer only a bounded preview and recognized facts, never a
filesystem path.

The exact optional VLM is `qwen3.5-0.8b-generic-cpu:3` on CPU /
`CPUExecutionProvider`. It classifies only independent visible evidence for a rectangular room,
printed room label, door opening, and window opening. The application owns the documented
`3650 x 3950 mm` scale, door/window/closet geometry, placements, clearances, and verdicts. This is
not arbitrary architectural-plan or CAD support.

The fixture comes from a NARA-held U.S. federal record. Wikimedia Commons marks the source `PD-US`
and does not require attribution; public-domain status may differ outside the United States, so
downstream users must assess rights in their territory. See the
[full provenance record](docs/asset-provenance/sample-master-bedroom.md).

## Requirements

- Windows 11 x64 for the currently validated setup and playtest route
- Git for Windows
- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported
- npm `>=11.18.0`, required for `npm install-scripts`
- Internet access for installation and first local model/execution-provider preparation
- Several GB of free disk space for dependencies and model assets
- A WebGPU-capable graphics adapter with a current driver for the layout model
- A microphone only for voice-path testing; typed and scripted flows work without one

## Validated configuration and current limits

Current end-to-end evidence was collected with Node `26.13.0` and npm `11.20.0` on Windows 11 x64
with an AMD Radeon 860M and 64 GB RAM. That GPU and memory describe the validation machine; they are
not product requirements. No minimum RAM value has been established. The floor-plan VLM runs on CPU.

[VALIDATION.md](VALIDATION.md) is the authoritative source for the current package/runtime version
matrix, including Electron, exact measurements, test results, and remaining validation limits.
Other environments must not be presented as having equivalent evidence until tested to the same
depth.

## Clone, install, build, and launch

Open PowerShell in the parent folder where `enhanced-new-home-app` should be created:

```powershell
node --version
npm --version
git clone --branch enhanced-new-home-app --single-branch https://github.com/Wayne-Ch/foundry-local-new-home-app.git enhanced-new-home-app
Set-Location -LiteralPath '.\enhanced-new-home-app'
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run check:release-contract
npm run build
npm run start:built
```

First preparation downloads local model and execution-provider assets, so stay online and keep
Enhanced New Home App open until the required ready states appear; later app actions can run
offline.

The normal setup control is determined only by `readiness.modelCached`:

| Normal setup state | `modelCached` | Exact control | Operator action |
|---|---:|---|---|
| Cold, empty shared model cache | `false` | **Prepare offline** | Select it while online to download the exact model and prepare local runtime assets. |
| Warm shared cache with a fresh product root | `true` | **Load local model** | Select it; the shared model is present even though this product has not loaded it. |
| Model cached; product-specific WebGPU provider registration still needed | `true` | **Load local model** | Select it. Provider registration does not change the label. |
| Loaded READY state | `true` | **Local model ready** | Do not select it; continue only when the green ready state is visible. |

## Guided A -> B -> C -> D -> E flow

1. Confirm launch shows **Choose a room to begin** and **Room required**. Recording, typed input,
   and scripted turns remain unavailable until a room is active.
2. Select **Load sample floor plan** and verify preview-only state, then select **Analyze layout**.
   Imported geometry may appear only after exact-fixture and VLM topology acceptance. If analysis
   cannot complete, select **Use default room** explicitly before continuing.
3. Prepare the layout model with the exact visible setup control and wait for
   `qwen3-0.6b-generic-gpu:2` / `WebGPUExecutionProvider` readiness.
4. **A - Imported Queen + desk:** run the model turn and verify a feasible accepted Queen +
   standard-desk layout.
5. **B - Imported King conflict:** verify the exact rejected King option opens automatically with
   the `70 mm / required 250 mm` evidence and non-interactive furniture. Select
   **Show accepted layout** to inspect the preserved adjustable Queen layout, then
   **Inspect rejected option** to return to the same rejected evidence. Neither action sends a
   message or reruns inference.
6. **C - Imported Queen + desk + baby bed:** verify the full buyer request remains visible and the
   feasible Queen + compact desk + baby bed layout becomes accepted.
7. **D - App-owned manual adjustment:** this step is required. Preview accepted furniture with drag
   and Arrow keys, Apply one valid `50 mm`-grid move, then create another preview and Revert it.
   Verify there is no Buyer message or Qwen inference.
8. **E - Imported King failure:** verify the exact rejected east option opens automatically with
   `70 / 250 mm` and `170 / 250 mm` measurements and non-interactive furniture. Select
   **Show accepted layout** to inspect the preserved adjustable C/D layout, then
   **Inspect rejected option** to return to the same rejected evidence. Neither action sends a
   message or reruns inference.
9. Review **Developer trace** to confirm exact request/model identity, application validation,
   derived tool input, option-scoped geometry evidence, and D's application-owned provenance.
10. Select **Reset** and verify the app returns to no-room intake. Select **Use default room** only
    when intentionally exercising the built-in room boundary.

Typed and voice input follow the same local planning and deterministic validation path after a room
is active. The exact raw voice transcript remains editable, suggestions require explicit action,
and **Send** is always separate from **Stop**.

## Troubleshooting

| Symptom | Action |
|---|---|
| npm rejects the Node.js or npm version | Install Node.js matching `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` and npm `>=11.18.0`. Node 23.x and 25.x are intentionally excluded. Confirm with `node --version` and `npm --version`. |
| `npm install-scripts` is unavailable | Upgrade to npm `>=11.18.0`, rerun `npm ci --no-audit --no-fund`, then approve Electron, esbuild, and Foundry Local SDK. |
| A cold empty cache shows **Prepare offline** | Stay online, select it, and wait for the exact model and runtime assets to finish preparing. |
| A warm cache or fresh product root shows **Load local model** | Select **Load local model**. Product-specific WebGPU registration does not change the label. |
| The control shows **Local model ready** | The runtime is READY. Do not select the disabled control; continue with the room flow. |
| Floor-plan analysis rejects | Use only the committed PNG or a byte-identical copy. Inspect `floorPlanVision.attempts[].rawOutput`; retry **Analyze layout** or explicitly select **Use default room**. |
| Drag or Arrow keys do nothing | Select **Show accepted layout**, verify the app is idle, and confirm a feasible accepted layout is displayed. Rejected furniture is intentionally non-interactive. |
| **Apply** is disabled | The manual preview is rejected, stale, or an operation is active. Select **Revert** and try another accepted-furniture move. |
| Nemotron does not prepare or stream | Retry **Prepare Nemotron live** while connected. Select **Use Whisper Tiny fallback (record then transcribe)** only when that explicit control is visible and pretested; otherwise use typed input. |
| Electron binary or native binding is missing | Confirm `node_modules\electron\path.txt` exists. Run `npm run setup:native`, then `npm run build` and `npm run start:built`. |

## Documentation and evidence

- [PLAYTEST.md](PLAYTEST.md) - complete first-time route and pass/stop gates
- [DEMO-RUNBOOK.md](DEMO-RUNBOOK.md) - stage choreography and recovery
- [ARCHITECTURE.md](ARCHITECTURE.md) - responsibility boundaries, implementation decisions, model
  evidence, package/runtime lifecycle, and pinned SDK references
- [VALIDATION.md](VALIDATION.md) - authoritative current versions, exact measurements, commands,
  test evidence, fixture hashes, and remaining blockers
- [CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md) - timed implementation walkthrough
- [Fixture provenance](docs/asset-provenance/sample-master-bedroom.md) - source, derivation, exact
  hash, and legal caveat

## Scope and limitations

- Footprint and clearance planning only; not infant-safety advice, structural review, accessibility
  certification, or global optimization.
- Exact measurements are fixture/application data; images never infer dimensions.
- The engine evaluates bounded known options rather than arbitrary placements.
- Audio is English only. Nemotron provides display-only live captions; Whisper Tiny is an explicit
  record-then-transcribe fallback. There is no multilingual claim, TTS, or online speech service.
- The internal catalog ID remains `crib-standard`; audience-facing prompts and labels use
  **baby bed**.
