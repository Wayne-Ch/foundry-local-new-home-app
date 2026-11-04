# Enhanced New Home App playtest

Enhanced New Home App extends
[New Home App](https://github.com/Wayne-Ch/foundry-local-new-home-app)
with exact-fixture image preview, local VLM topology analysis, imported-room planning, and an
explicit default-room fallback.

This is the complete first-time tester route for Enhanced New Home App. Complete the guided flow in
the required `A -> B -> C -> D -> E` order; do not skip from C to E.

## Requirements

- Windows 11 x64 for the currently validated setup and playtest route; other app environments do
  not yet have equivalent validation evidence
- Git for Windows
- Supported Node.js range: `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported
- Supported npm minimum: `>=11.18.0`; this is required for `npm install-scripts`
- Internet access for installation and first local model/execution-provider preparation
- Several GB of free disk space for dependencies and model assets
- A WebGPU-capable graphics adapter and current driver; the layout model uses
  `WebGPUExecutionProvider`
- A microphone only for voice-path testing; typed and scripted flows remain available without one

## Validated configuration and current limits

This playtest's current E2E evidence was collected with Node `26.13.0` and npm `11.20.0` on Windows
11 x64 with an AMD Radeon 860M and 64 GB RAM. AMD Radeon 860M identifies the evidence machine; it is
not a minimum or required adapter. The product requirement is a WebGPU-capable graphics
adapter/driver for the current layout model configuration. No minimum RAM value has been
established. The floor-plan VLM remains on CPU / `CPUExecutionProvider`. Foundry Local's broader
public platform and hardware support is separate, and other app environments must not be presented
as having equivalent evidence until tested to the same depth.

## Fresh clone, install, build, and launch

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

Do not switch branches or reuse another checkout's `node_modules`, Electron profile, app data, or
temporary files. The window and page heading must say **Enhanced New Home App**. The fresh state
must show **Choose a room to begin**, **Room required**, **Load sample floor plan**,
**Choose exact fixture copy**, **Analyze layout**, and **Use default room**. Conversation and
recording actions remain unavailable until a room is activated.

## Quick guided playtest

> **Why the UI has A/B/C/E buttons:** A, B, C, and E are scripted Qwen model turns. D is the
> application-owned **D · App-owned manual adjustment** beat, performed directly on accepted
> furniture with drag, keyboard, **Apply**, and **Revert**. There is intentionally no scripted D
> button and no model inference in D, but D is a required step in this guide.

### Prepare the required local models

First preparation downloads local model and execution-provider assets, so stay online and keep
Enhanced New Home App open until the required ready states appear; later app actions can run
offline.

When step 3 reaches layout-model setup, the normal button is determined only by
`readiness.modelCached`; WebGPU provider registration does not select the wording:

| Normal setup state | `modelCached` | Exact control | Operator action |
|---|---:|---|---|
| Cold, empty shared model cache | `false` | **Prepare offline** | Select it while online to download the exact model and prepare local runtime assets. |
| Warm shared cache with a fresh product root | `true` | **Load local model** | Select it; the shared model is present even though this product has not loaded it. |
| Model cached; product-specific WebGPU provider registration still needed | `true` | **Load local model** | Select it. Provider registration does not change the label. |
| Loaded READY state | `true` | **Local model ready** | Do not select it; continue only when the green ready state is visible. |

1. **Stage the exact floor-plan fixture**
   - **Action:** Select **Load sample floor plan** once.
   - **Expected:** A `1020 x 1080` preview appears. The status begins with `Preview only`, **Analyze layout** becomes available, and the room canvas still has no walls, reserved zones, or furniture.
   - **Stop if:** Geometry appears before analysis, the preview is not `1020 x 1080`, the identity gate rejects the packaged fixture, or conversation controls become available while no room is active.

2. **Analyze and activate the imported room**
   - **Action:** Select **Analyze layout**, wait for completion, then open **Developer trace**.
   - **Expected:** The trace identifies `qwen3.5-0.8b-generic-cpu:3`, CPU / `CPUExecutionProvider`, SDK `2.2.1`, and no external endpoint. It independently reports `roomShape=rectangle` plus room label, door opening, and window opening as `present`. Only after that success, imported NARA room geometry appears with the documented `3650 x 3950 mm` application-owned scale and canonical door, window, closet, and clearance geometry.
   - **Stop if:** Analysis fails, remains uncertain, reports a missing visible feature, activates geometry before success, or silently substitutes default-room geometry. **Use default room** is an explicit fallback, not a successful import.

3. **Prepare the layout model**
   - **Action:** Follow the table using the exact visible control. Select **Prepare offline** only
     when the model is not cached. Select **Load local model** whenever the model is cached but the
     runtime is not READY, including a fresh product root or product-specific WebGPU registration.
     If the button already says **Local model ready**, do not select it again.
   - **Expected:** The green badge reads `qwen3-0.6b · GPU · WebGPUExecutionProvider`. **Developer trace** identifies `qwen3-0.6b-generic-gpu:2`, SDK `2.2.1`, `built_in_default`, `stageValidated: true`, and external endpoint `false`. The next-turn control reads **Run next: A · Imported Queen + desk**.
   - **Stop if:** The badge shows an override, the configured model or provider is unavailable, the trace shows an external endpoint, or the imported A/B/C/E buttons do not appear.

4. **A — Imported Queen + desk (model turn)**
   - **Action:** Select **A · Imported Queen + desk** and wait for the model turn to finish.
   - **Expected:** The Buyer request asks about a Queen-size bed and desk in the imported room. A Queen bed plus standard desk is feasible, becomes the accepted layout, and passes the locked door, closet, window, and furniture-clearance checks.
   - **Stop if:** The turn rejects, different furniture is accepted, geometry appears before model and application validation finish, or the Buyer request is duplicated in **Application evidence**.

5. **B — Imported King conflict (model turn plus rejected/accepted inspection)**
   - **Action:** Select **B · Imported King conflict**. The failure automatically opens the exact rejected option: verify the `70 mm / required 250 mm` measurement, its checks and conflicts, and that rejected furniture is non-interactive. Select **Show accepted layout** and verify the prior Queen + standard desk layout is preserved and adjustable. Select **Inspect rejected option** to return to the same rejected evidence.
   - **Expected:** The initial post-turn view is the rejected King option, not the accepted canvas. **Show accepted layout** reveals the preserved Queen + standard desk layout, **Inspect rejected option** returns to the same rejected evidence, and both switches are immediate without another Buyer message or inference turn.
   - **Stop if:** B is feasible, the failure does not initially show the rejected option, its measurement/checks/conflicts do not agree, rejected furniture can be dragged or keyboard-moved, **Apply** can accept rejected furniture, the prior accepted layout is missing or not adjustable, or either switch adds a Buyer message or reruns inference.

6. **C — Imported Queen + desk + baby bed (model turn)**
   - **Action:** Select **C · Imported Queen + desk + baby bed** and wait for the model turn to finish.
   - **Expected:** The Buyer request asks for Queen + desk + baby bed, permits a compact desk, and keeps the door, closet, window, and `250 mm` furniture-clearance rule locked. Queen + compact desk + baby bed is feasible and becomes the accepted layout.
   - **Stop if:** The request loses any locked constraint, baby bed is missing, a standard desk is forced when the compact option is required, or the result does not become the accepted layout.

7. **D — App-owned manual adjustment (no model turn)**
   - **Action:** Work from the accepted C layout under **D · App-owned manual adjustment**. For the accepted bed, compact desk, and baby bed, test a drag preview and a focused Arrow-key preview; use **Revert** between previews as needed. Select **Apply** once on a valid preview, then create another preview and select **Revert**.
   - **Expected:** Every accepted furniture type supports pointer and keyboard adjustment. Arrow keys move exactly `50 mm` per step, a ghost and live deterministic measurements appear, **Apply** creates a new accepted application layout version, and **Revert** preserves the previously accepted layout. No Buyer message or Qwen inference turn is created.
   - **Stop if:** A scripted D model button appears, any accepted furniture type cannot be dragged or keyboard-moved, a rejected-option preview is editable, an Arrow key moves by a value other than `50 mm`, **Apply** is enabled for an invalid preview, or manual adjustment starts model inference.

8. **E — Imported King failure (model turn plus preserved accepted layout)**
   - **Action:** Select **E · Imported King failure**. The failure automatically opens the exact rejected east option: verify the `70 / 250 mm` and `170 / 250 mm` measurements, its checks and conflicts, and that rejected furniture is non-interactive. Select **Show accepted layout** and verify the prior Queen + compact desk + baby bed layout, including any applied D adjustment, is preserved and adjustable. Select **Inspect rejected option** to return to the same rejected evidence.
   - **Expected:** The initial post-turn view is the rejected King option, not the accepted canvas. **Show accepted layout** reveals the preserved C/D accepted state, **Inspect rejected option** returns to the same rejected evidence, and both switches are immediate without another Buyer message or inference turn.
   - **Stop if:** E becomes feasible, the failure does not initially show the rejected east option, its exact measurements/checks/conflicts do not agree, rejected furniture is interactive, the D-adjusted accepted state is lost or not adjustable, the rejected King layout becomes accepted, or either switch adds a Buyer message or starts another model turn.

9. **Confirm the evidence boundary**
   - **Action:** Review the conversation, **Application evidence**, and **Developer trace** after A through E.
   - **Expected:** Each **Buyer** request appears once. **Application evidence** contains only the deterministic conclusion and does not repeat the Buyer request. **Developer trace** retains the exact submitted request, model and execution-provider identity, model intent evidence, application validation, derived tool input, geometry result, and D's application-owned provenance.
   - **Stop if:** The Buyer request appears twice, model prose is presented as deterministic geometry truth, application evidence contains a copied request, or accepted and rejected option evidence is mixed.

10. **Reset back to no-room intake**
    - **Action:** Select **Reset** once after recording the result.
    - **Expected:** The app returns to **Choose a room to begin** and **Room required**; floor-plan preview and geometry, accepted/rejected evidence, prompts, transcript state, and manual previews clear. The stable layout model may remain ready, but no room is active.
    - **Stop if:** Any room geometry, fixture preview, furniture, accepted/rejected evidence, pending manual preview, or enabled room conversation remains.

11. **Exercise the explicit default-room boundary**
    - **Action:** Select **Use default room**.
    - **Expected:** The original verified built-in bedroom becomes active without VLM analysis. Developer trace identifies the default-room source; no imported-room or successful floor-plan-analysis claim appears.
    - **Stop if:** The fixture preview or imported NARA geometry returns, a VLM request starts, or default geometry is labeled as an imported result.

12. **Exercise typed input only after room activation**
    - **Action:** In **Manual prompt**, enter `Can a Queen-size bed and a desk fit here without blocking the closet or the door?`, then select **Send**.
    - **Expected:** The exact prompt appears once and follows the same local planning, application validation, and deterministic geometry path against the active default room.
    - **Stop if:** The prompt is changed, duplicated, submitted while no room is active, or bypasses local planning.

13. **Exercise voice input only after room activation**
    - **Action:** Select **Prepare Nemotron live** and wait for `nemotron-speech-streaming-en-0.6b-generic-cpu:3`, CPU EP, English, and **LIVE** mode. Select **Start recording**, speak a request, then select **Stop**.
    - **Expected:** The final transcript enters **Manual prompt** without being submitted. Review the raw text and use **Apply suggested furniture corrections**, **Dismiss**, or **Undo suggestions** only when those exact controls are shown, then select **Send**.
    - **Stop if:** Recording is available before a room is active, Stop submits automatically, a suggestion changes text without explicit action, Whisper activates silently, or an online speech service is used.
    - **Fallback:** If Nemotron deterministically fails, select **Use Whisper Tiny fallback (record then transcribe)** only when the explicit action is visible and intentionally selected.

14. **Reset back to no-room intake**
    - **Action:** Select **Reset**.
    - **Expected:** The app returns to **Choose a room to begin** and **Room required**; recording, typed input, and scripted controls are unavailable again.
    - **Stop if:** A room, prompt, transcript, accepted/rejected evidence, or enabled conversation control remains.

15. **Shut down cleanly**
    - **Action:** Close the Electron window and wait for `npm run start:built` to return to the PowerShell prompt.
    - **Expected:** The window closes, active sessions and owned resources are disposed, and the launch command exits without a cleanup error.
    - **Stop if:** The launch command does not return, a cleanup error is reported, or a recording/import operation remains visibly active during close.

## What this flow proves

- The vision model recognizes only bounded visible topology. The application owns the fixture's
  millimetre scale, room geometry, door/window/closet zones, placement options, and every verdict.
- Qwen interprets the changing furniture request. Application code validates state and intent,
  derives the full tool input, evaluates deterministic geometry, and preserves the accepted layout
  across rejected requests.
- D is ordinary direct manipulation. The application reuses deterministic validation for snapped
  coordinates; Qwen does not generate or approve the move.
- Imported geometry and default geometry are distinct. **Use default room** is a visible,
  tester-selected fallback and must never be reported as a successful floor-plan import.

## Exact fixture boundary and legal provenance

The only supported file is
[`public/assets/floor-plan/sample-master-bedroom.png`](public/assets/floor-plan/sample-master-bedroom.png),
or a renamed byte-for-byte copy:

- PNG, `1020 x 1080`
- `194,686` bytes
- SHA-256 `02c90be495d1f64e8adb57c4d00eb81f09fbeb80e885a0066f692026d2145587`

Modified, re-encoded, or arbitrary drawings must reject before canonical geometry is activated.
This is not general floor-plan or CAD support.

The fixture is derived from a NARA-held U.S. federal record. Wikimedia Commons marks the source
`PD-US` and does not require attribution; public-domain status may differ outside the United States,
so downstream users must assess rights in their territory. See the
[full provenance record](docs/asset-provenance/sample-master-bedroom.md).

## Troubleshooting

| Symptom | Action |
|---|---|
| npm rejects the Node.js or npm version before install or a script run | Install a supported Node.js version matching `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` and npm `>=11.18.0`. Node 23.x and 25.x are intentionally excluded. The validated pair is Node `26.13.0` with npm `11.20.0`; confirm with `node --version` and `npm --version`. |
| `npm install-scripts` is unavailable | The npm version is below the supported minimum. Upgrade to npm `>=11.18.0` (validated: `11.20.0`), rerun `npm ci --no-audit --no-fund`, then approve the three pinned install scripts. |
| A cold empty cache shows **Prepare offline** | This is the expected `modelCached=false` label. Stay online, select it, and wait for the operation to finish. |
| A warm shared cache, fresh product root, or pending product-specific WebGPU registration shows **Load local model** | This is the expected `modelCached=true` label. Select **Load local model**; do not look for **Prepare offline** based on provider state. |
| The control shows **Local model ready** | The runtime is loaded and READY. Do not select the disabled control; continue with the room flow. |
| Wrong UI or an old room is visible | Confirm the package and window title are **Enhanced New Home App**, select **Reset**, and relaunch only if the no-room checkpoint still fails. |
| Layout model will not prepare | Connect for first preparation, clear unintended `FOUNDRY_MODEL_ALIAS`, `FOUNDRY_MODEL_ID`, or `FOUNDRY_EXECUTION_PROVIDER` variables, then select **Retry local setup**. Use `npm run probe:foundry` for a focused runtime check. |
| Floor-plan analysis rejects | Use only the committed PNG or a byte-identical copy. Read `floorPlanVision.attempts[].rawOutput` in **Developer trace**. Retry **Analyze layout** or explicitly select **Use default room**; never relabel fallback geometry as imported geometry. |
| Drag or Arrow keys do nothing | Confirm **Show accepted layout** is active, the app is not busy, and a feasible accepted layout is displayed. |
| **Apply** is disabled | The preview is rejected, stale, or an operation is active. Select **Revert** and try another accepted-furniture move. |
| Microphone is denied, absent, or busy | Grant permission or close the competing app. Typed input remains valid; do not bypass transcript review. |
| Nemotron does not prepare or stream | Retry **Prepare Nemotron live** while connected. Select **Use Whisper Tiny fallback (record then transcribe)** only if that explicit control is visible and pretested; otherwise use typed input. |
| Electron binary or native binding is missing | Confirm `node_modules\electron\path.txt` exists. Run `npm run setup:native`, then `npm run build` and `npm run start:built`. |

## Detailed pass / stop gate

Record a pass only when all of these are visible:

- fresh `enhanced-new-home-app` clone, **Enhanced New Home App** title, no-room launch, and preview-only sample load;
- successful exact-fixture analysis before imported geometry appears;
- exact local VLM and layout-model identities with no external endpoint;
- A and C feasible; B and E rejected;
- D completed through direct manipulation with no scripted D button and no inference;
- accepted layout preserved across B and E, including an applied D adjustment;
- B and E initially display their rejected option; **Show accepted layout** reveals the preserved,
  adjustable layout and **Inspect rejected option** returns without a Buyer message or inference;
- rejected furniture remains non-interactive;
- accepted bed, compact desk, and baby bed all support drag plus `50 mm` Arrow-key previews;
- **Apply** creates an accepted application layout version and **Revert** discards a preview;
- Buyer request appears once, **Application evidence** is conclusion-only, and
  **Developer trace** retains exact request/model/application evidence;
- explicit **Use default room** activates only the built-in room and is never labeled as an import;
- typed and voice controls are exercised only after a room is active, and Stop never submits;
- **Reset** returns to no-room intake and the Electron window closes cleanly.

Stop and record a failure if the fixture identity or analysis gate fails, default geometry appears
without **Use default room**, the wrong model or execution provider is active, A/B/C/E changes
verdict, D invokes Qwen, any rejected request replaces the accepted layout, accepted/rejected
evidence is mixed, or reset/shutdown leaves stale owned state. Do not reinterpret any of those
results as a successful Enhanced New Home App run.
