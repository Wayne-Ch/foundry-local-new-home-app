# New Home App demo runbook

## Before the session

1. Open PowerShell.
2. From the parent folder containing the clone, run:

   ```powershell
   Set-Location -LiteralPath '.\new-home-app'
   npm ci --no-audit --no-fund
   npm install-scripts approve electron esbuild foundry-local-sdk
   npm run setup:native
   npm run lint
   npm run typecheck
   npm test
   npm run build
   npm run test:integration
   npm run test:nemotron-integration
   npm run test:audio-integration
   npm run probe:furniture-controls
   npm run probe:microphone-permission
   npm run probe:reset
   npm run probe:stream-owner
   npm run smoke:electron
   npm run capture:ui
   ```

3. Confirm `docs\screenshots\stage-ui.png` was refreshed.
4. Launch:

   ```powershell
   npm run start:built
   ```

5. Confirm the title is **New Home App**, the verified room is already visible, and the runtime strip
   identifies `qwen3-0.6b-generic-gpu:2` with WebGPU.

First model and execution-provider preparation can take several minutes and requires a substantial
download and disk allocation. Remain online, keep New Home App open, and wait for the green
**Local model ready** state before presenting. Subsequent demo actions may run offline.

Stop before presenting if any command fails, the product title differs, the built-in room is not
active, or another product's profile/log path is shown.

## Live story

| Step | Operator action | Audience-visible result |
|---|---|---|
| A | Select **Run next: A · Queen + desk** | Queen + rotated standard desk is accepted |
| B | Select **Run next: B · King conflict** | Rejected King preview appears automatically; A is preserved |
| B compare | Select **Show accepted layout**, then **Inspect rejected option** | The canvas switches without new Buyer/Application messages or inference |
| C | Select **Run next: C · Queen + desk + baby bed** | Queen + compact desk + baby bed is accepted |
| D | Move accepted furniture by pointer or arrow key; use Apply/Revert | The app validates 50 mm previews without model geometry |
| E | Select **Run next: E · King controlled failure** | Rejected King preview appears automatically; C is preserved |

### A — feasible baseline

- Point out that the Buyer request appears once.
- Point out that Application evidence states only the conclusion.
- Open Developer Trace and show the request, model delta, app validation, preflight, and geometry.

### B — controlled conflict

- The rejected preview must appear automatically.
- The result badge must say **Rejected preview · not accepted**.
- Rejected furniture must not be interactive.
- Select **Show accepted layout**. A must remain interactive.
- Select **Inspect rejected option**. The exact same B evidence must return.

### C — accepted three-item layout

- Confirm Queen bed, compact desk, and baby bed.
- Confirm the door, closet, window, and 250 mm furniture-clearance checks.
- Confirm the next action is E; there is no separate recovery branch.

### D — app-owned manual adjustment

- Focus the Queen bed and press an arrow key once: exactly 50 mm.
- Revert.
- Move the compact desk 50 mm and Apply.
- Move the baby bed 50 mm and Revert.
- Point out that no Buyer message or model request was added for the manual preview.

### E — controlled failure

- The rejected preview must appear automatically.
- C must remain the accepted state.
- The accepted/rejected controls must preserve message count and state version.
- Rejected furniture must remain non-interactive.

## Voice

1. Select **Prepare Nemotron live**.
2. Select **Start recording** and speak an A, C, or E request.
3. Confirm live text is an editable draft and is not submitted automatically.
4. Apply or dismiss any furniture correction suggestions.
5. Select **Send**.
6. If Nemotron is unavailable, explicitly select **Use Whisper Tiny fallback**.

Stop if a transcript submits automatically, a suggestion edits the prompt without explicit action,
or the app reports any external endpoint use.

## Reset, reload, and close

- During an active recording, select **Reset**. Media tracks must stop, stream ownership must be
  released, the room must remain active, and the UI must return to State v0.
- Start a fresh recording after Reset to confirm a new ownership lease.
- Reload during a recording. The stale stream must become unroutable.
- Close the window during a recording. Shutdown must finish without destroyed-object or unhandled
  renderer errors.

## Local launch command

```powershell
Set-Location -LiteralPath '.\new-home-app'
npm run start:built
```
