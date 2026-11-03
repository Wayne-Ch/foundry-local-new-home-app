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
});
