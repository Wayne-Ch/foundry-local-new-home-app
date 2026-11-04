# 15-minute demo runbook

> For a top-to-bottom first-time playtest with the full A/B/C/D/E story and adjacent stop gates, use
> [PLAYTEST.md](PLAYTEST.md). This runbook remains the full stage choreography.

## Preflight (before entering the room)

Run while connected:

```powershell
cd C:\Users\waynechuang\Projects\foundry-local-ignite-new-home-demo
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run probe:foundry
npm run typecheck
npm run lint
npm test
Remove-Item Env:FOUNDRY_MODEL_ALIAS -ErrorAction SilentlyContinue
Remove-Item Env:FOUNDRY_MODEL_ID -ErrorAction SilentlyContinue
Remove-Item Env:FOUNDRY_EXECUTION_PROVIDER -ErrorAction SilentlyContinue
npm run test:integration
npm run test:nemotron-integration
npm run test:audio-integration
npm run test:floor-plan-integration
npm run build
npm run smoke:electron
npm run probe:floor-plan-ui
npm run probe:reset
npm run probe:stream-owner
npm run probe:microphone-permission
npm run capture:ui
npm run start:built
```

`npm run test:floor-plan-integration` must finish with
`FLOOR_PLAN_INTEGRATION_OK`. It is not replaced by parser mocks: the script uses the packaged PNG,
verifies its exact SHA-256/dimensions/byte length, uses exact
`qwen3.5-0.8b-generic-cpu:3`, CPU/`CPUExecutionProvider`, and the real v2.2.1 image item path. It
also requires white and rectangle-only controls to reject while retaining raw attempts. A failure
writes `artifacts/floor-plan-integration-failure.json`.
After `npm ci`, verify `node_modules\electron\path.txt` exists. If it does not, stop and run
`npm run setup:native`; do not continue with a partially materialized Electron package.

For a benchmark refresh rather than routine stage preflight, run `npm run benchmark:layout`. It
isolates each exact cached candidate in a fresh process, never downloads a model, and rewrites the
ignored evidence file `artifacts/layout-model-benchmark.json`. The command exits nonzero if any
requested candidate misses a required semantic scenario or if no passing selection is produced.

In the app:

1. Select **Load local model**.
2. Confirm the green badge reads
   `qwen3-0.6b · GPU · WebGPUExecutionProvider`.
3. Open **Developer trace** and confirm:
   - SDK `2.2.1`;
   - exact model ID `qwen3-0.6b-generic-gpu:2`;
   - `WebGPUExecutionProvider`;
   - target source `built_in_default` and `stageValidated: true`;
   - model cached, EP registered, local inference ready;
   - external endpoint used: `false`;
   - planning mode: runtime-guided intent-delta JSON Schema to app-derived tool invocation.
4. Select **Prepare Nemotron live** and confirm the separate voice badge shows the exact
   `nemotron-speech-streaming-en-0.6b-generic-cpu:3` ID and **LIVE** mode.
   Confirm the separately labeled Whisper Tiny record-then-transcribe fallback is visible, but do
   not select it for the default stage flow.
5. In **Runtime + locked state**, confirm audio readiness identifies
   `nemotron-speech-streaming-en-0.6b-generic-cpu:3`, CPU EP, English, streaming PCM `ItemQueue`,
   and no external endpoint. The **Speech-to-text** pane remains empty until a final voice turn is
   produced; live revisions remain in the explicitly labeled draft panel.
6. Select **Reset**, then load both models again. Reset returns the enhanced flow to the fresh
   no-room intake state and clears the editable/submitted prompt,
   transcript trace, pending/applied suggestion and undo provenance, manual preview/drag state, and
   recording timers while immediately advancing renderer and controller generation. Select
   **Use default room** before continuing the default-room story, or load and analyze the exact
   fixture before continuing the imported-room story.
   Renderer input is disabled and microphone tracks are released; main revokes the active renderer
   lease while controller reset starts, settles/disposes the bounded native stream, and deletes
   tracked Whisper fallback captures. If native work exceeds the reset bound, the same v0 generation
   stays quarantined until automatic session replacement succeeds or a later explicit Reset starts
   a newer v0 generation.
7. Close the trace for the opening shot.
8. Run one focused real-microphone Turn C buyer-request gate with:

   > Can we do a Queen bed and a desk, and also add a baby bed? A compact desk is fine if needed.
   > Keep the door, closet, and window clear, and leave the 250 mm furniture-clearance rule locked.

   Confirm the raw transcript remains in Developer trace. If the observed demo vocabulary is
   misheard, confirm the exact raw text initially remains in Manual prompt, the banner lists exact
   before/after replacements, and only **Apply suggested furniture corrections** changes the prompt.
   Confirm **Dismiss** leaves raw and **Undo suggestions** restores raw, then use Apply and verify the
   same feasible `queen-crib-compact-v1` result as the scripted Turn C action. Do not regenerate or
   relabel the committed Queen + desk WAV fixture as baby-bed evidence.

