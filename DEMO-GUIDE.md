# New Home App Demo and Test Guide

Use this guide after completing the setup in [README.md](README.md). It combines the first manual
test with the live stage sequence for the Standard `main` experience.

## Prerequisites

- Complete the README quick start with Node.js `^22.12.0 || ^24.0.0 || >=26.0.0` and
  npm `>=11.18.0`. Known-good versions are Node `26.13.0` and npm `11.20.0`.
- Keep the app online for first model preparation.
- Use a WebGPU-capable graphics adapter with a current driver.
- A microphone is optional; the scripted and typed flows do not require one.

If the built app is not already running, launch it from the repository root:

```powershell
npm run start:built
```

First preparation can take several minutes while model and execution-provider assets download.
Keep the app open and online until the green **Local model ready** state appears.

The visible setup control follows these states:

- **Cold, empty shared model cache**: select **Prepare offline**.
- **Warm shared cache with a fresh product root**: select **Load local model**.
- **Model cached; product-specific WebGPU provider registration still needed**: select
  **Load local model**.
- **Loaded READY state**: confirm **Local model ready** and continue.

Before presenting, confirm:

- the window and page title are **New Home App**;
- the verified built-in bedroom is already visible;
- the runtime identifies `qwen3-0.6b-generic-gpu:2` with `WebGPUExecutionProvider`;
- the green **Local model ready** state is visible.

## Manual test and stage sequence

### A — Queen bed and desk

1. Select **Run next: A · Queen + desk**.
2. Confirm a Queen bed and rotated standard desk are accepted.
3. Confirm the Buyer request appears once and the Application message shows the conclusion.

### B — King conflict

1. Select **Run next: B · King conflict**.
2. Confirm a King rejected preview appears automatically with **Rejected preview · not accepted**.
3. Confirm layout A remains accepted and rejected furniture cannot be focused, dragged, or applied.
4. Select **Show accepted layout**, then **Inspect rejected option**.
5. Confirm the accepted layout and rejected preview alternate without adding messages or starting
   another planning request.

### C — Queen bed, compact desk, and baby bed

1. Select **Run next: C · Queen + desk + baby bed**.
2. Confirm the accepted layout contains a Queen bed, compact desk, and baby bed.
3. Confirm the visible checks include the door, closet, window, and 250 mm furniture clearance.

### D — Manual adjustment

1. Drag each accepted item 50 mm to the right, verify the preview, and select **Revert**.
2. Focus each item and press Right Arrow once to create a 50 mm keyboard preview.
3. Revert the Queen-bed and baby-bed previews.
4. Apply the compact-desk preview.
5. Confirm Apply keeps the compact desk at the previewed position, Revert restores the other items,
   and no Buyer/Application message or planning request is added.

### E — Controlled failure

1. Select **Run next: E · King controlled failure**.
2. Confirm a King rejected preview appears automatically.
3. Confirm the accepted C/D layout remains unchanged and rejected furniture is non-interactive.
4. Switch between **Show accepted layout** and **Inspect rejected option** and confirm no new
   messages or planning request appears.

## Typed input

1. Select **Reset**.
2. In **Manual prompt**, enter:

   ```text
   Can a Queen-size bed and a desk fit here without blocking the closet or the door?
   ```

3. Select **Send**.
4. Confirm the exact request appears once and the Queen + desk result is accepted.

Reset keeps the built-in room and prepared model while clearing the conversation, layouts, manual
previews, prompt, transcript, and speech suggestions.

## Optional voice input

1. Select **Reset**, then **Prepare Nemotron live**.
2. Wait for `nemotron-speech-streaming-en-0.6b-generic-cpu:3` in **LIVE** mode.
3. Select **Start recording**, speak an A, C, or E request, then select **Stop**.
4. Review the editable transcript and any visible furniture correction suggestion.
5. Apply or dismiss the suggestion, edit the text if needed, then select **Send**.
6. Confirm recording never submits automatically and the edited transcript follows the same layout
   flow as typed input.

If Nemotron is unavailable, explicitly select **Use Whisper Tiny fallback (record then
transcribe)**. The app must not switch to Whisper without that user action.

## Reset and recovery

- During recording, select **Reset**. Confirm recording stops, the draft clears, and the initial
  built-in-room state returns.
- Start and stop a fresh recording after Reset. Confirm a new editable draft appears and remains
  unsent.
- If an earlier transcript or result reappears after Reset, stop the demo and relaunch the app.
- If model preparation fails, keep the app online and retry the visible **Prepare offline** or
  **Load local model** action. Do not substitute another model/provider for the Standard story.
- Close the window after the demo and confirm the PowerShell prompt returns without a cleanup error.

## Product behavior and limitations

- The model interprets furniture intent; application code owns catalog IDs, accepted state,
  dimensions, placements, checks, and fit verdicts.
- Rejected previews are diagnostic views. They never replace the accepted layout and cannot be
  applied.
- Manual movement uses the same deterministic geometry checks as scripted layouts.
- The app uses one verified built-in room and a bounded set of known furniture options; it does not
  optimize arbitrary rooms or furniture catalogs.
- The layout model requires a WebGPU-capable adapter with a current driver.
- Voice capture is optional, English-focused, explicitly started by the user, and limited to 20
  seconds per recording.
- There is no cloud inference fallback.

## Troubleshooting

| Symptom | Action |
|---|---|
| Node.js or npm is rejected | Use Node.js `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` and npm `>=11.18.0`; the validated pair is Node `26.13.0` with npm `11.20.0`. |
| **Prepare offline** is visible | The shared model cache is empty. Stay online, select it, and wait for preparation to finish. |
| **Load local model** is visible | The model is cached but not loaded for this product. Select it and wait for the green ready state. |
| The model or provider differs | Return to the Standard `main` build and prepare `qwen3-0.6b-generic-gpu:2` with `WebGPUExecutionProvider`. |
| A rejected preview is visible | Use **Show accepted layout** to return to the preserved accepted layout. |
| Nemotron does not become ready | Use the explicit Whisper Tiny fallback control, or continue with typed input. |

## Optional presenter pacing

| Time | Focus |
|---|---|
| 0:00–1:00 | Product boundary, exact local model/provider, and built-in room |
| 1:00–3:30 | A accepted baseline and B rejected preview |
| 3:30–6:00 | C accepted three-item layout and D app-owned adjustment |
| 6:00–7:30 | E controlled failure and preserved accepted layout |
| 7:30–9:30 | Optional Nemotron draft, explicit review, and Send |
| 9:30–12:00 | Typed request, accepted result, and rejected-option toggles |
| 12:00–14:00 | Reset, repeat one short path, and show the explicit voice fallback if needed |
| 14:00–15:00 | Close with the product limits and normal shutdown |
