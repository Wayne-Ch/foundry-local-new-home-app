# Enhanced New Home App Test Guide

Enhanced New Home App extends
[New Home App](https://github.com/Wayne-Ch/foundry-local-new-home-app)
with exact-fixture image preview, local VLM topology analysis, imported-room planning, and an
explicit default-room fallback.

This is the complete first-time test flow for Enhanced New Home App. Complete the guided flow in
the required `A -> B -> C -> D -> E` order; do not skip from C to E.

## Requirements

- Windows 11 x64
- Git for Windows
- Supported Node.js range: `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported
- Supported npm minimum: `>=11.18.0`; this is required for `npm install-scripts`
- Internet access for installation and first local model/execution-provider preparation
- Several GB of free disk space for dependencies and model assets
- A WebGPU-capable graphics adapter and current driver; the layout model uses
  `WebGPUExecutionProvider`
- A microphone only for voice-path testing; typed and guided flows remain available without one

## Tested configuration

This guide was tested with Node `26.13.0` and npm `11.20.0` on Windows 11 x64 with an AMD Radeon
860M and 64 GB RAM. The layout model requires a WebGPU-capable graphics adapter with a current
driver, and the floor-plan VLM runs on CPU / `CPUExecutionProvider`.

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
npm run build
npm run start:built
```

Do not switch branches or reuse another checkout's `node_modules`. The window and page heading must
say **Enhanced New Home App**. The fresh state must show **Choose a room to begin**,
**Room required**, **Load sample floor plan**, **Choose exact fixture copy**, **Analyze layout**,
and **Use default room**. Conversation and recording actions remain unavailable until a room is
activated.

## Test flow

A, B, C, and E are Qwen model turns. D is the required manual adjustment performed directly on
accepted furniture with drag, keyboard, **Apply**, and **Revert**.

### Prepare the required local models

First preparation downloads local model and execution-provider assets, so stay online and keep
Enhanced New Home App open until the required ready states appear; later app actions can run
offline.

When step 3 reaches layout-model setup, the normal button is determined only by
`readiness.modelCached`; WebGPU provider registration does not select the wording:

| Normal setup state | `modelCached` | Exact control | Action |
|---|---:|---|---|
| Cold, empty shared model cache | `false` | **Prepare offline** | Select it while online to download the exact model and prepare local runtime assets. |
| Warm shared cache with a fresh product root | `true` | **Load local model** | Select it; the shared model is present even though this product has not loaded it. |
| Model cached; product-specific WebGPU provider registration still needed | `true` | **Load local model** | Select it. Provider registration does not change the label. |
| Loaded READY state | `true` | **Local model ready** | Do not select it; continue only when the green ready state is visible. |

1. **Load the exact floor-plan fixture**
   - **Action:** Select **Load sample floor plan** once.
   - **Expected:** A `1020 x 1080` preview appears. The status begins with `Preview only`,
     **Analyze layout** becomes available, and the room canvas still has no walls, reserved zones,
     or furniture.

2. **Analyze and activate the imported room**
   - **Action:** Select **Analyze layout**, wait for completion, then open **Developer trace**.
   - **Expected:** The trace identifies `qwen3.5-0.8b-generic-cpu:3` with
     `CPUExecutionProvider` and reports `roomShape=rectangle` plus the room label, door opening, and
     window opening as present. Imported room geometry then appears with the documented
     `3650 x 3950 mm` scale and door, window, closet, and clearance geometry.

3. **Prepare the layout model**
   - **Action:** Follow the table using the exact visible control. Select **Prepare offline** only
     when the model is not cached. Select **Load local model** whenever the model is cached but the
     runtime is not READY. If the button already says **Local model ready**, do not select it again.
   - **Expected:** The green badge reads `qwen3-0.6b · GPU · WebGPUExecutionProvider`. The
     next-turn control reads **Run next: A · Imported Queen + desk**.

4. **A — Imported Queen + desk (model turn)**
   - **Action:** Select **Run next: A · Imported Queen + desk** and wait for the model turn to
     finish.
   - **Expected:** The Buyer request asks about a Queen-size bed and desk in the imported room. A
     Queen bed plus standard desk is feasible, becomes the accepted layout, and passes the locked
     door, closet, window, and furniture-clearance checks.

5. **B — Imported King conflict (model turn plus rejected/accepted inspection)**
   - **Action:** Select **Run next: B · Imported King conflict**. The failure automatically opens
     the exact rejected option: verify the `70 mm / required 250 mm` measurement, its checks and
     conflicts, and that rejected furniture is non-interactive. Select **Show accepted layout**
     and then **Inspect rejected option**.
   - **Expected:** The initial post-turn view is the rejected King option. **Show accepted layout**
     reveals the preserved Queen + standard desk layout, **Inspect rejected option** returns to the
     same rejected details, and both switches are immediate without another Buyer message or model
     turn.

6. **C — Imported Queen + desk + baby bed (model turn)**
   - **Action:** Select **Run next: C · Imported Queen + desk + baby bed** and wait for the model
     turn to finish.
   - **Expected:** The Buyer request asks for Queen + desk + baby bed, permits a compact desk, and
     keeps the door, closet, window, and `250 mm` furniture-clearance rule locked. Queen + compact
     desk + baby bed is feasible and becomes the accepted layout.

7. **D — Manual adjustment (no model turn)**
   - **Action:** Work from the accepted C layout under **D · App-owned manual adjustment**. For the
     accepted bed, compact desk, and baby bed, test a drag preview and a focused Arrow-key preview;
     use **Revert** between previews as needed. Select **Apply** once on a valid preview, then create
     another preview and select **Revert**.
   - **Expected:** Every accepted furniture type supports pointer and keyboard adjustment. Arrow
     keys move exactly `50 mm` per step, a ghost and live deterministic measurements appear,
     **Apply** updates the accepted layout, and **Revert** preserves the previously accepted layout.
     No Buyer message or Qwen model turn is created.

8. **E — Imported King failure (model turn plus preserved accepted layout)**
   - **Action:** Select **Run next: E · Imported King failure**. The failure automatically opens
     the exact rejected east option: verify the `70 / 250 mm` and `170 / 250 mm` measurements, its
     checks and conflicts, and that rejected furniture is non-interactive. Select
     **Show accepted layout** and then **Inspect rejected option**.
   - **Expected:** The initial post-turn view is the rejected King option. **Show accepted layout**
     reveals the preserved C/D accepted state, including any applied D adjustment,
     **Inspect rejected option** returns to the same rejected details, and both switches are
     immediate without another Buyer message or model turn.

9. **Reset back to no-room intake**
   - **Action:** Select **Reset** once after recording the result.
   - **Expected:** The app returns to **Choose a room to begin** and **Room required**; floor-plan
     preview and geometry, accepted layouts, rejected previews, prompts, transcript state, and
     manual previews clear. The layout model may remain ready, but no room is active.

10. **Use the explicit default room**
    - **Action:** Select **Use default room**.
    - **Expected:** The original verified built-in bedroom becomes active without VLM analysis.
      Developer trace identifies the default-room source, and the room is not labeled as an
      imported result.

11. **Exercise typed input only after room activation**
    - **Action:** In **Manual prompt**, enter
      `Can a Queen-size bed and a desk fit here without blocking the closet or the door?`, then
      select **Send**.
    - **Expected:** The exact prompt appears once and follows the same local planning and
      deterministic geometry path against the active default room.

12. **Exercise voice input only after room activation**
    - **Action:** Select **Prepare Nemotron live** and wait for
      `nemotron-speech-streaming-en-0.6b-generic-cpu:3`, CPU EP, English, and **LIVE** mode. Select
      **Start recording**, speak a request, then select **Stop**.
    - **Expected:** The final transcript enters **Manual prompt** without being submitted. Review
      the text and use **Apply suggested furniture corrections**, **Dismiss**, or
      **Undo suggestions** only when those controls are shown, then select **Send**.
    - **Fallback:** If Nemotron deterministically fails, select
      **Use Whisper Tiny fallback (record then transcribe)** only when the explicit action is
      visible and intentionally selected.

13. **Reset back to no-room intake**
    - **Action:** Select **Reset**.
    - **Expected:** The app returns to **Choose a room to begin** and **Room required**; recording,
      typed input, and A/B/C/E controls are unavailable again.

14. **Shut down cleanly**
    - **Action:** Close the Electron window and wait for `npm run start:built` to return to the
      PowerShell prompt.
    - **Expected:** The window closes without a visible cleanup error and the launch command
      returns to the prompt.

## Exact fixture and provenance

Use `public/assets/floor-plan/sample-master-bedroom.png` or a renamed byte-for-byte copy:

- PNG, `1020 x 1080`
- `194,686` bytes
- SHA-256 `02c90be495d1f64e8adb57c4d00eb81f09fbeb80e885a0066f692026d2145587`

Modified, re-encoded, or arbitrary drawings must reject before canonical geometry is activated.
The app does not process arbitrary floor plans or CAD drawings.

See the [full provenance record](docs/asset-provenance/sample-master-bedroom.md) for the source,
license, transformation, checksum, and review.

## Troubleshooting

| Symptom | Action |
|---|---|
| npm rejects the Node.js or npm version before install or a script run | Install a supported Node.js version matching `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` and npm `>=11.18.0`. Node 23.x and 25.x are intentionally excluded. The validated pair is Node `26.13.0` with npm `11.20.0`; confirm with `node --version` and `npm --version`. |
| `npm install-scripts` is unavailable | Upgrade to npm `>=11.18.0`, rerun `npm ci --no-audit --no-fund`, then approve Electron, esbuild, and Foundry Local SDK. |
| **Prepare offline** or **Load local model** does not reach ready | Stay online, relaunch with `npm run start:built`, select the visible setup control once, and wait for **Local model ready**. Report the visible error if it persists. |
| Wrong UI or an old room is visible | Confirm the window title and page heading say **Enhanced New Home App**, select **Reset**, and relaunch if the no-room state still does not appear. |
| Floor-plan analysis rejects | Use only the committed PNG or a byte-identical copy. Retry **Analyze layout** or select **Use default room**. Report the visible error if it persists. |
| Drag or Arrow keys do nothing | Confirm **Show accepted layout** is active, the app is not busy, and a feasible accepted layout is displayed. |
| **Apply** is disabled | Select **Revert** and try another accepted-furniture move. |
| Microphone is denied, absent, or busy | Grant permission, close the competing app, or use typed input. |
| Nemotron does not prepare or stream | Retry **Prepare Nemotron live** while connected. Use the explicit Whisper Tiny fallback when available, or use typed input. |
| Electron binary or native binding is missing | Run `npm run setup:native`, `npm run build`, and `npm run start:built` again. |
