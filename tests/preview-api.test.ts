import { afterEach, describe, expect, it, vi } from "vitest";
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
    {
      label: "B after A",
      search: "?preview=1&room=imported&step=conflict",
      stateVersion: 2,
      acceptedLayoutId: "imported-queen-desk-standard-v1",
      evidenceLayoutId: "imported-king-desk-standard-v1",
      evaluatedLayoutIds: ["imported-king-desk-standard-v1"],
      measurements: [[70, 250]],
      evidenceText:
        "Application evidence: the King + desk option conflicts with closet access. Which preference may change: bed size, desk footprint or orientation, baby bed requirement?",
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
      evidenceText:
        "Application evidence: no feasible known option. The prior accepted layout remains active on the main canvas. Exact rejected-option evidence remains visible, and Inspect rejected option opens its preview without accepting it.",
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
      evidenceText,
    }) => {
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
      expect(bootstrap.messages.at(-1)?.text).toBe(evidenceText);
    },
  );
});
