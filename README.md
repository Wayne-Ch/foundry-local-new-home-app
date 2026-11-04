# New Home App

New Home App is a Windows Electron application for planning furniture in one verified built-in
bedroom. It uses a local model to understand each request, checks layouts against fixed room
dimensions and clearance rules, and opens with the room ready to use.

Enhanced New Home App on branch `enhanced-new-home-app` extends this app with intake and local
analysis of the included sample floor plan, and an explicit fallback to the built-in room.

## Product flow

| Step | Buyer or application action | Expected result |
|---|---|---|
| A | Queen bed + standard desk | Accepted |
| B | Replace Queen with King | Rejected preview appears automatically; A remains accepted |
| C | Queen bed + desk + baby bed; compact desk allowed | Accepted |
| D | Drag or use arrow keys on accepted furniture | 50 mm preview with Apply/Revert; no new conversation turn |
| E | Replace Queen with King while retaining compact desk and baby bed | Rejected preview appears automatically; the accepted C/D state remains accepted |

**Show accepted layout** and **Inspect rejected option** switch between the accepted layout and
rejected preview without rerunning the request. Accepted furniture supports pointer and keyboard
adjustment; rejected furniture remains read-only.

## Exact local models

| Responsibility | Model | Execution provider |
|---|---|---|
| Layout intent | `qwen3-0.6b-generic-gpu:2` | `WebGPUExecutionProvider` |
| Live voice captions | `nemotron-speech-streaming-en-0.6b-generic-cpu:3` | `CPUExecutionProvider` |
| Explicit record-then-transcribe fallback | `openai-whisper-tiny-generic-cpu:4` | `CPUExecutionProvider` |

Inference stays local with no cloud fallback. Typed and guided flows do not require a
microphone.

## Requirements

- Windows 11 x64.
- Git for Windows.
- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported.
- npm `>=11.18.0`, required for `npm install-scripts`.
- Internet access for installation and first local model preparation.
- Several GB of free disk space for dependencies and model assets.
- A WebGPU-capable graphics adapter with a current driver.
- An optional microphone for voice testing.

## Fresh clone, install, and launch

```powershell
git clone https://github.com/Wayne-Ch/foundry-local-new-home-app.git new-home-app
Set-Location -LiteralPath '.\new-home-app'
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run build
npm run start:built
```

First preparation may download uncached assets. Stay online, select the visible **Prepare offline**
or **Load local model** control, and keep New Home App open until the green **Local model ready**
state appears. Later app actions can run offline.

**Prepare offline** downloads missing assets; **Load local model** loads assets that are already
cached. Continue when the control changes to **Local model ready**.

Follow [PLAYTEST.md](PLAYTEST.md) from top to bottom for the complete A through E flow, typed and
voice input, Reset, and clean shutdown.

## Troubleshooting

| Symptom | Action |
|---|---|
| npm rejects the Node.js or npm version | Install a supported Node.js version and npm `>=11.18.0`, then confirm with `node --version` and `npm --version`. |
| `npm install-scripts` is unavailable | Upgrade npm, rerun `npm ci --no-audit --no-fund`, then approve Electron, esbuild, and Foundry Local SDK. |
| **Prepare offline** or **Load local model** does not reach ready | Stay online, relaunch with `npm run start:built`, select the visible setup control once, and wait for **Local model ready**. |
| Voice input is unavailable | Use typed input, or select **Prepare Nemotron live** again. Use **Use Whisper Tiny fallback (record then transcribe)** only if that control appears. |

## Current limitations

- The app uses one verified built-in bedroom and has no room-import flow.
- The layout model requires WebGPU.
- Voice input is English only.
- The app evaluates the guided furniture options rather than arbitrary architectural layouts.
