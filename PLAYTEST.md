# New Home App Test Guide

This is the complete first-time test flow for New Home App.

## Requirements

- Windows 11 x64.
- Git for Windows.
- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported.
- npm `>=11.18.0`, required for `npm install-scripts`.
- Internet access for installation and first local model preparation.
- Several GB of free disk space for dependencies and model assets.
- A WebGPU-capable graphics adapter with a current driver for the layout model.
- An optional microphone for voice testing; typed and guided flows do not require one.

Note: This guide was validated on Windows 11 x64 with Node.js 26.13.0 and npm 11.20.0. Other environments have not yet been validated.

## Fresh clone, install, build, and launch

Follow the [README requirements](README.md#requirements) and
[fresh-clone install, build, and launch steps](README.md#fresh-clone-install-and-launch) in
PowerShell. Confirm `node --version` and `npm --version` meet the listed ranges before installation.
Do not switch branches or reuse another checkout's `node_modules`.

## Prepare the exact local model

First preparation may download model files and supporting assets. Stay online and keep New Home App
open until the green **Local model ready** state appears; later app actions can run offline.

1. **Action:** Confirm the window title and page heading both say **New Home App**.
   **Expected:** The verified built-in bedroom is already active; there is no room setup or
   selection screen.

2. **Action:** Select **Prepare offline** or **Load local model**, whichever is visible. Keep the
   app open and online.
   **Expected:** The green badge reaches **Local model ready** and identifies
   `qwen3-0.6b-generic-gpu:2` with `WebGPUExecutionProvider`.

## A through E

Mapping: **A** Queen + desk, **B** King conflict, **C** Queen + desk + baby bed, **D** manual
adjustment, **E** King controlled failure.

3. **Action (A):** Select **Run next: A · Queen + desk**.
   **Expected:** Queen + rotated standard desk is accepted; the Buyer request appears once, and
   the response shows the conclusion without repeating the request.

4. **Action (B):** Select **Run next: B · King conflict**.
   **Expected:** A King rejected preview appears automatically with **Rejected preview · not
   accepted**; A remains accepted and rejected furniture is not interactive.

5. **Action:** Select **Show accepted layout**, then **Inspect rejected option**.
   **Expected:** The preserved A layout and the same B details alternate without adding a message
   or rerunning the request.

6. **Action (C):** Select **Run next: C · Queen + desk + baby bed**.
   **Expected:** Queen + compact desk + baby bed is accepted and E becomes the next guided action.

7. **Action (D):** For each accepted item - Queen bed, compact desk, and baby bed - drag it one
   50 mm grid step to the right, verify the valid preview, then select **Revert**.
   **Expected:** Every furniture type supports pointer adjustment; Revert restores the accepted
   coordinates, and no new Buyer request or response appears.

8. **Action (D):** Focus each accepted item and press Right Arrow once. Revert the Queen and
   baby bed previews; select **Apply** for the compact desk preview.
   **Expected:** Every furniture type supports a 50 mm keyboard preview. Apply updates the accepted
   layout, Revert preserves the prior accepted layout, and no new Buyer request or response appears.

9. **Action (E):** Select **Run next: E · King controlled failure**.
   **Expected:** A King rejected preview appears automatically; C/D remains accepted and rejected
   furniture is non-interactive.

10. **Action:** Select **Show accepted layout**, then **Inspect rejected option**.
    **Expected:** The existing C/D state and the same E details alternate without adding a message
    or rerunning the request.

## Typed input, voice input, and Reset

11. **Action:** Select **Reset**. In **Manual prompt**, enter
    `Can a Queen-size bed and a desk fit here without blocking the closet or the door?`, then select
    **Send**.
    **Expected:** The built-in room remains active; the exact typed request appears once and the
    accepted Queen + desk result appears.

12. **Action:** Select **Reset**, then **Prepare Nemotron live**. Keep the app online and open until
    the audio badge reports the exact
    `nemotron-speech-streaming-en-0.6b-generic-cpu:3` model in **LIVE** mode.
    **Expected:** Nemotron is the visible default voice model; Whisper does not activate unless its
    fallback control is explicitly selected.

13. **Action:** Select **Start recording**, speak a Queen + desk request, then select **Stop**.
    Review the editable transcript and any visible correction suggestion before selecting **Send**.
    **Expected:** Live text remains an unsent draft until Send; the exact edited text appears once
    in the conversation, and the resulting layout is shown.

14. **Action:** Start another recording, then select **Reset** while recording.
    **Expected:** Recording stops; the prompt, transcript, suggestions, and any manual-adjustment
    preview clear; and the built-in room remains active.

15. **Action:** Start a fresh recording after Reset, then stop it without sending.
    **Expected:** Recording starts normally and the editable transcript remains unsent.

If Nemotron fails and the UI exposes **Use Whisper Tiny fallback (record then transcribe)**, select
it only to test the record-then-transcribe fallback. It must never activate on its own.

## Troubleshooting

| Symptom | Action |
|---|---|
| npm rejects the Node.js or npm version before install or a script run | Install a supported Node.js version matching `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` and npm `>=11.18.0`, then confirm with `node --version` and `npm --version`. |
| `npm install-scripts` is unavailable | Upgrade to npm `>=11.18.0`, rerun `npm ci --no-audit --no-fund`, then approve Electron, esbuild, and Foundry Local SDK. |
| The control shows **Prepare offline** | Stay online, select it, and wait for the operation to finish. |
| The control shows **Load local model** | Select it and wait for **Local model ready**. |
| The control shows **Local model ready** | Continue to A. |
| A visible action fails | Retry once. If it still fails, close the app, relaunch with `npm run start:built`, confirm **Local model ready**, and repeat the failed action. |

## Clean shutdown

16. **Action:** Close the New Home App window and wait for `npm run start:built` to return to the
    PowerShell prompt.
    **Expected:** The window closes without a visible cleanup error and the launch command returns
    to the prompt.
