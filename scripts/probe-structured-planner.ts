import { ChatSession, FoundryLocalManager, Item, Request, type Response } from "foundry-local-sdk";
import { applyToolResult, createInitialDemoState } from "../src/domain/demo-state";
import { compareKnownLayoutOptions } from "../src/domain/layout-engine";
import { createPlannerJsonSchema, parseAndValidateToolInput } from "../src/domain/tool-contract";
import { resolveFoundryPaths } from "../src/foundry/paths";
import { formatTurnPrompt, stageTurns, systemPrompt } from "../src/foundry/prompt";

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

const requestedModelId = process.env.FOUNDRY_MODEL_ID?.trim() || "qwen3-1.7b-generic-gpu:2";
const model = (await manager.catalog.getCachedModels()).find(
  (candidate) => candidate.id === requestedModelId && candidate.supportsToolCalling === true,
);
if (model === undefined) {
  throw new Error(`Cached tool-capable model ${requestedModelId} not found.`);
}

try {
  await manager.downloadAndRegisterEps(["WebGpuExecutionProvider"]);
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
            maxOutputTokens: 700,
          },
          toolChoice: "none",
          additionalOptions: {
            guidance_type: "json_schema",
            guidance_data: JSON.stringify(createPlannerJsonSchema(state, { prompt: turn.prompt })),
            ...(model.info.supportsReasoning === true
              ? { chat_template_kwargs: JSON.stringify({ enable_thinking: false }) }
              : {}),
          },
        });
        const response = await session.processRequest(request);
        const text = responseText(response);
        const validation = parseAndValidateToolInput(text, state, turn.prompt);
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
          const result = compareKnownLayoutOptions(validation.value, state);
          state = applyToolResult(state, result);
          accepted = true;
          break;
        }
        priorError = `${validation.error.message} ${validation.error.details.join(" ")}`;
        session.undoTurns(1);
      }
      if (!accepted) {
        throw new Error(`${turn.id}: no valid structured plan`);
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
