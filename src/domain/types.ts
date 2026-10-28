export const furnitureIds = [
  "bed-queen",
  "bed-king",
  "desk-standard",
  "desk-compact",
  "crib-standard",
] as const;

export type FurnitureId = (typeof furnitureIds)[number];

export const roomStateIds = [
  "room-bounds",
  "door-open",
  "closet-access",
  "window-clearance",
  "furniture-clearance",
] as const;

export type RoomStateId = (typeof roomStateIds)[number];
export type Orientation = 0 | 90;

export interface Rectangle {
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly depthMm: number;
}

export interface DoorSwing {
  readonly id: string;
  readonly label: string;
  readonly hingeXmm: number;
  readonly hingeYmm: number;
  readonly radiusMm: number;
  readonly quadrant: "north-east";
}

export interface ReservedZone {
  readonly id: string;
  readonly label: string;
  readonly kind: "closet-access" | "window-clearance";
  readonly rect: Rectangle;
}

export interface RoomPlan {
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly unit: "mm";
  readonly widthMm: number;
  readonly depthMm: number;
  readonly verifiedBy: string;
  readonly verifiedAt: string;
  readonly doorSwing: DoorSwing;
  readonly reservedZones: readonly ReservedZone[];
}

export interface FurnitureDefinition {
  readonly id: FurnitureId;
  readonly label: string;
  readonly category: "bed" | "desk" | "crib";
  readonly widthMm: number;
  readonly depthMm: number;
  readonly source: string;
  readonly color: string;
}

export interface ClearanceRuleSet {
  readonly id: string;
  readonly version: string;
  readonly unit: "mm";
  readonly minimumFurnitureGapMm: number;
  readonly notes: readonly string[];
}

export interface FurniturePlacement {
  readonly instanceId: string;
  readonly furnitureId: FurnitureId;
  readonly xMm: number;
  readonly yMm: number;
  readonly orientation: Orientation;
}

export interface LayoutOption {
  readonly id: string;
  readonly label: string;
  readonly furnitureIds: readonly FurnitureId[];
  readonly placements: readonly FurniturePlacement[];
  readonly rationale: string;
}

export type ConflictCode =
  | "OUT_OF_BOUNDS"
  | "DOOR_SWING_OVERLAP"
  | "RESERVED_ZONE_OVERLAP"
  | "FURNITURE_COLLISION"
  | "FURNITURE_CLEARANCE";

export interface LayoutConflict {
  readonly code: ConflictCode;
  readonly ruleId: string;
  readonly message: string;
  readonly objectIds: readonly string[];
  readonly zoneId?: string;
  readonly actualDistanceMm?: number;
  readonly requiredDistanceMm?: number;
}

export interface CheckedRoomState {
  readonly id: RoomStateId;
  readonly label: string;
  readonly passed: boolean;
  readonly evidence: string;
}

export interface ResolvedPlacement extends FurniturePlacement {
  readonly label: string;
  readonly rect: Rectangle;
  readonly color: string;
}

export interface EvaluatedLayoutOption {
  readonly id: string;
  readonly label: string;
  readonly status: "feasible" | "rejected";
  readonly rationale: string;
  readonly placements: readonly ResolvedPlacement[];
  readonly conflicts: readonly LayoutConflict[];
  readonly checkedStates: readonly CheckedRoomState[];
}

export type LayoutToolStatus = "feasible" | "no_feasible_option" | "clarification_required";

export interface LayoutToolProvenance {
  readonly roomPlanId: string;
  readonly planVersion: string;
  readonly clearanceRuleSetId: string;
  readonly clearanceRuleSetVersion: string;
  readonly furnitureCatalogVersion: string;
  readonly geometryEngineVersion: string;
  readonly unit: "mm";
  readonly evaluatedLayoutIds: readonly string[];
}

export interface LayoutToolResult {
  readonly tool: "compare_layout_options";
  readonly status: LayoutToolStatus;
  readonly stateRef: string;
  readonly changedPreference: string;
  readonly selectedOptionId: string | null;
  readonly evidenceOptionId: string | null;
  readonly feasibleOptions: readonly EvaluatedLayoutOption[];
  readonly rejectedOptions: readonly EvaluatedLayoutOption[];
  readonly conflicts: readonly LayoutConflict[];
  readonly aggregateConflicts: readonly LayoutConflict[];
  readonly checkedStates: readonly CheckedRoomState[];
  readonly unknowns: readonly string[];
  readonly noResultReason: {
    readonly code: "NO_KNOWN_FEASIBLE_OPTION" | "NO_KNOWN_OPTION_SET";
    readonly message: string;
    readonly preferencesThatMayChange: readonly string[];
  } | null;
  readonly summary: string;
  readonly provenance: LayoutToolProvenance;
}

export interface LockedConstraints {
  readonly verifiedMeasurementsOnly: true;
  readonly keepDoorSwingClear: true;
  readonly keepClosetAccessClear: true;
  readonly keepWindowClearance: true;
  readonly enforceFurnitureClearance: true;
}

export interface DemoStateSnapshot {
  readonly stateRef: string;
  readonly version: number;
  readonly currentLayoutId: string | null;
  readonly activeFurnitureIds: readonly FurnitureId[];
  readonly lockedConstraints: LockedConstraints;
  readonly requiredRoomStates: readonly RoomStateId[];
  readonly lastChangedPreference: string | null;
  readonly lastResultStatus: LayoutToolStatus | null;
}

export interface DemoState extends DemoStateSnapshot {
  readonly lastToolResult: LayoutToolResult | null;
}

export interface ModelIdentity {
  readonly alias: string;
  readonly id: string;
  readonly deviceType: string;
  readonly executionProvider: string;
  readonly supportsToolCalling: boolean;
  readonly fileSizeMb: number | null;
}

export interface RuntimeTargetIdentity {
  readonly modelId: string;
  readonly executionProvider: string;
  readonly source: "built_in_default" | "environment_override" | "invalid_environment_override";
  readonly stageValidated: boolean;
}

export interface RuntimeReadiness {
  readonly sdkVersion: "2.2.1";
  readonly provider: "Foundry Local in-process SDK";
  readonly planningMode: "Runtime-guided JSON schema -> app tool invocation";
  readonly responseMode: "Application-rendered typed evidence";
  readonly target: RuntimeTargetIdentity;
  readonly model: ModelIdentity | null;
  readonly modelCached: boolean;
  readonly executionProviderRegistered: boolean;
  readonly localInferenceReady: boolean;
  readonly externalEndpointUsed: false;
  readonly nonessentialTelemetryDisabled: boolean;
  readonly cachePath: string;
  readonly appDataPath: string;
  readonly status:
    | "not_initialized"
    | "configuration_invalid"
    | "checking"
    | "ready"
    | "model_unavailable"
    | "provider_unavailable"
    | "preparation_required"
    | "loading"
    | "recovering"
    | "recovery_required"
    | "error";
  readonly detail: string;
}
