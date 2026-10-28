# Validation record

**Date:** October 27, 2026

**Platform:** Windows 11 Enterprise x64, build `10.0.26300`

**Device:** HP EliteBook 8 G1a, AMD Ryzen AI 7 PRO 350, Radeon 860M, 64 GB RAM

## Selected runtime

| Item | Validated value |
|---|---|
| SDK | `foundry-local-sdk@2.2.1` |
| Node | `24.22.1` |
| Electron | `42.3.3` |
| Model alias | `qwen2.5-1.5b` |
| Exact model ID | `qwen2.5-1.5b-instruct-generic-gpu:4` |
| Target source | Built-in stage default; no model alias fallback |
| Model cache size | 1,546 MB |
| Device | GPU |
| Execution provider | `WebGPUExecutionProvider` |
| EP bundle | `webgpu-ep-0.2.1-win-x64` |
| Inference endpoint | none |
| Planning mode | runtime JSON Schema -> app tool invocation |
| Visible response | application-rendered typed evidence |

Qwen2.5 1.5B was the smallest cached model that passed the entire staged and adversarial acceptance.
Qwen3 1.7B is smaller (1,421 MB) but failed the crib correction after three bounded attempts.

## Commands run

```powershell
npm install --no-audit --no-fund
npm install-scripts approve esbuild foundry-local-sdk
npm rebuild esbuild foundry-local-sdk
npm run probe:foundry
npm run typecheck
npm run lint
npm test
Remove-Item Env:FOUNDRY_MODEL_ALIAS -ErrorAction SilentlyContinue
Remove-Item Env:FOUNDRY_MODEL_ID -ErrorAction SilentlyContinue
Remove-Item Env:FOUNDRY_EXECUTION_PROVIDER -ErrorAction SilentlyContinue
npm run test:integration
npm run build
npm run smoke:electron
npm run capture:ui
```

## Results

| Check | Result |
|---|---|
| TypeScript | Pass |
| Biome lint/format | Pass |
| Unit tests | 27/27 pass |
| Electron/Vite build | Pass |
| Actual Electron smoke launch + SDK/catalog initialization | Pass |
| Turn A Queen + desk | Feasible |
| Turn B King + desk | No feasible option; one closet conflict |
| Turn C Queen + crib + compact desk | Feasible |
| King + desk + crib | No feasible bounded option |
| Adversarial negation/correction | Feasible Queen + compact desk |
| Exact default model/EP enforced | Pass; integration asserts exact ID and canonical WebGPU EP |
| Empty-cache preparation path | Pass; direct regression covers catalog lookup, model download, EP registration, and load |
| Rejected-preview evidence consistency | Pass; preview checks/conflicts come from one exact option |
| Model/EP cached and loadable | Pass |
| External inference endpoint used | No |
| Labeled browser visual-preview screenshot | `docs/screenshots/stage-ui.png` |

Observed turn durations on this machine:

| Turn | Duration |
|---|---:|
| Queen + desk | 10.4 s |
| King replacement | 18.0 s |
| Add crib | 21.6 s |
| Controlled failure | 25.8 s |
| Adversarial correction | 28.7 s |

The longer turns include one bounded correction request.

## Model-path evidence

| Candidate | Result |
|---|---|
| Qwen3 0.6B GPU, 529 MB | Exhausted 2,048 output tokens without a native tool call |
| Qwen2.5 0.5B NPU, 528 MB | Invalid argument type and empty state reference |
| Qwen2.5 Coder 1.5B GPU, 1,280 MB | Interrupted native tool-call output |
| Qwen3 1.7B GPU, 1,421 MB | Reasoning disabled successfully; failed crib correction |
| Qwen2.5 1.5B GPU, 1,546 MB | Full staged and adversarial flow passed |

## Offline and telemetry status

- The selected model is in the shared local cache.
- The required WebGPU EP bundle is installed and registered in the app data directory.
- The default target is resolved by exact model ID from the full public catalog; cache-only alias
  fallback is not used.
- `WebGpuExecutionProvider` from SDK discovery is normalized only to the documented
  `WebGPUExecutionProvider` spelling.
- Alternate model/EP pairs require both `FOUNDRY_MODEL_ID` and
  `FOUNDRY_EXECUTION_PROVIDER`; readiness marks them as environment overrides and does not imply
  stage validation.
- A fresh process loaded the model and completed five turns.
- The app does not configure `serviceEndpoint`, call `startWebService`, or make inference HTTP
  requests.
- `disableNonessentialTelemetry` is enabled.
- Foundry Local reports that a minimal `ProcessInfo` event may still upload.
- The network adapter was not disabled during development; the exact manual full-offline procedure
  is in `DEMO-RUNBOOK.md`.
- Electron `webContents.capturePage()` returned `UnknownVizError` in this host. The actual Electron
  app was smoke-launched separately; the committed screenshot comes from the same renderer in an
  explicitly labeled browser preview.

## Remaining blockers

- No Apple-silicon Mac was available. macOS install, EP selection, model variant, rendering, and
  performance are not validated.
- A physical network-disconnect rehearsal still requires Wayne's manual adapter action.
- The local CLI is `0.11.0` while current public CLI is `0.12.1 Preview`; the app does not depend on
  the CLI.
