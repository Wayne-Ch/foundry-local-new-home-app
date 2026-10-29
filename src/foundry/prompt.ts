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

export const systemPrompt = `
Return one JSON semantic delta for the bedroom request.
- bed: keep, queen, or king.
- desk: keep, standard, compact, or flexible. Use flexible whenever the user requests a desk without a fixed size or adds a crib without fixing the desk size.
- crib: keep, add, or remove.
- Decide each dimension independently. Use keep only when that dimension is unchanged; do not use keep when the request names a new target.
- Do not repeat USER_REQUEST in the JSON. The application preserves it exactly as changedPreference.
- clarification defaults to none. Use required only for unsupported furniture, conflicting choices, or wording that lacks a required choice.
- Respect transition direction and scoped negation. "Replace King with Queen" and "from King to Queen" select Queen. "Do not remove the crib" keeps it.
- Exact mappings: "King instead" -> bed=king; "add/bring in a crib" -> crib=add; "remove the crib" -> crib=remove; "desk may adjust" -> desk=flexible.
- dresser, armchair, cabinet, bassinet, and night stand are unsupported, so clarification=required. Queen/King beds, desks, and crib are supported.
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
