import type { DemoStateSnapshot } from "../domain/types";
import type { StageTurnDefinition, StageTurnId } from "../shared/contracts";

export const defaultStageTurns: readonly StageTurnDefinition[] = [
  {
    id: "turn-a",
    label: "A · Queen + desk",
    prompt: "Can a Queen-size bed and a desk fit here without blocking the closet or the door?",
  },
  {
    id: "turn-b",
    label: "B · King conflict",
    prompt: "What changes if we use a King-size bed instead?",
  },
  {
    id: "turn-c",
    label: "C · Queen + desk + baby bed",
    prompt:
      "Can we do a Queen bed and a desk, and also add a baby bed? A compact desk is fine if needed. Keep the door, closet, and window clear, and leave the 250 mm furniture-clearance rule locked.",
  },
  {
    id: "controlled-failure",
    label: "E · King controlled failure",
    prompt: "Use a King bed. Keep the compact desk and baby bed. Keep the door, closet, and window clear.",
  },
] as const;

export const importedStageTurns: readonly StageTurnDefinition[] = [
  {
    id: "turn-a",
    label: "A · Imported Queen + desk",
    prompt:
      "In the imported bedroom, can a Queen-size bed and a desk fit while keeping the door, closet, and window clear?",
  },
  {
    id: "turn-b",
    label: "B · Imported King conflict",
    prompt: "What changes in the imported room if we use a King-size bed instead?",
  },
  {
    id: "turn-c",
    label: "C · Imported Queen + desk + baby bed",
    prompt:
      "Can we do a Queen bed and a desk in the imported bedroom, and also add a baby bed? A compact desk is fine if needed. Keep the door, closet, and window clear, and leave the 250 mm furniture-clearance rule locked.",
  },
  {
    id: "controlled-failure",
    label: "E · Imported King failure",
    prompt:
      "In the imported bedroom use a King bed. Keep the compact desk and baby bed. Keep the door, closet, and window clear.",
  },
] as const;

export const stageTurns = defaultStageTurns;

export function stageTurnsForMode(mode: "default" | "imported"): readonly StageTurnDefinition[] {
  return mode === "imported" ? importedStageTurns : defaultStageTurns;
}

export function nextPendingStageTurnIndex(
  turns: readonly StageTurnDefinition[],
  completedTurnIds: readonly StageTurnId[],
): number {
  return turns.findIndex((turn) => !completedTurnIds.includes(turn.id));
}

export const systemPrompt = `
Return one JSON semantic delta for the bedroom request.
- bed: keep, queen, or king.
- desk: keep, standard, compact, or flexible. Use flexible whenever the user requests a desk without a fixed size or adds a baby bed/crib without fixing the desk size.
- crib: keep, add, or remove. Treat baby bed, baby-bed, baby cot, and crib as the same supported intent.
- Decide each dimension independently. Use keep only when that dimension is unchanged; do not use keep when the request names a new target.
- Do not repeat USER_REQUEST in the JSON. The application preserves it exactly as changedPreference.
- clarification defaults to none. Use required only for unsupported furniture, conflicting choices, or wording that lacks a required choice.
- Respect transition direction and scoped negation. "Replace King with Queen" and "from King to Queen" select Queen. "Do not remove the baby bed" keeps it.
- Exact mappings: "King instead" -> bed=king; "add/bring in a baby bed" -> crib=add; "remove the baby bed" -> crib=remove; "desk may adjust" -> desk=flexible.
- dresser, armchair, cabinet, bassinet, and night stand are unsupported, so clarification=required. Queen/King beds, desks, and baby bed/crib aliases are supported.
- Interpret requirements only. Never emit catalog IDs, state references, dimensions, placements, fit, conflicts, status, or any geometry verdict.
`.trim();

export function formatTurnPrompt(userPrompt: string, state: DemoStateSnapshot): string {
  const active = {
    bed:
      state.activeFurnitureIds.find((id) => id === "bed-queen" || id === "bed-king")?.replace("bed-", "") ??
      "none",
    desk:
      state.activeFurnitureIds
        .find((id) => id === "desk-standard" || id === "desk-compact")
        ?.replace("desk-", "") ?? "none",
    crib: state.activeFurnitureIds.includes("crib-standard") ? "present" : "none",
  };
  return [
    `CURRENT_ACCEPTED: ${JSON.stringify(active)}`,
    `USER_REQUEST: ${userPrompt}`,
    "Interpret each dimension relative to CURRENT_ACCEPTED: use the named transition target, and use keep for an unmentioned dimension.",
    "Use clarification=none unless the request itself is unsupported, conflicting, or missing a required choice.",
    "Return only the required intent-delta JSON. The application owns retained state, IDs, constraints, and geometry.",
  ].join("\n");
}
