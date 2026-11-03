import { describe, expect, it } from "vitest";
import { defaultPlanningFixture } from "../src/domain/fixture";
import {
  createActiveRoomSession,
  createInactiveRoomSession,
  requireActiveRoomSession,
  resetRoomSessionState,
} from "../src/domain/room-session";

describe("room session domain state", () => {
  it("represents fresh intake without a fixture, room plan, or demo state", () => {
    const roomSession = createInactiveRoomSession();

    expect(roomSession).toEqual({
      mode: "none",
      planningFixture: null,
      state: null,
    });
    expect(() => requireActiveRoomSession(roomSession)).toThrow("explicitly use the default room");
  });

  it("creates deterministic state only after an explicit room activation", () => {
    const active = createActiveRoomSession(defaultPlanningFixture);

    expect(active).toMatchObject({
      mode: "default",
      planningFixture: {
        roomPlan: { id: "ignite-bedroom-a" },
      },
      state: {
        stateRef: "layout-state-v0",
        version: 0,
        roomPlanId: "ignite-bedroom-a",
      },
    });
    expect(resetRoomSessionState(active)).toMatchObject({
      mode: "default",
      state: {
        stateRef: "layout-state-v0",
        version: 0,
        roomPlanId: "ignite-bedroom-a",
      },
    });
  });

  it("keeps Reset in the inactive intake state when no room is active", () => {
    expect(resetRoomSessionState(createInactiveRoomSession())).toEqual(createInactiveRoomSession());
  });
});