Optional enhanced-room preflight:

1. Confirm launch shows the no-room placeholder with conversation controls disabled. Select **Load
   sample floor plan** and confirm the exact NARA `1020 x 1080` preview without room walls, reserved
   zones, or furniture. **Choose exact fixture copy** accepts only byte-identical PNG bytes. Commons
   marks the source `PD-US`; keep this optional fixture private unless legal review approves wider
   use.
2. Select **Analyze layout**. Developer trace must show the exact Qwen3.5 CPU VLM, no external
   endpoint, and the non-forced categories: rectangular room and room label/door/window present.
3. If analysis fails, open **Developer trace -> Runtime + locked state** and record
   `floorPlanVision.attempts[].rawOutput`; never present the default-room fallback as a successful
   import.
4. Select **Use default room** and confirm the original verified bedroom returns at v0.

Observed selected-default integration timings on the validated laptop were 2.332–8.362 seconds per
turn, including bounded application-validation correction when needed. The unrestricted semantic
benchmark measured 5.357 seconds median and 10.216 seconds maximum. Do not start the first
inference while still delivering setup remarks.

The current deterministic audio checkpoints are 31 Nemotron revisions, first partial at 1,288 ms,
stop-to-final at 231 ms, and 1,975 ms cached preparation. The explicit Whisper fallback prepared in
2,901 ms and transcribed the same fixture in 1,203 ms. Treat these as machine-specific preflight
evidence, not stage-time guarantees.

## Minute-by-minute flow

The hands-on story is intentionally explicit:

| Beat | Action | Expected evidence |
|---|---|---|
| A | Queen + desk | Feasible accepted layout |
| B | Change to King | Closet conflict; app asks which preference may change |
| C | Select **Run next: C · Queen + desk + baby bed** or say “Can we do a Queen bed and a desk, and also add a baby bed? A compact desk is fine if needed. Keep the door, closet, and window clear, and leave the 250 mm furniture-clearance rule locked.” | Queen + compact desk + baby bed is feasible; the full new buyer request is visible before Application evidence while door, closet, window, and 250 mm clearance remain locked |
| D | Optionally drag accepted furniture, then Apply or Revert | App-owned 50 mm-grid preview with live deterministic measurements; no Qwen geometry |
| E | Use King while retaining compact desk + baby bed | Controlled failure with exact 70 / 250 mm and 170 / 250 mm gap callouts |

Optional enhanced beat before A:

| Beat | Action | Expected evidence |
|---|---|---|
| I | Load sample floor plan -> Analyze layout | Exact fixture identity passes; preview remains visible; VLM recognizes independent visible rectangle/label/door/window topology; app applies documented NARA scale and canonical geometry |
| I-A | Queen + desk in imported room | Feasible, with entry swing, closet access, and window clearance passing |
| I-B | Change to King | No feasible bounded option; exact 70 / 250 mm furniture gap |
| I-C | Keep Queen, add baby bed, allow compact desk | Feasible; manual 50 mm adjustment remains valid |

Say:

> This is a deliberately constrained image-understanding demo, not arbitrary CAD ingestion. The
> local VLM recognizes topology; the application owns scale, geometry, placement options, and every
> verdict. The fixture is an empty labeled master bedroom; the model does not infer millimetres,
> hinges, coordinates, or clearance.

### Before 0:00 — Prepare real, pre-run state

Before the audience arrives:

1. Start the actual Electron app and load the layout model plus Nemotron.
2. Rehearse one real voice Turn A. Confirm multiple partial revisions appear while speaking, select
   **Stop**, and verify the final transcript in Manual prompt before clicking **Send**.
3. Run Turn B and Turn C with typed/scripted input.
4. Capture clearly labeled pre-run evidence for Turn B and Turn C, including the ASR identity,
   model plan, app validation, and geometry result.
5. Reset the live app to state v0 and load both models for the talk.
6. Confirm the live Developer trace shows exact text/audio readiness, and keep the captured pre-run
   Turn B/Turn C evidence ready for the condensed story.

Turn B and Turn C evidence is real Foundry Local output produced during rehearsal, but it is
**pre-run**. Label it that way. The browser screenshot is backup evidence only, never a live-demo
substitute.

### 0:00–1:00 — Foundry Local overview

Say:

> Foundry Local puts the model and hardware-accelerated runtime inside the application process. In
> this sample the model handles changing language requirements; ordinary application code retains
> authority over state, measurements, tool execution, and the final geometric truth.

