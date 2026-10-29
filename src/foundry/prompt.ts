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
- desk: keep, standard, compact, or flexible. Use flexible when a desk may change, including adding a crib without a fixed desk size.
- crib: keep, add, or remove.
- Copy USER_REQUEST exactly into changedPreference.
- Set clarification to required only when USER_REQUEST names unsupported furniture; otherwise use none.
- Respect corrections and negation. "King instead" replaces Queen. "Do not switch to King" does not request King.
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
    "Return only the required intent-delta JSON. The application owns retained state, IDs, constraints, and geometry.",
  ].join("\n");
}
