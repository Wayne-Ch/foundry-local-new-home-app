import {
  CLEARANCE_RULE_SET_ID,
  CLEARANCE_RULE_SET_VERSION,
  furnitureCatalog,
  LOCKED_CONSTRAINT_SET_ID,
  REQUIRED_ROOM_STATE_SET_ID,
  ROOM_PLAN_ID,
  ROOM_PLAN_VERSION,
} from "../domain/fixture";
import type { DemoStateSnapshot } from "../domain/types";
import type { StageTurnDefinition } from "../shared/contracts";

export const stageTurns: readonly StageTurnDefinition[] = [
  {
    id: "turn-a",
    label: "A · Queen + desk",
    prompt: "Can a Queen-size bed and a desk fit here without blocking the closet or the door?",
  },
  {
    id: "turn-b",
    label: "B · Change to King",
    prompt: "What changes if we use a King-size bed instead?",
  },
  {
    id: "turn-c",
    label: "C · Add a crib",
    prompt: "We may need a crib. Keep the Queen-size bed and add a crib without blocking the closet.",
  },
  {
    id: "controlled-failure",
    label: "Failure · King + desk + crib",
    prompt: "Try a King-size bed, a desk, and the crib together. Keep the desk and crib if possible.",
  },
] as const;

const catalogForPrompt = Object.values(furnitureCatalog).map((item) => ({
  id: item.id,
  label: item.label,
  category: item.category,
  widthMm: item.widthMm,
  depthMm: item.depthMm,
}));

export const systemPrompt = `
You are the local requirements interpreter for the Foundry Local New Home Layout Demo.
- For every user layout request, immediately call compare_layout_options exactly once.
- You interpret requirements only. Never decide fit, invent geometry, infer measurements, or create IDs.
- Copy all fixed fields from REQUIRED_TOOL_ARGUMENT_TEMPLATE exactly.
- candidateFurnitureIds is the requested resulting layout. A replacement removes the old ID.
- retainFurnitureIds contains only active furniture the user explicitly keeps.
- "King instead" means bed-king replaces bed-queen.
- A crib with a bed and revisable desk uses desk-compact.
- Missing verified facts go in unknowns with clarificationNeeded=true; otherwise use [] and false.
- The room, door, closet, window, clearance rules, and catalog dimensions are already verified. They are not unknown.
- On the first turn activeFurnitureIds is empty, so retainFurnitureIds must be empty.
- Catalog IDs: ${JSON.stringify(catalogForPrompt.map(({ id, label }) => ({ id, label })))}
- Examples:
  current [] + "Queen bed and desk" -> candidates {"bed":"bed-queen","desk":"desk-standard","crib":null}, retain []
  current Queen + standard desk + "King instead" -> candidates {"bed":"bed-king","desk":"desk-standard","crib":null}, retain ["desk-standard"]
  current Queen + standard desk + "keep Queen and add crib" -> candidates {"bed":"bed-queen","desk":"desk-compact","crib":"crib-standard"}, retain ["bed-queen"]
  current Queen + compact desk + crib + "King, desk, crib; keep desk and crib" -> candidates {"bed":"bed-king","desk":"desk-compact","crib":"crib-standard"}, retain ["desk-compact","crib-standard"]
- After the tool result, summarize only its evidence in at most 75 words.
- For no_feasible_option, name the returned conflicts and ask which listed preference may change.
- This is footprint planning, not safety, structural, accessibility, or global-optimization advice.
`.trim();

export function formatTurnPrompt(userPrompt: string, state: DemoStateSnapshot): string {
  const toolArgumentTemplate = {
    roomPlanId: ROOM_PLAN_ID,
    planVersion: ROOM_PLAN_VERSION,
    priorStateRef: state.stateRef,
    clearanceRuleSetId: CLEARANCE_RULE_SET_ID,
    clearanceRuleSetVersion: CLEARANCE_RULE_SET_VERSION,
    requiredRoomStateSetId: REQUIRED_ROOM_STATE_SET_ID,
    lockedConstraintSetId: LOCKED_CONSTRAINT_SET_ID,
    unit: "mm",
  };

  return [
    "APP_STATE_CONTEXT:",
    JSON.stringify({
      stateRef: state.stateRef,
      version: state.version,
      currentLayoutId: state.currentLayoutId,
      activeFurnitureIds: state.activeFurnitureIds,
      roomPlanId: ROOM_PLAN_ID,
      planVersion: ROOM_PLAN_VERSION,
      clearanceRuleSetId: CLEARANCE_RULE_SET_ID,
      clearanceRuleSetVersion: CLEARANCE_RULE_SET_VERSION,
      unit: "mm",
      requiredRoomStateSetId: REQUIRED_ROOM_STATE_SET_ID,
      lockedConstraintSetId: LOCKED_CONSTRAINT_SET_ID,
    }),
    "REQUIRED_TOOL_ARGUMENT_TEMPLATE:",
    JSON.stringify(toolArgumentTemplate),
    `USER_REQUEST: ${userPrompt}`,
    "Copy the fixed fields above. Fill every remaining required schema field from USER_REQUEST and APP_STATE_CONTEXT. Use USER_REQUEST verbatim as changedPreference.",
    "Call compare_layout_options now. Do not answer the layout question before the tool result.",
  ].join("\n");
}
