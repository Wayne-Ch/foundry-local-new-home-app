# New Home App

New Home App is a Windows Electron demonstration that combines local intent extraction with
application-owned deterministic room geometry. It starts with one verified built-in bedroom active;
there is no setup or room-selection step.

> [!IMPORTANT]
> First model and execution-provider preparation can take several minutes and requires a
> substantial download and disk allocation. Remain online, keep New Home App open, and wait for the
> green **Local model ready** state before continuing. After the required models and execution
> provider are prepared, subsequent demo actions may run offline.

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

## Validated scope

This release was validated only on Windows 11 x64 with an AMD Radeon 860M using
`WebGPUExecutionProvider`. Foundry Local itself supports additional operating systems and hardware,
but this app release makes no equivalent validation claim for other Windows hardware, Windows
Arm64, Linux, macOS, or other execution providers.

Requirements for the validated flow:

- Windows 11 x64
- Supported Node.js range: `^22.12.0 || ^24.0.0 || >=26.0.0`. Node 23.x and 25.x are not
  supported. The validated machine used Node `26.13.0`.
- Supported npm minimum: `>=11.18.0`. The package manager pin and validated environment use npm
  `11.20.0`; the minimum is required for `npm install-scripts`.
- AMD Radeon 860M with a current WebGPU-capable driver
- Network and sufficient disk space for first model and execution-provider preparation

## Fresh clone, install, and launch

```powershell
git clone https://github.com/Wayne-Ch/foundry-local-new-home-app.git new-home-app
Set-Location -LiteralPath '.\new-home-app'
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run check:release-contract
npm run build
npm run start:built
```

The normal setup button is determined only by `readiness.modelCached`; WebGPU provider registration
does not select the wording:

| Normal setup state | `modelCached` | Exact control | Operator action |
|---|---:|---|---|
| Cold, empty shared model cache | `false` | **Prepare offline** | Select it while online to download the exact model and prepare local runtime assets. |
| Warm shared cache with a fresh product root | `true` | **Load local model** | Select it; the shared model is present even though this product has not loaded it. |
| Model cached; product-specific WebGPU provider registration still needed | `true` | **Load local model** | Select it. Provider registration does not change the label. |
| Loaded READY state | `true` | **Local model ready** | Do not select it; continue only when the green ready state is visible. |

On a cold run, select **Prepare offline**. If the operation finishes without reaching READY and the
button now says **Load local model**, select that exact control. Keep the app open and online until
the green **Local model ready** state appears.

Follow [PLAYTEST.md](PLAYTEST.md) from top to bottom for the complete built-in-room A through E
story, all-furniture manual controls, typed and voice input, Reset, and clean shutdown. No
branch-switch, copied dependency folder, shared app profile, or other workaround is part of the
supported route.

## Validation commands

```powershell
npm run lint
npm run typecheck
npm run check:release-contract
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

## Troubleshooting

| Symptom | Action |
|---|---|
| npm rejects the Node.js or npm version before install or a script run | Install a supported Node.js version matching `^22.12.0 || ^24.0.0 || >=26.0.0` and npm `>=11.18.0`. Node 23.x and 25.x are intentionally excluded. The validated pair is Node `26.13.0` with npm `11.20.0`; confirm with `node --version` and `npm --version`. |
| `npm install-scripts` is unavailable | The npm version is below the supported minimum. Upgrade to npm `>=11.18.0` (validated: `11.20.0`), rerun `npm ci --no-audit --no-fund`, then approve the three pinned install scripts. |
| A cold empty cache shows **Prepare offline** | This is the expected `modelCached=false` label. Stay online, select it, and wait for the operation to finish. |
| A warm shared cache, fresh product root, or pending product-specific WebGPU registration shows **Load local model** | This is the expected `modelCached=true` label. Select **Load local model**; do not look for **Prepare offline** based on provider state. |
| The control shows **Local model ready** | The runtime is already loaded and READY. Do not select the disabled control; continue with the playtest. |

Use `PLAYTEST.md` for the strict operator walkthrough and `DEMO-RUNBOOK.md` for live delivery.
