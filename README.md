# New Home App

New Home App is a Windows Electron demonstration that combines local intent extraction with
application-owned deterministic room geometry. It starts with one verified built-in bedroom active;
there is no setup or room-selection step.

## Product contract

- Product name: **New Home App**
- Layout model: `qwen3-0.6b-generic-gpu:2`
- Layout execution provider: `WebGPUExecutionProvider`
- Voice preference: Nemotron streaming captions
- Voice fallback: Whisper Tiny record-then-transcribe
- Network contract: no cloud inference fallback
- Geometry contract: the model interprets the buyer request; the application owns catalog IDs,
  retained state, measurements, placements, validation, and verdicts

The visible story is linear:

| Step | Buyer or application action | Expected result |
|---|---|---|
| A | Queen bed + standard desk | Accepted |
| B | Replace Queen with King | Rejected preview appears automatically; A remains accepted |
| C | Queen bed + desk + baby bed; compact desk allowed | Accepted |
| D | Drag or use arrow keys on accepted furniture | App-owned 50 mm preview with Apply/Revert; no model inference |
| E | Replace Queen with King while retaining compact desk and baby bed | Rejected preview appears automatically; C remains accepted |

At B and E, **Show accepted layout** and **Inspect rejected option** switch already-computed
evidence. Neither control submits a request or reruns inference. Rejected furniture is rendered as
evidence only and cannot be dragged, focused, applied, or reverted.

## Evidence contract

- A buyer request appears once, in the Buyer message.
- Application evidence contains only the deterministic conclusion.
- Developer Trace retains the exact request, model intent delta, app-derived validated input,
  request preflight, performance, and geometry result.
- Accepted Queen/King bed instances, desks, and the baby bed use the same pointer and keyboard
  interaction contract when present in an accepted layout.
- Arrow keys move a focused item by exactly 50 mm. Enter applies a valid preview; Escape reverts.

## Reset and lifecycle contract

Reset immediately establishes a new generation-tagged v0 conversation while retaining the verified
built-in room and safely prepared model state. It clears:

- conversation messages and trace;
- accepted layout and rejected evidence;
- manual previews, drag state, and focus state;
- editable prompt, live transcript, speech suggestions, and provenance;
- active audio capture, native stream ownership, and stale async results.

Reload, window close, and shutdown revoke renderer-owned audio streams. Temporary microphone WAV
files are scoped to this product, cleaned after success and failure, and recovered only from this
product's owned directory.

## Product isolation

App-owned writable state uses the standard-only identity `FoundryLocalNewHomeAppStandard`:

- Electron profile: `electron-profile`
- Electron session data and Chromium journals: `electron-session`
- Electron logs: `electron-logs`
- Electron temporary files: a standard-only OS temp directory
- Foundry application state: `foundry-app-data`
- Foundry logs: `foundry-logs`
- Audio captures: a standard-only OS temp directory

`NEW_HOME_STANDARD_APP_DATA_DIR` can override the standard product root. A shared immutable Foundry
model cache is allowed through `FOUNDRY_MODEL_CACHE_DIR`; app cleanup never removes that cache.

## Run locally

Requirements:

- Windows 11
- Node.js 22+
- WebGPU-capable GPU and current driver
- Foundry Local prerequisites for `foundry-local-sdk` 2.2.1

```powershell
Set-Location -LiteralPath 'C:\Users\waynechuang\Projects\2026 Ignite\foundry-local-new-home-demo-standard'
npm install
npm start
```

`npm start` builds and launches New Home App. On first use, select **Load local model** if the layout
model is cached but not loaded, or **Prepare offline** to download it once.

## Validation commands

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit
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

Use `PLAYTEST.md` for the strict operator walkthrough and `DEMO-RUNBOOK.md` for live delivery.
