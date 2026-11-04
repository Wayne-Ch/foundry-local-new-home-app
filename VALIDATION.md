# New Home App validation

## Required configuration

| Item | Required value |
|---|---|
| Product | New Home App |
| Package | `new-home-app` |
| Layout model | `qwen3-0.6b-generic-gpu:2` |
| Layout provider | `WebGPUExecutionProvider` |
| Foundry SDK | 2.2.1 |
| Electron | 42.11.18 |
| Room | Verified built-in bedroom active at startup |
| Network | No external inference endpoint |

Current recorded app evidence was collected with Node `26.13.0` and npm `11.20.0` on Windows 11
x64 using an AMD Radeon 860M and 64 GB RAM. Those values describe the evidence machine, not product
minimums: the current layout model requires a WebGPU-capable graphics adapter/driver, no minimum RAM
has been established, and other app environments do not yet have equivalent validation evidence.

## Recorded results — 2026-11-03

| Gate | Result |
|---|---|
| Native preflight | Pass; Electron installer check plus `esbuild` and `foundry-local-sdk` rebuild |
| Lint | Pass |
| Typecheck | Pass |
| Unit tests | Pass; 27 files, 687 tests |
| Production build | Pass |
| Dependency audit | Pass; zero vulnerabilities on Electron 42.11.18 |
| Foundry diagnostics | Pass; standard-only app/log/audio paths, built-in Qwen target cached, chat-only candidate filter |
| Furniture controls | Pass; accepted A/C bed, desk, and baby bed pointer + 50 mm keyboard preview, Apply/Revert, automatic B/E rejected evidence, non-interactive rejected furniture, and no-inference view switching |
| Microphone permission | Pass; trusted active main frame, audio-only permission request |
| Reset | Pass; two live Nemotron sessions, 6 ms cancellation each, tracks stopped, ownership released, State v0, fresh lease |
| Reload/close ownership | Pass; reload cancellation 6 ms, close cancellation 26 ms, stale routing false, zero destroyed-object/unhandled errors |
| Electron smoke | Pass |
| UI capture | Pass; `docs\screenshots\stage-ui.png`, 421,582 bytes, SHA-256 `FD55587C44678FB6FCA4D3C23C045CE24FB159386015A49DB7363013EA04B5DA` |

Real layout-model evidence:

| Turn | Status / evidence option | Attempts | Total | Geometry |
|---|---|---:|---:|---:|
| A | feasible / `queen-desk-standard-v1` | 2 | 7,178.1 ms | 0.6 ms |
| B | rejected / `king-desk-standard-v1`; A preserved | 2 | 5,872.9 ms | 0.7 ms |
| C | feasible / `queen-crib-compact-v1` | 2 | 6,641.0 ms | 0.1 ms |
| E | rejected / `king-crib-compact-east-v1`; C preserved | 1 | 3,620.3 ms | 0.2 ms |

The run used `qwen3-0.6b-generic-gpu:2`, `WebGPUExecutionProvider`, and
`externalEndpointUsed: false`.

Voice evidence:

| Mode | Result |
|---|---|
| Nemotron streaming | Pass on controlled retry; 5,530 ms fixture, 31 partials, first partial 1,296 ms, finalization 216 ms, total 6,234 ms, keyword recall 1.0, external endpoint false |
| Whisper Tiny fallback | Pass; preparation 1,742 ms, transcription 2,713 ms, keyword recall 1.0, external endpoint false, temp files empty before and after |

One cold Nemotron attempt reached the existing bounded backpressure guard before partial output; the
immediate controlled retry passed with the metrics above. The queue bound was not weakened.

## Static and unit gates

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

The suite must cover:

- A/B/C/E deterministic state transitions;
- C preserved after E;
- automatic B/E rejected previews;
- accepted/rejected switching without inference;
- conclusion-only Application evidence and single Buyer request display;
- exact request provenance in Developer Trace;
- pointer and 50 mm keyboard preview for accepted bed, desk, and baby bed;
- Apply/Revert and non-interactive rejected furniture;
- product-path isolation;
- reset generations, stale-result rejection, audio cleanup, stream ownership, and microphone gating.

## Real runtime gates

```powershell
npm run test:integration
npm run test:nemotron-integration
npm run test:audio-integration
```

Record:

- model ID and execution provider;
- model cache/load status;
- each A/B/C/E attempt count;
- prompt, preflight, generation, validation, geometry, and total milliseconds;
- Nemotron first-partial and finalization milliseconds;
- Whisper fallback duration and cleanup result;
- confirmation that `externalEndpointUsed` is `false`.

Do not change the standard layout model when this bounded validation passes. If it fails, stop and
diagnose the exact model/runtime failure before considering any model change.

## Electron package decision

The branch started on main's Electron 42.3.3. `npm audit --audit-level=low` reported two
high-severity dependency findings and identified 42.11.18 as the supported fix. The package was
therefore upgraded only to that audited patch release, after which `npm audit` reported zero
vulnerabilities. All static, unit, build, Electron, microphone, Reset, stream-owner, smoke, and UI
capture gates must be rerun on 42.11.18.

## Renderer and Electron gates

```powershell
npm run probe:furniture-controls
npm run probe:microphone-permission
npm run probe:reset
npm run probe:stream-owner
npm run smoke:electron
npm run capture:ui
```

Expected:

- furniture probe passes A/C accepted controls and automatic B/E rejected evidence;
- microphone permission is limited to the active trusted main frame and audio-only request;
- Reset cancels native audio, stops tracks, returns to one authoritative v0 generation, and permits
  a fresh recording;
- reload and close revoke stream ownership and reject stale routing;
- Electron launches and exits cleanly;
- `docs\screenshots\stage-ui.png` shows New Home App and the standard built-in-room story.

## Isolation gate

Verify the writable directories resolve under `FoundryLocalNewHomeAppStandard`, except for an
explicit shared model cache:

- Electron profile/session/journal/log/temp/crash directories;
- Foundry app state and logs;
- audio temporary captures.

Reset and shutdown cleanup must operate only on those owned locations.

## Source-scope gate

Before commit:

```powershell
git status --short
git diff --check
git rev-parse origin/main
git rev-parse origin/enhanced-new-home-app
```

Canonical Standard changes belong on `main`. Enhanced-only changes belong on
`enhanced-new-home-app`.