Point to the green runtime badge and name:

- SDK `2.2.1`;
- exact local model and WebGPU EP;
- no external inference endpoint;
- verified room data and deterministic SVG.

### 1:00–3:30 — One live voice turn + condensed pre-run states

Do not run all four model turns live in this 2.5-minute segment.

Use exactly one voice input:

1. Select **Start recording**.
2. Say:

   > Can a Queen-size bed and a desk fit here without blocking the closet or the door?

3. While speaking, point to **Live draft — not sent**, its changing subtitle hypothesis, the timer,
   and the exact Nemotron model/mode badge.
4. Select **Stop**.
5. Point out that only the final aggregate transcript appears in Manual prompt and has not run
   anything.
6. Briefly review the text, then select **Send**.
7. While the layout model runs, explain that subtitle partials are display-only. The reviewed final
   text enters the same validated pipeline as typed input, and only a complete Qwen semantic delta
   with `finishReason: "stop"` can be expanded into the full tool input and reach geometry.
8. Show the real Queen + standard desk result.

Then switch to clearly labeled pre-run evidence:

1. Show the recorded Turn B message/trace.
   - King replaced Queen while the desk stayed locked.
   - The known option produced one closet-access conflict.
   - The prior Queen layout remained accepted.
2. Show the recorded Turn C room state.
   - Queen retained.
   - Baby bed added.
   - Desk changed to compact/rotated.
   - All five deterministic checks passed.
   - The visible **Run next: C · Queen + desk + baby bed** action identifies the next buyer request.

Say explicitly for Turn B/C:

> These later states were generated by the real local model and tool during rehearsal. I am replaying
> labeled evidence, not pretending that this navigation is a new inference.

Keep the remaining exact staged dialogue visible:

- “What changes if we use a King-size bed instead?”
- “Can we do a Queen bed and a desk, and also add a baby bed? A compact desk is fine if needed. Keep
  the door, closet, and window clear, and leave the 250 mm furniture-clearance rule locked.”

### 3:30–4:00 — Map the UI to architecture and code

Open **Developer trace** and point left-to-right:

- runtime/model/EP and locked state;
- exact Nemotron identity, live/final timing, and reviewed transcript;
- model-proposed semantic intent delta;
- app validation plus exact tool-input derivation;
- deterministic geometry result;
- SVG/application evidence.

Say:

> The next seven and a quarter minutes show exactly how to build this boundary with Foundry Local.

### 4:00–11:15 — Developer guide and real code walkthrough

Follow [CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md) in its timed order:

1. SDK/model/EP lifecycle.
2. Minimal audio checkpoint: mic permission -> AudioWorklet PCM -> bounded typed IPC ->
   `AudioSession`/`ItemQueue` -> live draft -> final editable prompt.
3. Stateful `ChatSession` request.
4. Runtime JSON Schema guidance and bounded correction.
5. App-side schema/state/intent validation.
6. Deterministic geometry and typed failure.
7. Trace and renderer.

Spend the majority of the talk here. Explain the native `ToolCallItem` evidence and why the final
milestone uses the explicit bounded structured-output escalation rather than hiding an unreliable
function-call path.

### 11:15–11:45 — Optional app-owned manual adjustment

Starting from the accepted Turn C layout:

1. Drag one accepted furniture footprint a single 50 mm grid step, or focus it and use an arrow key.
2. Point to the original-position ghost, live pair measurements, and deterministic checks.
3. If the preview is valid, select **Apply** and show the new application layout version plus
   `application-owned direct manipulation` provenance in Developer trace.
4. Demonstrate **Revert** for a rejected preview if time permits. An invalid drop never replaces the
   accepted model-generated layout.

Say:

> This adjustment is ordinary application interaction. The same geometry validator runs again, but
> the model does not generate or approve the coordinates.

### 11:45–13:30 — Fresh offline input and controlled failure

This is the second live model operation, but it is **typed**, not voice. Keep exactly one voice turn
in the talk.

During rehearsal, disconnect the network adapter manually after preflight. On stage, use the same
offline-ready state if venue policy permits; otherwise state that the adapter-disconnect proof was
performed during rehearsal.

Starting from the pre-run Turn C state, select:

**Run next: E · King controlled failure**

Exact fresh input:

> Use a King bed. Keep the compact desk and baby bed. Keep the door, closet, and window clear.

Expected live result:

- King requested;
- compact desk and baby bed retained;
- two bounded alternatives evaluated;
- no feasible option;
- the rejected east option is displayed automatically with
  `King bed ↔ Compact desk: 70 mm / required 250 mm` and
  `King bed ↔ Baby bed: 170 mm / required 250 mm`;
