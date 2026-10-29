import { ChatSession, FoundryLocalManager, Item, Request, type Response } from "foundry-local-sdk";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createIntentDeltaJsonSchema, parseAndValidateIntentDelta } from "../src/domain/tool-contract";
import { resolveFoundryPaths } from "../src/foundry/paths";
import { formatTurnPrompt, stageTurns, systemPrompt } from "../src/foundry/prompt";
import { canonicalExecutionProvider, resolveRuntimeTarget } from "../src/foundry/runtime-config";

function responseText(response: Response): string {
  return response.output
    .flatMap((item) => {
      if (item.type === "text") {
        return item.text;
      }
      if (item.type === "message") {
        return typeof item.content === "string"
          ? item.content
          : (item.parts ?? [])
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("");
      }
      return "";
    })
    .join("")
    .trim();
}

const paths = await resolveFoundryPaths();
const manager = FoundryLocalManager.create({
  appName: "FoundryLocalNewHomeLayoutStructuredProbe",
  appDataDir: paths.appDataDir,
  modelCacheDir: paths.modelCacheDir,
  logsDir: paths.logsDir,
  logLevel: "warn",
  disableNonessentialTelemetry: true,
});

const target = resolveRuntimeTarget();
const model = await manager.catalog.getModelVariant(target.modelId);
const modelProvider = canonicalExecutionProvider(
  model.info.runtime?.executionProvider ?? model.info.executionProvider ?? "CPUExecutionProvider",
);
if (model.id !== target.modelId || modelProvider !== target.executionProvider) {
  throw new Error(
    `Configured runtime mismatch: resolved ${model.id} through ${modelProvider}, expected ${target.modelId} through ${target.executionProvider}.`,
  );
}
if (model.supportsToolCalling !== true) {
  throw new Error(`Configured exact model ${model.id} does not advertise tool calling.`);
}

try {
  if (!model.isCached) {
    await model.download();
  }
  const provider = manager
    .discoverEps()
    .find((candidate) => canonicalExecutionProvider(candidate.name) === target.executionProvider);
  if (target.executionProvider !== "CPUExecutionProvider" && provider === undefined) {
    throw new Error(`Configured execution provider ${target.executionProvider} is not discoverable.`);
  }
  if (provider !== undefined && !provider.isRegistered) {
    const registration = await manager.downloadAndRegisterEps([provider.name]);
    if (!registration.success || registration.failedEps.length > 0) {
      throw new Error(
        `Configured execution provider ${target.executionProvider} failed registration: ${registration.status}`,
      );
    }
  }
  await model.load();
  const session = new ChatSession(model);
  let state = createInitialDemoState();

  try {
    for (const turn of stageTurns) {
      let accepted = false;
      let priorError = "";
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const request = new Request();
        if (state.version === 0) {
          request.addItem(Item.systemMessage(systemPrompt));
        }
        const correction =
          attempt === 1 ? "" : `\nCORRECTION: ${priorError} Return corrected JSON for the same USER_REQUEST.`;
        request.addItem(Item.userMessage(`${formatTurnPrompt(turn.prompt, state)}${correction}`)).setOptions({
          search: {
            doSample: false,
            temperature: 0,
            seed: 42,
            maxOutputTokens: 256,
          },
          toolChoice: "none",
          additionalOptions: {
            guidance_type: "json_schema",
            guidance_data: JSON.stringify(createIntentDeltaJsonSchema(state, turn.prompt)),
            ...(model.info.supportsReasoning === true
              ? { chat_template_kwargs: JSON.stringify({ enable_thinking: false }) }
              : {}),
          },
        });
        const response = await session.processRequest(request);
        const text = responseText(response);
        const validation = parseAndValidateIntentDelta(text, state, turn.prompt);
        console.log(
          JSON.stringify(
            {
              turn: turn.id,
              attempt,
              finishReason: response.finishReason,
              text,
              validation,
            },
            null,
            2,
          ),
        );
        if (validation.ok) {
          const result = compareKnownLayoutOptions(validation.value.toolInput, state);
          state = applyToolResult(state, result);
          accepted = true;
          break;
        }
        priorError = `${validation.error.message} ${validation.error.details.join(" ")}`;
        session.undoTurns(1);
      }
      if (!accepted) {
        throw new Error(`${turn.id}: no valid semantic intent delta`);
      }
    }
  } finally {
    session.dispose();
  }
} finally {
  if (await model.isLoaded()) {
    await model.unload();
  }
  manager.dispose();
}
