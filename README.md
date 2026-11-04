# Enhanced New Home App

Enhanced New Home App extends the standard New Home App planning flow with:

- a clear no-room start state;
- preview and verification of the included sample floor plan;
- local floor-plan analysis before imported geometry appears;
- imported-room `A -> B -> C -> D -> E` planning;
- an explicit **Use default room** fallback that is not reported as a successful import.

For the complete first-time route, follow [PLAYTEST.md](PLAYTEST.md).

## Exact local models

| Responsibility | Model | Execution provider |
|---|---|---|
| Layout intent | `qwen3-0.6b-generic-gpu:2` | `WebGPUExecutionProvider` |
| Floor-plan analysis | `qwen3.5-0.8b-generic-cpu:3` | `CPUExecutionProvider` |
| Live voice captions | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` |
| Explicit record-then-transcribe fallback | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` |

The app pins `foundry-local-sdk@2.2.1`. Model inference and speech processing run locally without a
cloud inference or speech endpoint.

## Floor-plan fixture

Use `public/assets/floor-plan/sample-master-bedroom.png` or a renamed byte-for-byte copy:

- PNG, `1020 x 1080`.
- `194,686` bytes.
- SHA-256 `02c90be495d1f64e8adb57c4d00eb81f09fbeb80e885a0066f692026d2145587`.

Modified, re-encoded, or arbitrary drawings are rejected before imported geometry appears. Select
**Use default room** when you want the original verified bedroom instead of the imported-room
flow.

The fixture comes from a NARA-held U.S. federal record. See the
[full provenance record](docs/asset-provenance/sample-master-bedroom.md) for the source, license,
transformation, checksum, and review.

## Requirements

- Windows 11 x64.
- Git for Windows.
- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported.
- npm `>=11.18.0`, required for `npm install-scripts`.
- Internet access for installation and first model/runtime preparation.
- Several GB of free disk space for dependencies and model assets.
- A WebGPU-capable graphics adapter with a current driver for the layout model.
- A microphone only for voice-path testing; typed and guided flows work without one.

## Clone, install, build, and launch

```powershell
git clone --branch enhanced-new-home-app --single-branch https://github.com/Wayne-Ch/foundry-local-new-home-app.git enhanced-new-home-app
Set-Location -LiteralPath '.\enhanced-new-home-app'
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run build
npm run start:built
```

First preparation may download local assets. Stay online, select **Prepare offline** or
**Load local model** when shown, and keep Enhanced New Home App open until
**Local model ready** appears. Later app actions can run offline.

## Troubleshooting

| Symptom | Action |
|---|---|
| npm rejects the Node.js or npm version | Install a supported Node.js version and npm `>=11.18.0`, then confirm with `node --version` and `npm --version`. |
| `npm install-scripts` is unavailable | Upgrade npm, rerun `npm ci --no-audit --no-fund`, then approve Electron, esbuild, and Foundry Local SDK. |
| The layout model does not reach ready | Stay online, relaunch with `npm run start:built`, select the visible setup control once, and wait for **Local model ready**. |
| Floor-plan analysis rejects | Use the included PNG or a byte-identical copy, retry **Analyze layout**, or select **Use default room**. |
| Drag or Arrow keys do nothing | Select **Show accepted layout**, confirm the app is idle, and use an accepted layout. Rejected furniture is read-only. |
| Nemotron does not prepare or stream | Retry **Prepare Nemotron live** while connected, use the explicit Whisper Tiny fallback when available, or use typed input. |
| Electron or the native runtime is missing | Run `npm run setup:native`, `npm run build`, and `npm run start:built` again. |

## Scope and limitations

- The floor-plan flow accepts only the included fixture or a byte-identical copy, not arbitrary
  floor plans or CAD drawings.
- Footprint and clearance planning is not infant-safety advice, structural review, accessibility
  certification, or global optimization.
- Exact room measurements come from the fixture and app data, not from image-estimated dimensions.
- Audio is English only. Nemotron provides live captions; Whisper Tiny is an explicit fallback.
