import type { DemoStateSnapshot, RoomPlan } from "../domain/types";
import type { BootstrapPayload } from "../shared/contracts";

export interface ActiveRoomView {
  readonly roomMode: "default" | "imported";
  readonly roomPlan: RoomPlan;
  readonly state: DemoStateSnapshot;
}

export function getActiveRoomView(bootstrap: BootstrapPayload): ActiveRoomView | null {
  if (bootstrap.roomMode === "none") {
    if (bootstrap.roomPlan !== null || bootstrap.state !== null) {
      throw new Error("Inactive room bootstrap cannot contain room geometry or demo state.");
    }
    return null;
  }
  if (bootstrap.roomPlan === null || bootstrap.state === null) {
    throw new Error("Active room bootstrap is missing room geometry or demo state.");
  }
  return {
    roomMode: bootstrap.roomMode,
    roomPlan: bootstrap.roomPlan,
    state: bootstrap.state,
  };
}
