# Enhanced New Home playtest guide

Use this guide for the
[`feature/enhanced-new-home`](https://github.com/Wayne-Ch/foundry-local-new-home-demo/tree/feature/enhanced-new-home)
branch. **`main` is not the Enhanced New Home flow** and must not be used for this playtest.

This is a constrained local-AI demo. Passing means the visible model evidence and the
application-owned geometry agree. A floor-plan analysis error, uncertain result, or explicit default
room is not a successful import.

## 1. Prerequisites and launch

- Windows x64 is the validated platform. Foundry Local v2.2.1 also supports Windows Arm64, Linux,
  and Apple-silicon macOS, but those paths were not validated for this demo.
- Node.js 20 or newer and npm.
- Network access for the first exact-model and execution-provider preparation unless they are
  already cached.
- A microphone only if testing voice input. The A/B/C/E story also works with the scripted buttons
  or typed prompts.

Fresh clone:

```powershell
git clone https://github.com/Wayne-Ch/foundry-local-new-home-demo.git
Set-Location .\foundry-local-new-home-demo
git fetch origin feature/enhanced-new-home
git switch --create feature/enhanced-new-home --track origin/feature/enhanced-new-home
```

Existing checkout:

```powershell
git fetch origin
git switch feature/enhanced-new-home
git pull --ff-only origin feature/enhanced-new-home
```

Verify the branch before continuing:

```powershell
git branch --show-current
```

The output must be `feature/enhanced-new-home`. Then install, materialize the native runtime, build,
and launch:

```powershell
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run build
npm run start:built
```

For later launches from an unchanged, already-built checkout, the fast path is:

```powershell
Set-Location "C:\path\to\foundry-local-new-home-demo"
npm run start:built
```

Use `npm start` instead when you want one command that rebuilds and then launches.

## 2. Confirm the true fresh state

A fresh launch, **Reset**, or full renderer reload must show:

- **Choose a room to begin** and **Room required**;
- no room walls, reserved zones, or furniture;
- **Load sample floor plan**, **Choose exact fixture copy**, **Analyze layout**, and
  **Use default room**;
- layout conversation and recording actions unavailable until a room is explicitly activated.

**Stop** if geometry is already visible. Do not continue from a stale accepted room.

## 3. Import the one supported floor plan

1. Select **Load sample floor plan**.
2. Confirm the `1020 x 1080` image preview appears while the room canvas still has no walls,
   reserved zones, or furniture. Loading is preview-only.
3. Select **Analyze layout**.
4. Wait for a successful analysis. Developer Trace must identify
   `qwen3.5-0.8b-generic-cpu:3`, CPU / `CPUExecutionProvider`, no external endpoint, and these
   independent facts:
   - `roomShape=rectangle`
   - room label `present`
   - door opening `present`
   - window opening `present`
5. Only after that success, confirm imported NARA room geometry appears. The local VLM recognized
   visible topology; the application applied the documented `3650 x 3950 mm` scale and canonical
   door, window, closet, and clearance geometry.

The only supported file is
[`public/assets/floor-plan/sample-master-bedroom.png`](public/assets/floor-plan/sample-master-bedroom.png),
or a renamed byte-for-byte copy of it:

- PNG, `1020 x 1080`
- `194,686` bytes
- SHA-256 `02c90be495d1f64e8adb57c4d00eb81f09fbeb80e885a0066f692026d2145587`

Modified, re-encoded, or arbitrary drawings must reject before canonical geometry is activated.
This is not general floor-plan or CAD support.

If analysis fails, the preview may remain, but the room must stay inactive and the UI must say that
the import failed closed. Inspect `floorPlanVision.attempts[].rawOutput` in Developer Trace, then
retry **Analyze layout** with the exact fixture or select **Use default room**. The default room is
an explicit fallback, not evidence that import succeeded. There is no silent default geometry.

The optional fixture is derived from a NARA-held U.S. federal record. Commons marks it `PD-US`, but
public-domain status can differ outside the United States. Keep this optional fixture in the private
demo unless legal review approves wider distribution. See the
[full provenance record](docs/asset-provenance/sample-master-bedroom.md).

## 4. Prepare the layout model

1. Select **Load local model**. On a cold cache the button may first read **Prepare offline**.
2. Wait for the green badge:
   `qwen3-0.6b · GPU · WebGPUExecutionProvider`.
3. In Developer Trace, confirm exact model ID `qwen3-0.6b-generic-gpu:2`, SDK `2.2.1`,
   `built_in_default`, `stageValidated: true`, and external endpoint `false`.

Do not treat an override, unavailable model, or incomplete response as the validated flow.

## 5. Run the exact A/B/C/E story

Use the four scripted step buttons so each request enters the same real Qwen, application-validation,
and geometry pipeline as typed input.

| Beat | Action | Required visible result |
|---|---|---|
| A | Select **A · Imported Queen + desk**. | A Queen bed plus standard desk is feasible and becomes the accepted layout. |
| B | Select **B · Imported King conflict**. | The King replacement is rejected with the exact `70 mm / required 250 mm` furniture-clearance evidence. The accepted Queen layout remains preserved. |
| C | Select **C · Imported Queen + desk + baby bed**. | The new Buyer request asks for Queen + desk + baby bed, permits a compact desk, and keeps door, closet, window, and 250 mm clearance locked. Queen + compact desk + baby bed is feasible and becomes the accepted layout. |
| E | Select **E · Imported King failure**. | King + compact desk + baby bed has no feasible bounded option. The rejected east option shows `70 / 250 mm` and `170 / 250 mm` gaps; the accepted C layout remains active. |

The exact C request is:

> Can we do a Queen bed and a desk in the imported bedroom, and also add a baby bed? A compact desk
> is fine if needed. Keep the door, closet, and window clear, and leave the 250 mm
> furniture-clearance rule locked.

After B or E:

1. Select **Inspect rejected option** to see that exact rejected option, its checks, measurements,
   and conflicts.
2. Confirm rejected furniture cannot be dragged, keyboard-moved, or applied.
3. Select **Show accepted layout** to return to the preserved accepted layout.
4. Confirm both switches are immediate and do not rerun inference.

**Stop** if B or E is shown as feasible, if a rejected request replaces the accepted layout, or if
the accepted/rejected switch starts another model turn.

## 6. Check direct manipulation and evidence boundaries

Starting from the accepted C layout:

1. Drag the accepted bed, compact desk, or baby bed. A ghost preview and live deterministic
   measurements must appear.
2. Click an accepted furniture item to focus it, then press an Arrow key. Each keyboard step is
   exactly `50 mm`.
3. Repeat with the bed, desk, and baby bed. All three accepted item types must be pointer- and
   keyboard-adjustable.
4. For a valid preview, select **Apply**. The app creates a new accepted application layout version
   without asking Qwen for coordinates.
5. For an unwanted or invalid preview, select **Revert**. An invalid preview must not replace the
   accepted layout, and **Apply** must remain disabled.

For every turn, verify the conversation and trace boundary:

- **Buyer** shows the submitted request once.
- **Application evidence** shows only the deterministic conclusion; it must not repeat the Buyer
  request.
- **Developer Trace** retains the exact submitted request, model/EP identity, model intent evidence,
  application validation, derived tool input, and geometry result.

## 7. Optional voice check

1. With a room active and the layout model ready, select **Prepare Nemotron live**.
2. Confirm exact model `nemotron-speech-streaming-en-0.6b-generic-cpu:3`, CPU EP, English, and
   **LIVE** mode.
3. Select **Start recording**, speak a request, then select **Stop**.
4. Confirm the final transcript enters the editable Manual prompt and is not submitted.
5. Review or explicitly apply any visible furniture correction, then select **Send**.

If microphone permission or Nemotron fails, use typed input. Select
**Whisper Tiny fallback (record then transcribe)** only when that explicit action is visible and you
intend to switch models. The app must never silently select Whisper or an online speech service.

## 8. Reset, reload, and clean shutdown

- **Reset** immediately returns to the no-room intake state, clears floor-plan preview and geometry,
  accepted/rejected evidence, prompts, transcript state, and manual previews, and cancels active
  work. It unloads selected audio and vision resources; the stable layout model may remain ready.
- A renderer reload must revoke active recording/import ownership and return to no-room intake.
- For a full model unload, close the Electron window and wait for `npm run start:built` to return.
  Clean quit disposes sessions, unloads both models, and disposes the Foundry Local manager.
- Relaunch only from the feature checkout:

```powershell
Set-Location "C:\path\to\foundry-local-new-home-demo"
npm run start:built
```

## Troubleshooting

| Symptom | Action |
|---|---|
| Wrong UI or room is already present | Confirm `git branch --show-current` is `feature/enhanced-new-home`, run `npm run build`, then relaunch. |
| Layout model will not prepare | Connect for first preparation, clear unintended `FOUNDRY_MODEL_ALIAS`, `FOUNDRY_MODEL_ID`, or `FOUNDRY_EXECUTION_PROVIDER` variables, then select **Retry local setup**. Use `npm run probe:foundry` for a focused runtime check. |
| Floor-plan analysis rejects | Use only the exact committed PNG or a byte-identical copy. Read Developer Trace attempts. Retry analysis or explicitly choose the default room; never relabel fallback geometry as imported geometry. |
| Microphone is denied, absent, or busy | Grant permission or close the competing app. Typed input remains valid. Do not bypass transcript review. |
| Nemotron does not prepare or stream | Retry **Prepare Nemotron live** while connected. Use the explicit Whisper action only if offered and pretested; otherwise use typed input. |
| Drag or Arrow keys do nothing | Confirm a feasible accepted layout is displayed and the app is not busy. If a rejected preview is open, select **Show accepted layout** first. |
| **Apply** is disabled | The preview is rejected, stale, or an operation is still active. Use **Revert** and try another accepted-furniture move. |
| Electron binary or native binding is missing | Confirm `node_modules\electron\path.txt` exists. Run `npm run setup:native`, then `npm run build` and `npm run start:built`. |

## Final pass / stop gate

Record a pass only when all of these are visible:

- feature branch, fresh no-room launch, and preview-only sample load;
- successful exact-fixture analysis before imported geometry appears;
- exact local VLM/layout-model identity and no external endpoint;
- A and C feasible; B and E rejected;
- accepted layout preserved across rejection and accepted/rejected views switch without inference;
- accepted bed, desk, and baby bed support drag plus `50 mm` Arrow-key previews;
- rejected furniture is non-interactive;
- Buyer request appears once, Application evidence is conclusion-only, and Developer Trace retains
  exact request/model evidence.

Stop and record a failure if analysis rejects or remains uncertain, default geometry appears without
the explicit **Use default room** action, the wrong model/EP is active, a required verdict flips, or
the accepted/rejected evidence boundary is broken. Do not reinterpret any of those results as a
successful enhanced-room run.
