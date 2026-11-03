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
});
