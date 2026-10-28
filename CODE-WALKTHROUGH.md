# Concise code walkthrough

Use these snippets from **4:00–11:30**. The talk's core is how developers use Foundry Local, not the
interior-design story.

## 4:00–4:35 — Orient from UI to process boundary

Start with `ARCHITECTURE.md` and the open Developer trace. Map renderer -> Electron main -> Foundry
Local audio/text sessions -> validation -> geometry -> evidence. Then move immediately into real
code.

## 4:35–5:30 — SDK lifecycle and exact local models

**File:** `src/foundry/foundry-service.ts`

**Symbols:** `initialize`, `prepareOffline`, `prepareAudioOffline`, `shutdown`

Put on screen:

- `FoundryLocalManager.create`;
- `modelCacheDir`;
- `disableNonessentialTelemetry: true`;
- exact public-catalog lookup for `qwen2.5-1.5b-instruct-generic-gpu:4`;
- one-time exact-model download when the cache is empty;
- exact `WebGPUExecutionProvider` matching and registration;
- exact `openai-whisper-tiny-generic-cpu:4` selection on CPU;
- separate text/audio readiness from one `FoundryLocalManager`;
- `downloadAndRegisterEps`;
- `model.load()` / `model.unload()` / `manager.dispose()`.

Message:

> The app embeds the SDK. It does not shell out to the CLI and does not start a cloud or loopback
> inference endpoint.

## 5:30–6:10 — Minimal local audio checkpoint

**Files:** `src/renderer/audio-capture.ts`, `src/audio/audio-contract.ts`,
`src/foundry/foundry-service.ts`

**Symbols:** `recordedBlobToAudioPayload`, `validateAudioCapturePayload`, `transcribeAudio`

Put on screen:

- explicit `getUserMedia` button path and 20-second limit;
- downmix/resample to PCM16LE, 16 kHz, mono;
- typed IPC format/duration/size validation;
- temporary WAV file because v2.2.1 rejects one-shot inline audio data;
- native `AudioSession` and `Item.audioFromUri`;
- `finally` cleanup and transcript draft with `shouldSubmit: false`.

Message:

> Audio is an optional local input adapter. The user reviews the transcript before it becomes an
> ordinary text turn; ASR never calls geometry.

## 6:10–7:10 — Multi-turn local planning request

**File:** `src/foundry/foundry-service.ts`

**Symbol:** `runTurn`

Put on screen:

```ts
const request = new Request()
  .addItem(Item.userMessage(formatTurnPrompt(userPrompt, state)))
  .setOptions({
    search: { doSample: false, temperature: 0, seed: 42, maxOutputTokens: 1800 },
    toolChoice: "none",
    additionalOptions: {
      guidance_type: "json_schema",
      guidance_data: JSON.stringify(createPlannerJsonSchema(state, { prompt: userPrompt })),
    },
  });
```

Then show the three-attempt loop and `session.undoTurns(1)`.

Message:

> One `ChatSession` owns conversation history. Each request sends only the new turn plus the current
> application state reference.

## 7:10–8:40 — Tool contract and fail-closed validation

**File:** `src/domain/tool-contract.ts`

**Symbols:** `compareLayoutOptionsInputSchema`, `parseAndValidateToolInput`,
`validateExplicitPromptConstraints`

Put on screen:

- fixed room/rule/state-set versions;
- bed/desk/crib catalog slots;
- retained furniture;
- millimetres only;
- stale-state rejection;
- explicit King/Queen/crib correction guard;
- missing verified dimension handling.

Message:

> Runtime grammar gives us syntactic structure. Application validation gives us state and domain
> correctness.

## 8:40–9:50 — Deterministic geometry and typed failure

**Files:** `src/domain/geometry.ts`, `src/domain/layout-engine.ts`

**Symbols:** `evaluateLayoutOption`, `compareKnownLayoutOptions`

Put on screen:

- rectangle overlap;
- quarter-circle door swing;
- 250 mm pair clearance;
- `feasibleOptions`, `rejectedOptions`, `evidenceOptionId`, option-scoped `conflicts`,
  separately labeled `aggregateConflicts`, `noResultReason`, and `provenance`.

Message:

> The model never sees an API that can declare a fit. It can only propose catalog IDs; normal code
> computes the verdict.

## 9:50–10:50 — Evidence UI, not chain-of-thought

**File:** `src/renderer/renderer.ts`

**Symbols:** `renderLayout`, `renderRoomSvg`, `renderTrace`

Put on screen:

- rejected-option preview whose placements, checks, and conflicts all come from one exact option;
- retained accepted-layout labeling when no option was evaluated;
- current accepted layout preservation;
- structured tool plan;
- separate ASR model/transcript evidence;
- app validation;
- deterministic geometry result;
- provider/model/readiness identity.

Message:

> The trace exposes structured inputs and outputs, never hidden reasoning. Free-form model prose is
> not trusted for the verdict.

## 10:50–11:30 — Acceptance proof and transition to live offline turn

**Files:** `scripts/run-foundry-integration.ts`, `scripts/run-audio-integration.ts`

Show only:

- exact five turns;
- expected furniture IDs;
- closet conflict assertion;
- no-feasible assertion;
- negation/correction assertion;
- exact default model-ID and WebGPU-EP assertions;
- exact Whisper Tiny ID/CPU-EP assertion and transcript recall;
- temporary WAV cleanup assertion;
- `externalEndpointUsed === false`.

Then return to the app for the single fresh offline controlled-failure input. Do not attempt to run
all four story turns live; measured Windows latency is 11–31 seconds per turn.