- that rejected preview shows dimension lines at the exact gaps, only its own furniture-clearance
  failures, the door-open check at `PASS`, and non-interactive furniture;
- **Show accepted layout** reveals the preserved Queen Turn C layout, which remains adjustable;
- **Inspect rejected option** returns to the same rejected east evidence;
- both switches are immediate and do not rerun a turn;
- Developer trace separately labels aggregate reasons across both rejected alternatives, including
  the south option's door-swing conflict;
- response asks which preference may change.

Observed selected-default latency for this controlled failure was 3.467 seconds in the real app
integration. Narrate the visible planning/validation/geometry phases, but never switch to a hidden
canned response. If it does not complete within the segment, state that the live turn is incomplete
and use the recovery buffer.

Say when it completes:

> The failure is a feature. The model cannot fabricate a layout when the tool returns no result.

### 13:30–14:30 — Reusable architecture and platform boundary

Summarize the reusable pattern:

- local model interprets intent;
- a narrow schema carries state references and catalog IDs;
- the app validates and executes;
- deterministic evidence controls the UI;
- honest failure remains recoverable.

Mention Apple-silicon macOS only as a checklist/blocker:

> The architecture and build scripts are cross-platform, and Foundry Local publicly supports
> Apple-silicon macOS, but this milestone has no real Mac validation. I will not claim parity or show
> a second-platform proof until it has actually run there.

If a real second-platform run is validated later, a brief proof may replace part of this minute.

### 14:30–15:00 — Recovery buffer and close

Use the final 30 seconds for any delayed live turn, window focus issue, or audience pause.

Close:

> Foundry Local lets the model handle language locally while normal application code keeps authority
> over state, validation, tools, and safety-critical truth.

## Manual full-offline rehearsal

Do this only as a manual rehearsal step:

1. Complete online preflight and close the app.
2. In Windows Quick Settings, disconnect Wi-Fi/Ethernet. Do not change global firewall policy.
3. Run `npm run start:built`.
4. Select **Load local model**.
5. Select **Prepare Nemotron live**.
6. Confirm both the layout badge and voice badge are ready before claiming offline voice readiness.
7. Record one short Queen + desk request, stop, review the transcript, and send it.
8. Run the typed controlled-failure turn.
9. Confirm both traces show exact cached models and `externalEndpointUsed: false`.
10. Close the app and restore network connectivity.

If catalog initialization requires a refresh after a clean profile, reconnect, run
`npm run probe:foundry`, load the model once, then repeat. Model and EP presence—not catalog metadata
alone—is the offline readiness gate.

## Recovery plan

| Failure | On-stage response |
|---|---|
| Model unavailable | Show the red runtime state; select **Load local model** once. If still unavailable, explain that the demo intentionally has no cloud fallback and move to the saved screenshot plus code. |
| Invalid intent delta | The app retries up to three times. If all fail, show the trace error; do not claim geometry ran. |
| No feasible layout in Beat E | This is the controlled failure. The rejected option appears automatically; verify its exact callouts and non-interactive furniture. Select **Show accepted layout** to verify the retained adjustable layout, then **Inspect rejected option** to return. Neither switch reruns inference; do not fabricate a fit. |
| Missing dimensions | The app returns clarification required; geometry does not run. |
| UI launch problem | Run `npm run start:built` again. The local integration artifact remains evidence, but do not present it as a live turn. |
| GPU/EP issue | Only use a pretested alternate by setting both exact `FOUNDRY_MODEL_ID` and `FOUNDRY_EXECUTION_PROVIDER`. The badge will identify it as an override and, unless it is the exact default pair, as not stage-validated. Do not improvise a new target on stage. |
| Microphone permission denied / no mic | State the error shown by the app and use the existing typed Turn A prompt. Never bypass transcript review or switch to an online speech service. |
| Nemotron unavailable or live stream fails | If the labeled **Whisper Tiny fallback (record then transcribe)** action is present and Whisper was prepared during preflight, select it explicitly and record again. Otherwise use typed input. Never silently switch models or use an online speech service. |
| Whisper fallback unavailable | Keep typed input. The voice badge must not claim fallback readiness. |
| No feasible layout after Turn B | Select **Run next: C · Queen + desk + baby bed**, or submit the equivalent full buyer request. The action enters the same Qwen/app validation pipeline as typed input; nothing runs automatically. |
| Empty/incorrect transcript | Review the exact raw draft and visible replacement diff. Apply explicitly, Dismiss, edit, or Undo before Send. The raw ASR transcript remains in Developer trace and the app never auto-rewrites or auto-submits it. |

There is no canned natural-language fallback. The visible response is explicitly labeled
**Application evidence**.
