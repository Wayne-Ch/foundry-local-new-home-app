import { createInitialDemoState } from "./demo-state";
import type { DemoState, PlanningFixture } from "./types";

export type RoomMode = "none" | PlanningFixture["mode"];

export const ROOM_INTAKE_MESSAGE =
  "Load or choose a floor plan to begin. Analyze the exact fixture to import room geometry, or explicitly select Use default room.";

export interface InactiveRoomSession {
  readonly mode: "none";
  readonly planningFixture: null;
  readonly state: null;
}

export interface ActiveRoomSession {
  readonly mode: PlanningFixture["mode"];
  readonly planningFixture: PlanningFixture;
  readonly state: DemoState;
}

export type RoomSession = InactiveRoomSession | ActiveRoomSession;

export function createInactiveRoomSession(): InactiveRoomSession {
  return {
    mode: "none",
    planningFixture: null,
    state: null,
  };
}

export function createActiveRoomSession(planningFixture: PlanningFixture): ActiveRoomSession {
  return {
    mode: planningFixture.mode,
    planningFixture,
    state: createInitialDemoState(planningFixture.roomPlan),
  };
}

export function resetRoomSessionState(roomSession: RoomSession): RoomSession {
  return roomSession.mode === "none"
    ? createInactiveRoomSession()
    : createActiveRoomSession(roomSession.planningFixture);
}

export function requireActiveRoomSession(roomSession: RoomSession): ActiveRoomSession {
  if (roomSession.mode === "none") {
    throw new Error(
      "Load and analyze a floor plan, or explicitly use the default room, before running layout operations.",
    );
  }
  return roomSession;
}
