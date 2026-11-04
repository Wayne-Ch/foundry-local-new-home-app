# Enhanced New Home App Demo and Test Guide

This guide covers a complete first-time UI test and an optional 15-minute presentation flow. Use
the [README quick start](README.md#quick-start) to install, build, and launch the app.

## Prerequisites

- Complete the README quick start with Node.js `^22.12.0 || ^24.0.0 || >=26.0.0` and
  npm `>=11.18.0`. Known-good versions are Node `26.13.0` and npm `11.20.0`.
- Keep the app online for first local model/runtime preparation.
- Use a WebGPU-capable graphics adapter with a current driver.
- A microphone is needed only for the optional voice-input steps.

## Prepare the app

1. Complete the README setup and run `npm run start:built`.
2. Confirm the window title is **Enhanced New Home App**.
3. Confirm the initial state shows **Choose a room to begin**, **Room required**,
   **Load sample floor plan**, **Choose exact fixture copy**, **Analyze layout**, and
   **Use default room**.
4. Confirm conversation and recording actions are unavailable until a room is active.

Use the visible layout-model control:

| Setup state | Visible control | Action |
|---|---|---|
| Cold, empty shared model cache | **Prepare offline** | Select it while online and wait for preparation to finish. |
| Warm shared cache with a fresh product root | **Load local model** | Select it to load the cached model. |
| Model cached; product-specific WebGPU provider registration still needed | **Load local model** | Select it; provider registration does not change the label. |
| Loaded READY state | **Local model ready** | Continue when the green ready state is visible. |

## Exact sample floor-plan fixture

The guided imported-room flow uses
[`public/assets/floor-plan/sample-master-bedroom.png`](public/assets/floor-plan/sample-master-bedroom.png):

- PNG, `1020 x 1080`
- `194,686` bytes
- SHA-256 `02c90be495d1f64e8adb57c4d00eb81f09fbeb80e885a0066f692026d2145587`

A renamed byte-identical copy is accepted. Modified, re-encoded, or arbitrary images are rejected.
The source is a NARA-held U.S. federal record. Wikimedia Commons marks it `PD-US`; public-domain
status may differ outside the United States. See the
[fixture provenance record](docs/asset-provenance/sample-master-bedroom.md).

## Complete manual test

Follow the required `A -> B -> C -> D -> E` order.

### 1. Stage the floor-plan preview

**Action:** Select **Load sample floor plan**.

**Expected:** A `1020 x 1080` preview appears with a `Preview only` status. **Analyze layout**
becomes available. Room walls, zones, furniture, and conversation controls remain absent.

**If this fails:** Use the packaged PNG or a byte-identical copy. Do not continue with a modified
image.

### 2. Analyze and import the room

**Action:** Select **Analyze layout** and wait for completion.

**Expected:** After analysis succeeds, the app imports and activates the bedroom. The room includes
the visible door, window, closet/access area, and empty furniture canvas. Conversation controls
become available.

**If this fails:** Retry with the exact fixture. **Use default room** remains available as a
separate built-in-room path.

### 3. Prepare the layout model

**Action:** Follow the setup-control table and wait for **Local model ready**.

**Expected:** The ready state is green and the imported-room A/B/C/E controls are available.

### 4. A - Imported Queen and desk

**Action:** Select **A · Imported Queen + desk**.

**Expected:** A Queen bed and standard desk form a feasible accepted layout. Door, closet, window,
and `250 mm` furniture-clearance checks pass.

### 5. B - Imported King conflict

**Action:** Select **B · Imported King conflict**.

**Expected:** The rejected King option opens automatically with a visible
`70 mm / required 250 mm` gap. Rejected furniture is non-interactive.

Select **Show accepted layout** and confirm the earlier Queen layout remains adjustable. Select
**Inspect rejected option** and confirm the same King result returns without another Buyer message
or loading turn.

### 6. C - Queen, compact desk, and baby bed

**Action:** Select **C · Imported Queen + desk + baby bed**.

**Expected:** Queen + compact desk + baby bed is feasible and becomes the accepted layout while the
door, closet, window, and `250 mm` clearance rule remain active.

### 7. D - App-owned manual adjustment

**Action:** Drag an accepted furniture item or focus it and press an Arrow key. Test each accepted
furniture type. Use **Revert** between previews as needed. Apply one valid preview, create another
preview, and revert it.

**Expected:**

- Arrow keys move furniture by `50 mm`.
- The preview shows the original position and live measurements.
- **Apply** is available only for a valid preview and creates a new accepted layout version.
- **Revert** restores the previously accepted layout.
- No Buyer message or planning turn is created.

### 8. E - Imported King controlled failure

**Action:** Select **E · Imported King failure**.

**Expected:** The rejected east option opens automatically with:

- `King bed ↔ Compact desk: 70 mm / required 250 mm`
- `King bed ↔ Baby bed: 170 mm / required 250 mm`

Rejected furniture remains non-interactive. **Show accepted layout** reveals the preserved Queen +
compact desk + baby bed layout, including the applied D adjustment. **Inspect rejected option**
returns to the same rejected King result without another turn.

### 9. Reset

**Action:** Select **Reset**.

**Expected:** The app returns to **Choose a room to begin** and **Room required**. The preview,
room, furniture, accepted/rejected results, prompts, transcript, and manual previews clear.

### 10. Exercise the built-in room

**Action:** Select **Use default room**.

**Expected:** The built-in bedroom appears without floor-plan analysis. The sample preview and
imported-room layout remain absent.

### 11. Exercise typed input

Enter:

> Can a Queen-size bed and a desk fit here without blocking the closet or the door?

Select **Send**.

**Expected:** The prompt appears once and produces the visible default-room layout result.

### 12. Exercise voice input

1. Select **Prepare Nemotron live** and wait for the voice badge to show **LIVE**.
2. Select **Start recording**, speak a short room request, and select **Stop**.
3. Review the final text in **Manual prompt**.
4. If suggestion controls appear, test **Apply suggested furniture corrections**, **Dismiss**, or
   **Undo suggestions**.
5. Select **Send** only after the text is ready.

**Expected:** Live text remains a draft. **Stop** does not submit. The final transcript stays
editable until **Send**.

If live speech fails and **Use Whisper Tiny fallback (record then transcribe)** is available, select
it explicitly and record again. Otherwise continue with typed input.

### 13. Reset and shut down

Select **Reset**, confirm the no-room state, close the Electron window, and wait for
`npm run start:built` to return to the PowerShell prompt without a cleanup error.

## Optional offline rehearsal

1. Complete the online preparation and close the app.
2. Disconnect Wi-Fi/Ethernet through Windows Quick Settings.
3. Run `npm run start:built`.
4. Select **Use default room**.
5. Select **Load local model** when the cached runtime is not ready.
6. Select **Prepare Nemotron live**.
7. Run one short voice request and one typed controlled-failure request.
8. Close the app and restore network connectivity.

## Optional 15-minute presentation outline

### Before the audience arrives

- Start the built app and prepare the layout model and Nemotron.
- Rehearse one voice Queen + desk request.
- Run A, B, and C once so their visible states are familiar.
- Reset, select the intended room path, and leave the app ready.

| Time | Focus |
|---|---|
| 0:00-2:30 | Preview the exact fixture, select **Analyze layout**, and show the imported room. |
| 2:30-5:30 | Run A, then show B's rejected King option and preserved accepted Queen layout. |
| 5:30-8:30 | Run C and perform D with one valid 50 mm Apply and one Revert. |
| 8:30-11:00 | Run E and switch between the rejected option and preserved accepted layout. |
| 11:00-13:00 | Reset, show **Use default room**, and send one typed request. |
| 13:00-14:30 | Optionally demonstrate reviewed voice input or the explicit Whisper fallback. |
| 14:30-15:00 | Reset to the no-room state and close the app normally. |

## Recovery and troubleshooting

| Problem | Recovery |
|---|---|
| The cold cache shows **Prepare offline** | Stay online, select it, and wait for preparation to finish. |
| A cached runtime shows **Load local model** | Select it; this is the expected control until the model is loaded. |
| Floor-plan analysis rejects | Use the packaged PNG or a byte-identical copy, retry **Analyze layout**, or select **Use default room**. |
| The layout model is unavailable | Select **Retry local setup** once while connected. The app has no cloud inference fallback. |
| Drag or Arrow keys do nothing | Select **Show accepted layout**, wait until the app is idle, and confirm an accepted layout is visible. |
| **Apply** is disabled | Revert the rejected or stale preview and try another accepted-furniture move. |
| Microphone permission is denied or no microphone is available | Grant permission or continue with typed input. |
| Nemotron does not prepare or stream | Retry while connected, select the explicit Whisper Tiny fallback if available, or use typed input. |
| Electron or the native binding is missing | Run `npm run setup:native`, rebuild, and relaunch. |

## Product limits during the demo

- The imported-room flow supports only the exact packaged fixture or a byte-identical renamed copy.
- The app evaluates bounded known furniture options; it does not perform general CAD ingestion or
  global layout optimization.
- Audio input is English only.
- The demo covers furniture footprints and clearances, not structural, accessibility-certification,
  clinical, or infant-safety decisions.
