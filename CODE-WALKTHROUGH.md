# Concise code walkthrough

Use these snippets from **4:00–11:30**. The talk's core is how developers use Foundry Local, not the
interior-design story.

## 4:00–4:45 — Orient from UI to process boundary

Start with `ARCHITECTURE.md` and the open Developer trace. Map renderer -> Electron main -> Foundry
Local -> validation -> geometry -> evidence. Then move immediately into real code.

## 4:45–6:00 — SDK lifecycle and exact local model

**File:** `src/foundry/foundry-service.ts`

**Symbols:** `initialize`, `prepareOffline`, `#loadModel`, `shutdown`

Put on screen:

- `FoundryLocalManager.create`;
- `modelCacheDir`;
- `disableNonessentialTelemetry: true`;
- cached model selection;
- `downloadAndRegisterEps`;
- `model.load()` / `model.unload()` / `manager.dispose()`.

Message:

> The app embeds the SDK. It does not shell out to the CLI and does not start a cloud or loopback
> inference endpoint.

## 6:00–7:15 — Multi-turn local planning request

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

## 7:15–9:00 — Tool contract and fail-closed validation

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

## 9:00–10:15 — Deterministic geometry and typed failure

**Files:** `src/domain/geometry.ts`, `src/domain/layout-engine.ts`

**Symbols:** `evaluateLayoutOption`, `compareKnownLayoutOptions`

Put on screen:

- rectangle overlap;
- quarter-circle door swing;
- 250 mm pair clearance;
- `feasibleOptions`, `rejectedOptions`, `conflicts`, `noResultReason`, `provenance`.

Message:

> The model never sees an API that can declare a fit. It can only propose catalog IDs; normal code
> computes the verdict.

## 10:15–11:15 — Evidence UI, not chain-of-thought

**File:** `src/renderer/renderer.ts`

**Symbols:** `renderLayout`, `renderRoomSvg`, `renderTrace`

Put on screen:

- rejected-option conflict preview;
- current accepted layout preservation;
- structured tool plan;
- app validation;
- deterministic geometry result;
- provider/model/readiness identity.

Message:

> The trace exposes structured inputs and outputs, never hidden reasoning. Free-form model prose is
> not trusted for the verdict.

## 11:15–11:30 — Acceptance proof and transition to live offline turn

**File:** `scripts/run-foundry-integration.ts`

Show only:

- exact five turns;
- expected furniture IDs;
- closet conflict assertion;
- no-feasible assertion;
- negation/correction assertion;
- `externalEndpointUsed === false`.

Then return to the app for the single fresh offline controlled-failure input. Do not attempt to run
all four story turns live; measured Windows latency is 11–30 seconds per turn.
