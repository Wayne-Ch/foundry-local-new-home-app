# Enhanced New Home playtest guide

Use this guide for the
[`feature/enhanced-new-home`](https://github.com/Wayne-Ch/foundry-local-new-home-demo/tree/feature/enhanced-new-home)
branch. **`main` is not the Enhanced New Home flow.**

This is the top-to-bottom first-time tester route. Complete the guided flow in order; do not skip
from C to E.

## Launch and establish a fresh state

### If the app is already open

Keep the current Electron window open. Select **Reset**, wait for **Choose a room to begin** and
**Room required**, confirm that the room canvas has no walls, reserved zones, or furniture, and then
start at Step 1 below. Rebuild or relaunch only if that fresh-state checkpoint fails.

### If the app is not open

From an existing checkout:

```powershell
git fetch origin
git switch feature/enhanced-new-home
git pull --ff-only origin feature/enhanced-new-home
git branch --show-current
```

The final command must print `feature/enhanced-new-home`.

For a first launch or a checkout whose dependencies changed:

```powershell
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run build
npm run start:built
```

For an unchanged checkout that was already built:

```powershell
npm run start:built
```

After launch, select **Reset** if any earlier room, conversation, evidence, or manual preview is
visible. The fresh state must show **Choose a room to begin**, **Room required**, **Load sample floor
plan**, **Choose exact fixture copy**, **Analyze layout**, and **Use default room**. Conversation and
recording actions remain unavailable until a room is activated.

## Quick guided playtest

> **Why the UI has A/B/C/E buttons:** A, B, C, and E are scripted Qwen model turns. D is the
> application-owned **D · App-owned manual adjustment** beat, performed directly on accepted
> furniture with drag, keyboard, **Apply**, and **Revert**. There is intentionally no scripted D
> button and no model inference in D, but D is a required step in this guide.

1. **Stage the exact floor-plan fixture**
   - **Action:** Select **Load sample floor plan** once.
   - **Expected:** A `1020 x 1080` preview appears. The status begins with `Preview only`, **Analyze layout** becomes available, and the room canvas still has no walls, reserved zones, or furniture.
   - **Stop if:** Geometry appears before analysis, the preview is not `1020 x 1080`, the identity gate rejects the packaged fixture, or conversation controls become available while no room is active.

2. **Analyze and activate the imported room**
   - **Action:** Select **Analyze layout**, wait for completion, then open **Developer trace**.
   - **Expected:** The trace identifies `qwen3.5-0.8b-generic-cpu:3`, CPU / `CPUExecutionProvider`, SDK `2.2.1`, and no external endpoint. It independently reports `roomShape=rectangle` plus room label, door opening, and window opening as `present`. Only after that success, imported NARA room geometry appears with the documented `3650 x 3950 mm` application-owned scale and canonical door, window, closet, and clearance geometry.
   - **Stop if:** Analysis fails, remains uncertain, reports a missing visible feature, activates geometry before success, or silently substitutes default-room geometry. **Use default room** is an explicit fallback, not a successful import.

3. **Prepare the layout model**
   - **Action:** Select **Prepare offline** when the exact model is not cached, or **Load local model** when it is cached. If the button already says **Local model ready**, do not select it again.
   - **Expected:** The green badge reads `qwen3-0.6b · GPU · WebGPUExecutionProvider`. **Developer trace** identifies `qwen3-0.6b-generic-gpu:2`, SDK `2.2.1`, `built_in_default`, `stageValidated: true`, and external endpoint `false`. The next-turn control reads **Run next: A · Imported Queen + desk**.
   - **Stop if:** The badge shows an override, the configured model or provider is unavailable, the trace shows an external endpoint, or the imported A/B/C/E buttons do not appear.

4. **A — Imported Queen + desk (model turn)**
   - **Action:** Select **A · Imported Queen + desk** and wait for the model turn to finish.
   - **Expected:** The Buyer request asks about a Queen-size bed and desk in the imported room. A Queen bed plus standard desk is feasible, becomes the accepted layout, and passes the locked door, closet, window, and furniture-clearance checks.
   - **Stop if:** The turn rejects, different furniture is accepted, geometry appears before model and application validation finish, or the Buyer request is duplicated in **Application evidence**.

5. **B — Imported King conflict (model turn plus rejected/accepted inspection)**
   - **Action:** Select **B · Imported King conflict**. After the rejection appears, select **Inspect rejected option**, confirm the preview is non-interactive, and then select **Show accepted layout**.
   - **Expected:** The King replacement is rejected with the exact `70 mm / required 250 mm` furniture-clearance evidence. The accepted Queen + standard desk layout remains preserved. Both view switches are immediate and do not start another inference turn.
   - **Stop if:** B is feasible, the King replaces the accepted Queen layout, rejected furniture can be dragged or keyboard-moved, **Apply** can accept rejected furniture, or either view switch reruns inference.

6. **C — Imported Queen + desk + baby bed (model turn)**
   - **Action:** Select **C · Imported Queen + desk + baby bed** and wait for the model turn to finish.
   - **Expected:** The Buyer request asks for Queen + desk + baby bed, permits a compact desk, and keeps the door, closet, window, and `250 mm` furniture-clearance rule locked. Queen + compact desk + baby bed is feasible and becomes the accepted layout.
   - **Stop if:** The request loses any locked constraint, baby bed is missing, a standard desk is forced when the compact option is required, or the result does not become the accepted layout.

7. **D — App-owned manual adjustment (no model turn)**
   - **Action:** Work from the accepted C layout under **D · App-owned manual adjustment**. For the accepted bed, compact desk, and baby bed, test a drag preview and a focused Arrow-key preview; use **Revert** between previews as needed. Select **Apply** once on a valid preview, then create another preview and select **Revert**.
   - **Expected:** Every accepted furniture type supports pointer and keyboard adjustment. Arrow keys move exactly `50 mm` per step, a ghost and live deterministic measurements appear, **Apply** creates a new accepted application layout version, and **Revert** preserves the previously accepted layout. No Buyer message or Qwen inference turn is created.
   - **Stop if:** A scripted D model button appears, any accepted furniture type cannot be dragged or keyboard-moved, a rejected-option preview is editable, an Arrow key moves by a value other than `50 mm`, **Apply** is enabled for an invalid preview, or manual adjustment starts model inference.

8. **E — Imported King failure (model turn plus preserved accepted layout)**
   - **Action:** Select **E · Imported King failure**. After the controlled failure appears, select **Inspect rejected option**, then select **Show accepted layout**.
   - **Expected:** King + compact desk + baby bed has no feasible bounded option. The rejected east option shows `70 / 250 mm` and `170 / 250 mm` gaps. The accepted Queen + compact desk + baby bed layout, including any D adjustment that was applied, remains active and adjustable. The view switches do not rerun inference.
   - **Stop if:** E becomes feasible, the rejected King layout becomes accepted, the D-adjusted accepted state is lost, the exact gaps are absent, rejected furniture is interactive, or either view switch starts another model turn.

9. **Confirm the evidence boundary**
   - **Action:** Review the conversation, **Application evidence**, and **Developer trace** after A through E.
   - **Expected:** Each **Buyer** request appears once. **Application evidence** contains only the deterministic conclusion and does not repeat the Buyer request. **Developer trace** retains the exact submitted request, model and execution-provider identity, model intent evidence, application validation, derived tool input, geometry result, and D's application-owned provenance.
   - **Stop if:** The Buyer request appears twice, model prose is presented as deterministic geometry truth, application evidence contains a copied request, or accepted and rejected option evidence is mixed.

10. **Reset back to no-room intake**
    - **Action:** Select **Reset** once after recording the result.
    - **Expected:** The app returns to **Choose a room to begin** and **Room required**; floor-plan preview and geometry, accepted/rejected evidence, prompts, transcript state, and manual previews clear. The stable layout model may remain ready, but no room is active.
    - **Stop if:** Any room geometry, fixture preview, furniture, accepted/rejected evidence, pending manual preview, or enabled room conversation remains.

11. **Shut down cleanly**
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

The optional fixture is derived from a NARA-held U.S. federal record. Wikimedia Commons marks the
source `PD-US`, but public-domain status can differ outside the United States. Keep the fixture in
the private demo unless legal review approves wider distribution. See the
[full provenance record](docs/asset-provenance/sample-master-bedroom.md).

## Optional voice check

Run this only after the main linear flow:

- Select **Prepare Nemotron live** and confirm
  `nemotron-speech-streaming-en-0.6b-generic-cpu:3`, CPU EP, English, and **LIVE** mode.
- Select **Start recording**, speak a request, and select **Stop**.
- Confirm the final transcript enters **Manual prompt** without being submitted.
- Review the raw text. Use **Apply suggested furniture corrections**, **Dismiss**, or
  **Undo suggestions** when those exact controls are shown, then select **Send**.
- If Nemotron fails, keep typed input unless the explicit
  **Use Whisper Tiny fallback (record then transcribe)** action is visible and the fallback is
  intentionally selected. The app must never silently choose Whisper or an online speech service.

## Troubleshooting

| Symptom | Action |
|---|---|
| Wrong UI or an old room is visible | Confirm `git branch --show-current` is `feature/enhanced-new-home`, select **Reset**, and relaunch only if the no-room checkpoint still fails. |
| Layout model will not prepare | Connect for first preparation, clear unintended `FOUNDRY_MODEL_ALIAS`, `FOUNDRY_MODEL_ID`, or `FOUNDRY_EXECUTION_PROVIDER` variables, then select **Retry local setup**. Use `npm run probe:foundry` for a focused runtime check. |
| Floor-plan analysis rejects | Use only the committed PNG or a byte-identical copy. Read `floorPlanVision.attempts[].rawOutput` in **Developer trace**. Retry **Analyze layout** or explicitly select **Use default room**; never relabel fallback geometry as imported geometry. |
| Drag or Arrow keys do nothing | Confirm **Show accepted layout** is active, the app is not busy, and a feasible accepted layout is displayed. |
| **Apply** is disabled | The preview is rejected, stale, or an operation is active. Select **Revert** and try another accepted-furniture move. |
| Microphone is denied, absent, or busy | Grant permission or close the competing app. Typed input remains valid; do not bypass transcript review. |
| Nemotron does not prepare or stream | Retry **Prepare Nemotron live** while connected. Use the explicit Whisper action only if it is visible and pretested; otherwise use typed input. |
| Electron binary or native binding is missing | Confirm `node_modules\electron\path.txt` exists. Run `npm run setup:native`, then `npm run build` and `npm run start:built`. |

## Detailed pass / stop gate

Record a pass only when all of these are visible:

- `feature/enhanced-new-home`, fresh no-room launch, and preview-only sample load;
- successful exact-fixture analysis before imported geometry appears;
- exact local VLM and layout-model identities with no external endpoint;
- A and C feasible; B and E rejected;
- D completed through direct manipulation with no scripted D button and no inference;
- accepted layout preserved across B and E, including an applied D adjustment;
- accepted/rejected views switch without inference and rejected furniture remains non-interactive;
- accepted bed, compact desk, and baby bed all support drag plus `50 mm` Arrow-key previews;
- **Apply** creates an accepted application layout version and **Revert** discards a preview;
- Buyer request appears once, **Application evidence** is conclusion-only, and
  **Developer trace** retains exact request/model/application evidence;
- **Reset** returns to no-room intake and the Electron window closes cleanly.

Stop and record a failure if the fixture identity or analysis gate fails, default geometry appears
without **Use default room**, the wrong model or execution provider is active, A/B/C/E changes
verdict, D invokes Qwen, any rejected request replaces the accepted layout, accepted/rejected
evidence is mixed, or reset/shutdown leaves stale owned state. Do not reinterpret any of those
results as a successful Enhanced New Home run.
