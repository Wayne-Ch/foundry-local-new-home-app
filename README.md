# New Home App

New Home App is the Standard Windows Electron demonstration for Foundry Local. The `main` branch is
the Standard lineage: one verified built-in bedroom, local intent extraction, deterministic
application-owned geometry, and no cloud inference fallback.

The app uses Foundry Local SDK 2.2.1 for local inference.

## Key behavior

- Layout model: `qwen3-0.6b-generic-gpu:2`
- Layout execution provider: `WebGPUExecutionProvider`
- Voice model: `nemotron-speech-streaming-en-0.6b-generic-cpu:3`
- Explicit voice fallback: `openai-whisper-tiny-generic-cpu:4`
- Room: one verified built-in `4200 x 3600` mm bedroom

The layout model emits compact furniture-intent changes. Application code derives catalog IDs,
retained furniture, state references, dimensions, constraints, and the complete tool input.
Deterministic geometry checks room bounds, the door swing, closet and window clearances, furniture
collisions, and the 250 mm minimum furniture gap. The model never decides whether a layout fits.

The built-in story is:

| Step | Action | Result |
|---|---|---|
| A | Queen bed + standard desk | Accepted |
| B | Replace Queen with King | Rejected preview; A remains accepted |
| C | Queen bed + compact desk + baby bed | Accepted |
| D | Drag or use arrow keys on accepted furniture | App-owned 50 mm preview with Apply/Revert |
| E | Replace Queen with King while retaining the compact desk and baby bed | Rejected preview; C/D remains accepted |

Rejected previews are diagnostic views. They do not replace the accepted layout and cannot be
focused, dragged, or applied. Manual placement uses the same deterministic geometry checks and does
not invoke the model.

Optional voice input produces an editable draft. Nemotron partials are display-only, suggestions
require explicit Apply or Dismiss action, and the user must select **Send** before the transcript
becomes a layout request.

Reset keeps the built-in room and prepared model while clearing the conversation, accepted and
rejected layouts, manual previews, prompt, transcript, suggestions, and active recording.

## Requirements

- Windows 11 x64
- Git for Windows
- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported
- npm `>=11.18.0`, required for `npm install-scripts`
- Internet access for installation and first model/execution-provider preparation
- Several GB of free disk space for dependencies and model assets
- A WebGPU-capable graphics adapter with a current driver
- An optional microphone for voice input

Known-good toolchain versions are Node `26.13.0` and npm `11.20.0`.

## Quick start

Open PowerShell in the folder where the repository should be created:

```powershell
node --version
npm --version
git clone --branch main --single-branch https://github.com/Wayne-Ch/foundry-local-new-home-app.git new-home-app
Set-Location -LiteralPath '.\new-home-app'
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run check:release-contract
npm run build
npm run start:built
```

Use the fresh clone with its own `node_modules`, Electron profile, and app data.

## First preparation

First model and execution-provider preparation can take several minutes while assets download. Stay
online and keep New Home App open until the green **Local model ready** state appears; later app
actions can run offline.

The visible setup control follows `readiness.modelCached`:

| State | Control | Action |
|---|---|---|
| Cold, empty shared model cache | **Prepare offline** | Select it while online to download the exact model and prepare local runtime assets. |
| Warm shared cache with a fresh product root | **Load local model** | Select it to load the cached model for this product. |
| Model cached; product-specific WebGPU provider registration still needed | **Load local model** | Select it; provider registration does not change the label. |
| Loaded READY state | **Local model ready** | Continue when the green ready state and exact model/provider are visible. |

On a cold cache, select **Prepare offline**. If the operation finishes without reaching READY and
the control changes to **Load local model**, select it. Continue only when the app identifies
`qwen3-0.6b-generic-gpu:2` with `WebGPUExecutionProvider`.

## Development checks

```powershell
npm run check:release-contract
npm run lint
npm run typecheck
npm test
npm run build
```

See [DEMO-GUIDE.md](DEMO-GUIDE.md) for the complete manual test, stage sequence, voice path,
recovery steps, and optional presenter pacing.

## Product limitations

- The app uses one verified built-in room and a bounded set of known furniture options. It does not
  optimize arbitrary rooms or furniture catalogs.
- The Standard layout path requires the exact Qwen model and WebGPU provider shown above; it does
  not select a best-cached alternative.
- macOS packaging, model selection, execution-provider registration, layout fidelity, and
  performance have not been tested.
- The default voice model is English-focused. Multilingual and Chinese behavior has not been tested.
- Voice capture is limited to 20 seconds per recording.
- There is no cloud inference fallback.

App-owned writable state uses the `FoundryLocalNewHomeAppStandard` identity. A shared immutable
Foundry model cache may be supplied through `FOUNDRY_MODEL_CACHE_DIR`; app cleanup does not remove
that cache.

## Fixture provenance

The tracked `tests\fixtures\queen-desk.wav` voice fixture is 5,530 ms and has SHA-256
`6F97777AED3E622F16FB5EAD34795FD5FD886055B9D20FF12ADA3DC99F142A9B`. Its source carries a PD-US
designation: it is in the public domain in the United States but may remain copyrighted elsewhere.
Reuse outside the United States requires a separate rights determination.
