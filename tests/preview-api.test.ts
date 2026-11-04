import { afterEach, describe, expect, it, vi } from "vitest";
import { nextPendingStageTurnIndex, stageTurns } from "../src/foundry/prompt";
import { createPreviewApi } from "../src/renderer/preview-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("standard renderer preview scenarios", () => {
  it.each([
    ["A", "?preview=1&step=queen", "queen-desk-standard-v1", 2, ["turn-a"]],
    ["B", "?preview=1&step=conflict", "queen-desk-standard-v1", 2, ["turn-a", "turn-b"]],
    ["C", "?preview=1&step=request", "queen-crib-compact-v1", 3, ["turn-a", "turn-b", "turn-c"]],
    [
      "E",
      "?preview=1&step=failure",
      "queen-crib-compact-v1",
      3,
      ["turn-a", "turn-b", "turn-c", "controlled-failure"],
    ],
  ] as const)(
    "renders standard story step %s with the preserved accepted layout",
    async (_label, search, layoutId, placementCount, completedStageTurnIds) => {
      vi.stubGlobal("window", { location: { search } });

      const bootstrap = await createPreviewApi().getBootstrap();

      expect(bootstrap.selectedLayout).toMatchObject({
        id: layoutId,
        status: "feasible",
      });
      expect(bootstrap.selectedLayout?.placements).toHaveLength(placementCount);
      expect(bootstrap.completedStageTurnIds).toEqual(completedStageTurnIds);
    },
  );

  it("leaves C pending after B until the buyer explicitly runs or submits it", async () => {
    vi.stubGlobal("window", { location: { search: "?preview=1&step=conflict" } });

    const bootstrap = await createPreviewApi().getBootstrap();

    expect(nextPendingStageTurnIndex(stageTurns, bootstrap.completedStageTurnIds)).toBe(2);
    expect(bootstrap.messages.some((message) => message.text === stageTurns[2]?.prompt)).toBe(false);
  });

  it.each([
    ["B", "?preview=1&step=conflict", 1],
    ["E", "?preview=1&step=failure", 3],
  ] as const)(
    "keeps Buyer prompts separate from Application evidence at %s",
    async (_label, search, turnIndex) => {
      vi.stubGlobal("window", { location: { search } });
      const expectedPrompt = stageTurns[turnIndex]?.prompt ?? "";

      const bootstrap = await createPreviewApi().getBootstrap();
      const buyerMessages = bootstrap.messages.filter((message) => message.role === "user");
      const applicationMessages = bootstrap.messages.filter((message) => message.role === "application");
      const validationTrace = bootstrap.trace.find((entry) => entry.kind === "validation");
      const geometryTrace = bootstrap.trace.find((entry) => entry.kind === "geometry");

      expect(buyerMessages).toHaveLength(applicationMessages.length);
      for (const [index, visibleBuyer] of buyerMessages.entries()) {
        const visibleEvidence = applicationMessages[index];
        expect(visibleEvidence).toBeDefined();
        expect(visibleEvidence?.text).not.toContain(visibleBuyer.text);
        expect(visibleEvidence?.text).not.toContain("User request");
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

  it.each([
    {
      label: "B after A",
      search: "?preview=1&step=conflict",
      stateVersion: 2,
      acceptedLayoutId: "queen-desk-standard-v1",
      evidenceLayoutId: "king-desk-standard-v1",
      measurements: [[470, 250]],
    },
    {
      label: "E after C",
      search: "?preview=1&step=failure",
      stateVersion: 4,
      acceptedLayoutId: "queen-crib-compact-v1",
      evidenceLayoutId: "king-crib-compact-east-v1",
      measurements: [
        [70, 250],
        [170, 250],
        [500, 250],
      ],
    },
  ])(
    "preserves accepted state and exact rejected evidence for $label",
    async ({ search, stateVersion, acceptedLayoutId, evidenceLayoutId, measurements }) => {
      vi.stubGlobal("window", { location: { search } });

      const bootstrap = await createPreviewApi().getBootstrap();
      const evidenceLayout = bootstrap.lastToolResult?.rejectedOptions.find(
        (option) => option.id === bootstrap.lastToolResult?.evidenceOptionId,
      );

      expect(bootstrap.state).toMatchObject({
        version: stateVersion,
        currentLayoutId: acceptedLayoutId,
        currentLayoutSource: "known-option",
        lastResultStatus: "no_feasible_option",
      });
      expect(bootstrap.lastToolResult).toMatchObject({
        status: "no_feasible_option",
        selectedOptionId: null,
        evidenceOptionId: evidenceLayoutId,
      });
      expect(
        evidenceLayout?.measurements.map((measurement) => [
          measurement.actualDistanceMm,
          measurement.requiredDistanceMm,
        ]),
      ).toEqual(measurements);
    },
  );
});
