# New Home App Test Guide

This is the complete first-time test flow for New Home App.

## Requirements

- Windows 11 x64
- Git for Windows
- Supported Node.js range: `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported
- Supported npm minimum: `>=11.18.0`; this is required for `npm install-scripts`
- Internet access for installation and first model/execution-provider preparation
- Several GB of free disk space for dependencies and model assets
- A WebGPU-capable graphics adapter with a current driver; the layout model uses
  `WebGPUExecutionProvider`
- An optional microphone for voice-path testing; typed and guided flows do not require one

## Tested configuration

This guide was tested with Node `26.13.0` and npm `11.20.0` on Windows 11 x64 with an AMD Radeon
860M and 64 GB RAM. The layout model requires a WebGPU-capable graphics adapter with a current
driver.

## Fresh clone, install, build, and launch

Open PowerShell in the parent folder where `new-home-app` should be created:

```powershell
node --version
npm --version
git clone https://github.com/Wayne-Ch/foundry-local-new-home-app.git new-home-app
Set-Location -LiteralPath '.\new-home-app'
npm ci --no-audit --no-fund
npm install-scripts approve electron esbuild foundry-local-sdk
npm run setup:native
npm run build
npm run start:built
```

Do not switch branches or reuse another checkout's `node_modules`.

## Prepare the exact local model

First model and execution-provider preparation may download assets. Stay online and keep New Home
App open until the green **Local model ready** state appears; later app actions can run offline.

The normal setup button is determined only by `readiness.modelCached`; WebGPU provider registration
does not select the wording:

| Normal setup state | `modelCached` | Exact control | Action |
|---|---:|---|---|
| Cold, empty shared model cache | `false` | **Prepare offline** | Select it while online to download the exact model and prepare local runtime assets. |
| Warm shared cache with a fresh product root | `true` | **Load local model** | Select it; the shared model is present even though this product has not loaded it. |
| Model cached; product-specific WebGPU provider registration still needed | `true` | **Load local model** | Select it. Provider registration does not change the label. |
| Loaded READY state | `true` | **Local model ready** | Do not select it; continue only when the green ready state is visible. |

1. **Action:** Confirm the window title and page heading both say **New Home App**.
   **Expected:** The verified built-in bedroom is already active; there is no room setup or
   selection screen.

2. **Action:** Follow the table using the exact visible control. On a cold cache, select
   **Prepare offline**. When the model is already cached but the runtime is not READY - including
   product-specific WebGPU provider registration - select **Load local model**. Keep the app open
   and online.
   **Expected:** The green badge reaches **Local model ready** and identifies
   `qwen3-0.6b-generic-gpu:2` with `WebGPUExecutionProvider`.

## A through E

Mapping: **A** Queen + desk, **B** King conflict, **C** Queen + desk + baby bed, **D** app-owned
manual adjustment, **E** King controlled failure.

3. **Action (A):** Select **Run next: A · Queen + desk**.
   **Expected:** Queen + rotated standard desk is accepted; the Buyer request appears once and
   the application response contains only the conclusion.

4. **Action (B):** Select **Run next: B · King conflict**.
   **Expected:** A King rejected preview appears automatically with **Rejected preview · not
   accepted**; A remains accepted and rejected furniture is not interactive.

5. **Action:** Select **Show accepted layout**, then **Inspect rejected option**.
   **Expected:** The preserved A layout and the same B details alternate without adding a message
   or starting another model action.

6. **Action (C):** Select **Run next: C · Queen + desk + baby bed**.
   **Expected:** Queen + compact desk + baby bed is accepted and E becomes the next guided action.

7. **Action (D):** For each accepted item - Queen bed, compact desk, and baby bed - drag it exactly
   50 mm to the right, verify the valid ghost preview, then select **Revert**.
   **Expected:** Every furniture type supports pointer adjustment; Revert restores the accepted
   coordinates and no Buyer/model turn is added.

8. **Action (D):** Focus each accepted item and press Right Arrow once. Revert the Queen and
   baby-bed previews; select **Apply** for the compact-desk preview.
   **Expected:** Every furniture type supports a 50 mm keyboard preview. Apply updates the accepted
   layout, Revert preserves the prior accepted layout, and no Buyer/model turn is added.

9. **Action (E):** Select **Run next: E · King controlled failure**.
   **Expected:** A King rejected preview appears automatically; C/D remains accepted and rejected
   furniture is non-interactive.

10. **Action:** Select **Show accepted layout**, then **Inspect rejected option**.
    **Expected:** The existing C/D state and the same E details alternate without adding a message
    or starting another model action.

## Typed input, voice input, and Reset

11. **Action:** Select **Reset**. In **Manual prompt**, enter
    `Can a Queen-size bed and a desk fit here without blocking the closet or the door?`, then select
    **Send**.
    **Expected:** The built-in room remains active; the exact typed request appears once and the
    normal local planning and geometry path produces the accepted Queen + desk result.

12. **Action:** Select **Reset**, then **Prepare Nemotron live**. Keep the app online and open until
    the audio badge reports the exact
    `nemotron-speech-streaming-en-0.6b-generic-cpu:3` model in **LIVE** mode.
    **Expected:** Nemotron is the visible default voice model; Whisper does not activate unless its
    fallback control is explicitly selected.

13. **Action:** Select **Start recording**, speak a Queen + desk request, then select **Stop**.
    Review the editable transcript and any visible correction suggestion before selecting **Send**.
    **Expected:** Live text remains an unsent draft until Send; the exact edited text is then
    submitted through the same local planning and geometry path.

14. **Action:** Start another recording, then select **Reset** while recording.
    **Expected:** Recording stops, prompt/transcript/suggestions/manual state clear, and the
    built-in room remains active.

15. **Action:** Start a fresh recording after Reset, then stop it without sending.
    **Expected:** Recording starts normally and the editable transcript remains unsent.

If Nemotron deterministically fails and the UI exposes **Use Whisper Tiny fallback (record then
transcribe)**, selecting it is an explicit fallback check. It must never activate silently.

## Troubleshooting

| Symptom | Action |
|---|---|
| npm rejects the Node.js or npm version before install or a script run | Install a supported Node.js version matching `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` and npm `>=11.18.0`. Node 23.x and 25.x are intentionally excluded. The validated pair is Node `26.13.0` with npm `11.20.0`; confirm with `node --version` and `npm --version`. |
| `npm install-scripts` is unavailable | The npm version is below the supported minimum. Upgrade to npm `>=11.18.0` (validated: `11.20.0`), rerun `npm ci --no-audit --no-fund`, then approve the three pinned install scripts. |
| A cold empty cache shows **Prepare offline** | Stay online, select it, and wait for the operation to finish. |
| A warm shared cache or fresh product root shows **Load local model** | Select **Load local model** and wait for **Local model ready**. |
| The control shows **Local model ready** | Continue to A. |
| A visible action fails | Retry once. If it still fails, close the app, relaunch with `npm run start:built`, confirm the visible status, and report only the visible error. |

## Clean shutdown

16. **Action:** Close the New Home App window and wait for `npm run start:built` to return to the
    PowerShell prompt.
    **Expected:** The window closes without a visible cleanup error and the launch command returns
    to the prompt.
