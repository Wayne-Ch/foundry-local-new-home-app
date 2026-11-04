# New Home App playtest

This is the complete first-time colleague route for New Home App.

First preparation can take several minutes while model and execution-provider assets are
downloaded. Stay online and keep New Home App open until local setup is ready; later demo actions
can run offline.

## Requirements

- Windows 11 x64
- Git
- A WebGPU-capable graphics adapter and current driver; the layout model uses
  `WebGPUExecutionProvider`
- Supported Node.js range: `^22.12.0 || ^24.0.0 || >=26.0.0`; Node 23.x and 25.x are not supported
- Supported npm minimum: `>=11.18.0`; this is required for `npm install-scripts`
- Internet access for installation and first preparation
- Several GB of free disk space for dependencies and model assets
- No minimum RAM value has been established by testing
- A microphone is needed only for voice-path testing; typed and scripted flows remain available
  without one

## Validated configuration

This playtest's current E2E evidence was collected with Node `26.13.0` and npm `11.20.0` on Windows
11 x64 with an AMD Radeon 860M and 64 GB RAM. AMD Radeon 860M identifies the evidence machine; it is
not a minimum or required adapter. The product requirement is a WebGPU-capable graphics
adapter/driver for the current layout model configuration. Foundry Local's broader public platform
and hardware support is separate, and other app environments must not be presented as having
equivalent evidence until tested to the same depth.

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
npm run check:release-contract
npm run build
npm run start:built
```

Do not switch branches or reuse another checkout's `node_modules`, Electron profile, app data, or
temporary files.

## Prepare the exact local model

The normal setup button is determined only by `readiness.modelCached`; WebGPU provider registration
does not select the wording:

| Normal setup state | `modelCached` | Exact control | Operator action |
|---|---:|---|---|
| Cold, empty shared model cache | `false` | **Prepare offline** | Select it while online to download the exact model and prepare local runtime assets. |
| Warm shared cache with a fresh product root | `true` | **Load local model** | Select it; the shared model is present even though this product has not loaded it. |
| Model cached; product-specific WebGPU provider registration still needed | `true` | **Load local model** | Select it. Provider registration does not change the label. |
| Loaded READY state | `true` | **Local model ready** | Do not select it; continue only when the green ready state is visible. |

1. **Action:** Confirm the window, page heading, and package product are **New Home App** and the
   verified built-in bedroom is already active.
   **Expected:** No setup, room-selection, or floor-plan import screen appears.
   **Stop if:** The title differs, the room is absent, or an intake screen appears.

2. **Action:** Follow the table using the exact visible control. On a cold cache, select
   **Prepare offline**. When the model is already cached but the runtime is not READY - including
   product-specific WebGPU provider registration - select **Load local model**. Keep the app open
   and online.
   **Expected:** The green badge reaches **Local model ready** and identifies
   `qwen3-0.6b-generic-gpu:2` with `WebGPUExecutionProvider`; Developer trace reports no external
   endpoint.
   **Stop if:** Another model/provider is selected, the app becomes ready before preparation
   completes, preparation fails, or an external endpoint is used.

## A through E

Mapping: **A** Queen + desk, **B** King conflict, **C** Queen + desk + baby bed, **D** app-owned
manual adjustment, **E** King controlled failure.

3. **Action (A):** Select **Run next: A · Queen + desk**.
   **Expected:** Queen + rotated standard desk is accepted; the Buyer request appears once and
   Application evidence is conclusion-only.
   **Stop if:** The request is duplicated or the accepted layout differs.

4. **Action (B):** Select **Run next: B · King conflict**.
   **Expected:** A King rejected preview appears automatically with **Rejected preview · not
   accepted**; A remains accepted and rejected furniture is not interactive.
   **Stop if:** A is replaced, another inference is required to see the rejection, or rejected
   furniture can be focused, dragged, or applied.

5. **Action:** Select **Show accepted layout**, then **Inspect rejected option**.
   **Expected:** The preserved A layout and the same B evidence alternate without changing state
   version, message count, or inference activity.
   **Stop if:** A new Buyer/Application message appears, inference starts, or the evidence changes.

6. **Action (C):** Select **Run next: C · Queen + desk + baby bed**.
   **Expected:** Queen + compact desk + baby bed is accepted and E becomes the next scripted turn.
   **Stop if:** An extra story branch appears, an item is missing, or a locked check changes.

7. **Action (D):** For each accepted item - Queen bed, compact desk, and baby bed - drag it exactly
   50 mm to the right, verify the valid ghost preview, then select **Revert**.
   **Expected:** Every furniture type supports pointer adjustment; Revert restores the accepted
   coordinates and no Buyer/model turn is added.
   **Stop if:** Any item cannot be dragged, movement is not 50 mm, inference starts, or another
   item's coordinates change.

8. **Action (D):** Focus each accepted item and press Right Arrow once. Revert the Queen and baby-bed
   previews; select **Apply** for the compact-desk preview.
   **Expected:** Every furniture type supports a 50 mm keyboard preview. Apply creates one new
   app-owned accepted layout version, Revert preserves the prior accepted version, and no Buyer/model
   turn is added.
   **Stop if:** Focus is lost, movement differs from 50 mm, Apply accepts an invalid preview, or
   model inference starts.

9. **Action (E):** Select **Run next: E · King controlled failure**.
   **Expected:** A King rejected preview appears automatically; C/D remains accepted and rejected
   furniture is non-interactive.
   **Stop if:** The preserved accepted layout changes or the rejected option can be applied.

10. **Action:** Select **Show accepted layout**, then **Inspect rejected option**.
    **Expected:** The existing C/D state and the same E evidence alternate with no inference and no
    message/state change.
    **Stop if:** Progress starts, the applied D adjustment is lost, or evidence changes.

## Typed input, voice input, and Reset

11. **Action:** Select **Reset**. In **Manual prompt**, enter
    `Can a Queen-size bed and a desk fit here without blocking the closet or the door?`, then select
    **Send**.
    **Expected:** State v0 retains the built-in room; the exact typed request appears once and the
    normal local planning/validation path produces the accepted Queen + desk result.
    **Stop if:** Reset loses the room, the prompt is changed, or typed input bypasses local planning.

12. **Action:** Select **Reset**, then **Prepare Nemotron live**. Keep the app online and open until
    the audio badge reports the exact
    `nemotron-speech-streaming-en-0.6b-generic-cpu:3` model in **LIVE** mode.
    **Expected:** Nemotron is the explicit default voice model; no online speech service or silent
    fallback is used.
    **Stop if:** Another model is selected, preparation fails, or Whisper activates without an
    explicit choice.

13. **Action:** Select **Start recording**, speak a Queen + desk request, then select **Stop**.
    Review the editable transcript and any visible correction suggestion before selecting **Send**.
    **Expected:** Live text remains an unsent draft until Send; the exact edited text is then
    submitted through the same local planning/validation path.
    **Stop if:** Stop auto-submits, a suggestion changes text without explicit action, or an
    external endpoint is used.

14. **Action:** Start another recording, then select **Reset** while recording.
    **Expected:** Recording stops, stream ownership is released, prompt/transcript/suggestions/manual
    state clear, State v0 returns, and the built-in room remains active.
    **Stop if:** Audio continues, stale results reappear, or the room is lost.

15. **Action:** Start a fresh recording after Reset, then stop it without sending.
    **Expected:** A new stream lease succeeds and the editable transcript remains unsent.
    **Stop if:** The old stream is reused or the transcript auto-submits.

If Nemotron deterministically fails and the UI exposes **Whisper Tiny fallback (record then
transcribe)**, selecting it is an explicit fallback check. It must never activate silently.

## Troubleshooting

| Symptom | Action |
|---|---|
| npm rejects the Node.js or npm version before install or a script run | Install a supported Node.js version matching `^22.12.0 || ^24.0.0 || >=26.0.0` and npm `>=11.18.0`. Node 23.x and 25.x are intentionally excluded. The validated pair is Node `26.13.0` with npm `11.20.0`; confirm with `node --version` and `npm --version`. |
| `npm install-scripts` is unavailable | The npm version is below the supported minimum. Upgrade to npm `>=11.18.0` (validated: `11.20.0`), rerun `npm ci --no-audit --no-fund`, then approve the three pinned install scripts. |
| A cold empty cache shows **Prepare offline** | This is the expected `modelCached=false` label. Stay online, select it, and wait for the operation to finish. |
| A warm shared cache, fresh product root, or pending product-specific WebGPU registration shows **Load local model** | This is the expected `modelCached=true` label. Select **Load local model**; do not look for **Prepare offline** based on provider state. |
| The control shows **Local model ready** | The runtime is loaded and READY. Do not select the disabled control; continue to A. |

## Clean shutdown

16. **Action:** Close the New Home App window and wait for `npm run start:built` to return to the
    PowerShell prompt.
    **Expected:** The command exits without cleanup errors; no app-owned recording, model session,
    Electron child process, or temporary audio capture remains.
    **Stop if:** The command remains running, cleanup reports an error, or app-owned activity
    continues after the window closes.

Record a pass only when every step above succeeds without a branch change, copied dependencies,
profile reuse, manual file edit, environment override, or undocumented retry.
