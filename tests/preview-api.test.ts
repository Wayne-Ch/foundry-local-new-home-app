import { afterEach, describe, expect, it, vi } from "vitest";
import { stageTurnsForMode } from "../src/foundry/prompt";
import { createPreviewApi } from "../src/renderer/preview-api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderer preview scenarios", () => {
  it.each([
    ["default A", "?preview=1&step=queen", "default", "queen-desk-standard-v1", 2],
    ["default C", "?preview=1&step=recovery", "default", "queen-crib-compact-v1", 3],
    ["imported A", "?preview=1&room=imported&step=queen", "imported", "imported-queen-desk-standard-v1", 2],
    ["imported C", "?preview=1&room=imported&step=recovery", "imported", "imported-queen-crib-compact-v1", 3],
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
    ["default rejected", "?preview=1&step=failure", "default", 3],
    ["imported feasible", "?preview=1&room=imported&step=queen", "imported", 0],
    ["imported rejected", "?preview=1&room=imported&step=failure", "imported", 3],
  ] as const)(
    "uses unambiguous application-evidence copy for %s without changing trace prompt provenance",
    async (_label, search, roomMode, turnIndex) => {
      vi.stubGlobal("window", { location: { search } });
      const expectedPrompt = stageTurnsForMode(roomMode)[turnIndex]?.prompt ?? "";

      const bootstrap = await createPreviewApi().getBootstrap();
      const applicationMessage = bootstrap.messages.at(-1);
      const validationTrace = bootstrap.trace.find((entry) => entry.kind === "validation");

      expect(applicationMessage).toMatchObject({
        role: "application",
        text: expect.stringContaining(`User request: ${expectedPrompt}`),
      });
      expect(applicationMessage?.text).not.toContain("Application evidence:");
      expect(applicationMessage?.text).not.toContain("Preference interpreted:");
      expect(validationTrace?.payload).toMatchObject({
        input: {
          changedPreference: expectedPrompt,
        },
      });
    },
  );

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
        "The King + desk option conflicts with closet access. Which preference may change: bed size, desk footprint or orientation, baby bed requirement?",
    },
    {
      label: "E after recovery C",
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
      expect(bootstrap.messages.at(-1)?.text).toBe(`${evidenceVerdict} User request: ${expectedPrompt}`);
    },
  );
});
