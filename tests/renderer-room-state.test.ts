import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewApi } from "../src/renderer/preview-api";
import { getActiveRoomView } from "../src/renderer/room-state";
import type { BootstrapPayload } from "../src/shared/contracts";

describe("renderer room state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns no active room for the fresh preview bootstrap", async () => {
    vi.stubGlobal("window", { location: { search: "?preview=1" } });

    expect(getActiveRoomView(await createPreviewApi().getBootstrap())).toBeNull();
  });

  it("exposes exact geometry only after an active bootstrap is selected", async () => {
    vi.stubGlobal("window", {
      location: { search: "?preview=1&room=imported&step=queen" },
    });

    expect(getActiveRoomView(await createPreviewApi().getBootstrap())).toMatchObject({
      roomMode: "imported",
      roomPlan: { id: "imported-nara-master-bedroom" },
      state: { roomPlanId: "imported-nara-master-bedroom" },
    });
  });

  it("rejects an inconsistent inactive bootstrap instead of rendering hidden geometry", () => {
    const invalid = {
      roomMode: "none",
      roomPlan: { id: "hidden-default" },
      state: null,
    } as unknown as BootstrapPayload;

    expect(() => getActiveRoomView(invalid)).toThrow("Inactive room bootstrap cannot contain room geometry");
  });
});
