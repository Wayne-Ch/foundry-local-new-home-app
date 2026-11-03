import { afterEach, describe, expect, it, vi } from "vitest";
import { nextPendingStageTurnIndex, stageTurnsForMode } from "../src/foundry/prompt";
import { createPreviewApi } from "../src/renderer/preview-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderer preview scenarios", () => {
  it.each([
    ["default A", "?preview=1&step=queen", "default", "queen-desk-standard-v1", 2],
    ["default C", "?preview=1&step=request", "default", "queen-crib-compact-v1", 3],
    ["imported A", "?preview=1&room=imported&step=queen", "imported", "imported-queen-desk-standard-v1", 2],
    ["imported C", "?preview=1&room=imported&step=request", "imported", "imported-queen-crib-compact-v1", 3],
  ] as const)(
    "renders the accepted %s layout through the real preview API",
    async (_label, search, roomMode, layoutId, placementCount) => {
      vi.stubGlobal("window", { location: { search } });

      const bootstrap = await createPreviewApi().getBootstrap();

      expect(bootstrap.roomMode).toBe(roomMode);
      expect(bootstrap.selectedLayout).toMatchObject({
        id: layoutId,
        status: "feasible",
      });
      expect(bootstrap.selectedLayout?.placements).toHaveLength(placementCount);
      expect(bootstrap.lastToolResult?.status).toBe("feasible");
      expect(bootstrap.floorPlanImport.status).toBe(roomMode === "imported" ? "imported" : "idle");
    },
  );

  it.each([
    ["default feasible", "?preview=1&step=queen", "default", 0],
    ["default buyer request", "?preview=1&step=request", "default", 2],
    ["default rejected", "?preview=1&step=failure", "default", 3],
    ["imported feasible", "?preview=1&room=imported&step=queen", "imported", 0],
    ["imported buyer request", "?preview=1&room=imported&step=request", "imported", 2],
    ["imported rejected", "?preview=1&room=imported&step=failure", "imported", 3],
  ] as const)(
    "keeps Buyer prompts separate from Application evidence for %s without changing trace provenance",
    async (_label, search, roomMode, turnIndex) => {
      vi.stubGlobal("window", { location: { search } });
      const expectedPrompt = stageTurnsForMode(roomMode)[turnIndex]?.prompt ?? "";

      const bootstrap = await createPreviewApi().getBootstrap();
      const applicationMessage = bootstrap.messages.at(-1);
      const buyerMessage = bootstrap.messages.at(-2);
      const validationTrace = bootstrap.trace.find((entry) => entry.kind === "validation");
      const geometryTrace = bootstrap.trace.find((entry) => entry.kind === "geometry");
      const buyerMessages = bootstrap.messages.filter((message) => message.role === "user");
      const applicationMessages = bootstrap.messages.filter((message) => message.role === "application");

      expect(applicationMessage).toMatchObject({
        role: "application",
      });
      expect(buyerMessage).toMatchObject({
        role: "user",
        text: expectedPrompt,
      });
      expect(buyerMessages).toHaveLength(applicationMessages.length);
      for (const [index, visibleBuyer] of buyerMessages.entries()) {
        const visibleEvidence = applicationMessages[index];
        expect(visibleEvidence).toBeDefined();
        expect(visibleEvidence?.text).not.toContain(visibleBuyer.text);
        expect(visibleEvidence?.text).not.toContain("User request");
        expect(visibleEvidence?.text).not.toContain("Preference interpreted");
        expect(visibleEvidence?.text).not.toContain("Application evidence");
        expect(bootstrap.messages.filter((message) => message.text.includes(visibleBuyer.text))).toEqual([
          visibleBuyer,
        ]);
      }
      expect(validationTrace?.payload).toMatchObject({
        input: {
          changedPreference: expectedPrompt,
        },
      });
      expect(geometryTrace?.payload).toMatchObject({
        changedPreference: expectedPrompt,
      });
    },
  );

  it("leaves C pending after B until the buyer explicitly runs or submits it", async () => {
    vi.stubGlobal("window", { location: { search: "?preview=1&step=conflict" } });
    const turns = stageTurnsForMode("default");

    const bootstrap = await createPreviewApi().getBootstrap();

    expect(bootstrap.completedStageTurnIds).toEqual(["turn-a", "turn-b"]);
    expect(nextPendingStageTurnIndex(turns, bootstrap.completedStageTurnIds)).toBe(2);
    expect(bootstrap.messages.some((message) => message.text === turns[2]?.prompt)).toBe(false);
  });

  it.each([
    {
      label: "B after A",
      search: "?preview=1&room=imported&step=conflict",
      stateVersion: 2,
      acceptedLayoutId: "imported-queen-desk-standard-v1",
      evidenceLayoutId: "imported-king-desk-standard-v1",
      evaluatedLayoutIds: ["imported-king-desk-standard-v1"],
      measurements: [[70, 250]],
      turnIndex: 1,
      evidenceVerdict:
        "The King + desk option conflicts with closet access. Which preference may change: bed size, desk footprint or orientation?",
    },
    {
      label: "E after buyer-request C",
      search: "?preview=1&room=imported",
      stateVersion: 4,
      acceptedLayoutId: "imported-queen-crib-compact-v1",
      evidenceLayoutId: "imported-king-crib-compact-east-v1",
      evaluatedLayoutIds: ["imported-king-crib-compact-east-v1", "imported-king-crib-compact-door-v1"],
      measurements: [
        [70, 250],
        [170, 250],
        [350, 250],
      ],
      turnIndex: 3,
      evidenceVerdict:
        "No feasible known option. The prior accepted layout remains active on the main canvas. Exact rejected-option evidence remains visible, and Inspect rejected option opens its preview without accepting it.",
    },
  ])(
    "preserves accepted state and exact rejected evidence for $label",
    async ({
      search,
      stateVersion,
      acceptedLayoutId,
      evidenceLayoutId,
      evaluatedLayoutIds,
      measurements,
      turnIndex,
      evidenceVerdict,
    }) => {
      vi.stubGlobal("window", { location: { search } });
      const expectedPrompt = stageTurnsForMode("imported")[turnIndex]?.prompt ?? "";

      const bootstrap = await createPreviewApi().getBootstrap();
      const evidenceLayout = bootstrap.lastToolResult?.rejectedOptions.find(
        (option) => option.id === bootstrap.lastToolResult?.evidenceOptionId,
      );
      const validationTrace = bootstrap.trace.find((entry) => entry.kind === "validation");

      expect(bootstrap.state).toMatchObject({
        version: stateVersion,
        currentLayoutId: acceptedLayoutId,
        currentLayoutSource: "known-option",
        lastResultStatus: "no_feasible_option",
      });
      expect(bootstrap.selectedLayout).toMatchObject({
        id: acceptedLayoutId,
        status: "feasible",
      });
      expect(bootstrap.lastToolResult).toMatchObject({
        status: "no_feasible_option",
        selectedOptionId: null,
        evidenceOptionId: evidenceLayoutId,
        provenance: {
          roomPlanId: "imported-nara-master-bedroom",
          evaluatedLayoutIds,
        },
      });
      expect(
        evidenceLayout?.measurements.map((measurement) => [
          measurement.actualDistanceMm,
          measurement.requiredDistanceMm,
        ]),
      ).toEqual(measurements);
      expect(bootstrap.messages.at(-2)).toMatchObject({
        role: "user",
        text: expectedPrompt,
      });
      expect(bootstrap.messages.at(-1)).toMatchObject({
        role: "application",
        text: evidenceVerdict,
      });
      expect(validationTrace?.payload).toMatchObject({
        input: {
          changedPreference: expectedPrompt,
        },
      });
    },
  );
});
