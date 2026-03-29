import type { Block } from "prismarine-block";
import { EventEmitter } from "events";
import { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import {
  BotcraftPhysics,
  EPhysicsCtx,
} from "../../../src/index";
import {
  EBounceBot,
  EBounceController,
  findInventoryItem,
  toDegrees,
  toRadians,
} from "./ebounceShared";

const BLOCK_REACH_DISTANCE = 4.5;
const SUPPORT_CONFIRMATION_TICKS = 6;
const SUPPORT_VELOCITY_RETENTION_RATIO = 0.8;
const MAX_VELOCITY_RECOVERY_STRIP_LENGTH = 5;
const MAX_VELOCITY_RECOVERY_FRONT_OFFSET = 3;
const MAX_VELOCITY_RECOVERY_FORWARD_EXTENSION = 1;
const PITCH_SHALLOW_SEARCH_STEP_DEG = 1;
const ONE_TICK_UPWARD_RECOVERY_PITCH_DEG = 20;
const DEFAULT_PLACEABLE_BLOCK_NAMES = [
  "dirt",
] as const;

const REPLACEABLE_BLOCK_NAMES = new Set([
  "air",
  "cave_air",
  "void_air",
  "water",
  "lava",
  "short_grass",
  "tall_grass",
  "fern",
  "large_fern",
  "seagrass",
  "tall_seagrass",
  "snow",
  "vine",
  "weeping_vines",
  "weeping_vines_plant",
  "twisting_vines",
  "twisting_vines_plant",
]);

type PlacementPrediction = {
  interceptTick: number;
  beforeStateCtx: EPhysicsCtx<any>;
  beforePos: Vec3;
  landingPos: Vec3;
  crossingPos: Vec3;
  projectedTargetPos: Vec3;
  halfWidth: number;
};

type OverlayWorld = {
  getBlock: (pos: Vec3) => Block;
};

type PlaceReference = {
  position: Vec3;
};

type PlacementCandidate = {
  interceptTick: number;
  landingPos: Vec3;
  crossingPos: Vec3;
  targetPos: Vec3;
  referencePos: Vec3;
  reachDistance: number;
};

type PlacementPlan = {
  candidates: PlacementCandidate[];
};

type DeferredPlacement = {
  executeTick: number;
  placeableName: string;
  plan: PlacementPlan;
};

type CandidateResolution =
  | { kind: "success"; plan: PlacementPlan }
  | { kind: "already_supported"; plan: PlacementPlan }
  | { kind: "out_of_reach"; candidate: PlacementCandidate }
  | { kind: "no_support"; candidate: PlacementCandidate }
  | { kind: "occupied"; candidate: PlacementCandidate }
  | { kind: "build_failed"; blockName: string }
  | { kind: "failed"; candidate: PlacementCandidate };

type SupportSimulationResult = {
  kind: "supported" | "velocity_killed" | "failed";
  tick: number;
  pos: Vec3;
  vel: Vec3;
  onGround: boolean;
  collidedHorizontally: boolean;
  supportingBlockKey: string | null;
  horizontalSpeed: number;
  initialHorizontalSpeed: number;
  minAllowedHorizontalSpeed: number;
};

type BuildPredictedBlocksResult =
  | { kind: "build_failed"; blockName: string }
  | { ok: false; predictedBlocks: Block[] }
  | { ok: true; predictedBlocks: Block[] };

type PitchOverrideState =
  | { mode: "none"; pitch: null }
  | { mode: "recovery" | "plan"; pitch: number };

type PlacementAssistDiagnostics = {
  tickNumber: number;
  lastPredictedTargetKey: string | null;
  lastWarningKey: string | null;
  lastSimulationDebug: string | null;
};

type PlacementAssistSettings = {
  blockNames: string[];
  placeOnLastValidTickOnly: boolean;
  maxAscendStep: number;
  maxDescendStep: number;
};

type PlacementAssistState = {
  trackedYLevel: number | null;
  lastGroundedYLevel: number | null;
  fallbackYLevel: number | null;
  pendingEquip: Promise<void> | null;
  pendingPlacement: Promise<void> | null;
  placedBlockCount: number;
  satisfiedLandingCount: number;
  lastResolvedTargetKey: string | null;
  pitchOverrideState: PitchOverrideState;
  deferredPlacement: DeferredPlacement | null;
};

type PlacementVerticalMode = "idle" | "ascending" | "fallback" | "level" | "descending";
type PlacementOperationalMode = PlacementVerticalMode | "recovery";

function blockKey(pos: Vec3) {
  return `${pos.x},${pos.y},${pos.z}`;
}

function isReplaceable(block: Block | null) {
  if (block == null) return true;
  if (REPLACEABLE_BLOCK_NAMES.has(block.name)) return true;
  return block.boundingBox === "empty";
}

function findFirstPlaceableBlock(bot: Bot, names: readonly string[]) {
  for (const name of names) {
    const item = findInventoryItem(bot, name);
    if (item) return item;
  }
  return null;
}

class PlacementPlanner {
  constructor(
    private readonly bot: EBounceBot,
    private readonly simPhysics: BotcraftPhysics,
  ) {}

  public predictInterceptBelowTrackedY(trackedYLevel: number | null, pitchOverride: number | null = null) {
    if (trackedYLevel == null) return null;

    const simCtx = EPhysicsCtx.FROM_BOT(this.simPhysics, this.bot);
    if (pitchOverride != null) {
      simCtx.state.pitch = pitchOverride;
    }

    if (simCtx.state.pos.y + 1e-6 < trackedYLevel) {
      return null;
    }

    let tick = 0;

    while (true) {
      tick++;
      const beforeStateCtx = simCtx.clone();
      const previousPos = simCtx.state.pos.clone();
      const previousHalfWidth = simCtx.state.halfWidth;
      this.simPhysics.simulate(simCtx, this.bot.world);

      const currentPos = simCtx.state.pos.clone();
      if (simCtx.state.onGround && currentPos.y >= trackedYLevel) {
        return null;
      }

 
      if (currentPos.y >= trackedYLevel) {
        continue;
      }

      const targetY = Math.floor(trackedYLevel) - 1;
      const crossingPos = this.interpolateCrossing(previousPos, currentPos, trackedYLevel);
      return {
        interceptTick: tick,
        beforeStateCtx,
        beforePos: previousPos,
        landingPos: currentPos,
        crossingPos,
        projectedTargetPos: new Vec3(
          Math.floor(crossingPos.x),
          targetY,
          Math.floor(crossingPos.z),
        ),
        halfWidth: previousHalfWidth,
      };
    }

  }

  public predictInterceptAboveTrackedY(trackedYLevel: number | null, pitchOverride: number | null = null) {
    if (trackedYLevel == null) return null;

    const simCtx = EPhysicsCtx.FROM_BOT(this.simPhysics, this.bot);
    const startPosY = simCtx.position.y;

    if (pitchOverride != null) {
      simCtx.state.pitch = pitchOverride;
    }

    if (simCtx.state.pos.y + 1e-6 >= trackedYLevel) {
      return null;
    }

    let tick = 0;

    while (true) {
      tick++;
      const beforeStateCtx = simCtx.clone();
      const previousPos = simCtx.state.pos.clone();
      const previousHalfWidth = simCtx.state.halfWidth;
      this.simPhysics.simulate(simCtx, this.bot.world);

      const currentPos = simCtx.state.pos.clone();
      if (
        simCtx.state.onGround &&
        currentPos.y + 1e-6 < trackedYLevel &&
        currentPos.y <= previousPos.y + 1e-6
      ) {
        return null;
      }

      if (currentPos.y + 1e-6 < startPosY - 1) {
        return null;
      }

      if (currentPos.y + 1e-6 < trackedYLevel) {
        continue;
      }



      const targetY = Math.floor(trackedYLevel) - 1;
      const crossingPos = this.interpolateCrossing(previousPos, currentPos, trackedYLevel);
      return {
        interceptTick: tick,
        beforeStateCtx,
        beforePos: previousPos,
        landingPos: currentPos,
        crossingPos,
        projectedTargetPos: new Vec3(
          Math.floor(crossingPos.x),
          targetY,
          Math.floor(crossingPos.z),
        ),
        halfWidth: previousHalfWidth,
      };
    }

  }

  public reachesYLevel(targetY: number | null, pitchOverride: number | null = null) {
    if (targetY == null) return false;

    const simCtx = EPhysicsCtx.FROM_BOT(this.simPhysics, this.bot);
    if (pitchOverride != null) {
      simCtx.state.pitch = pitchOverride;
    }

    let maxY = simCtx.state.pos.y;

    for (let tick = 0; tick < 40; tick++) {
      this.simPhysics.simulate(simCtx, this.bot.world);
      maxY = Math.max(maxY, simCtx.state.pos.y);

      if (maxY + 1e-6 >= targetY) {
        return true;
      }

      if (simCtx.state.vel.y <= 0 && simCtx.state.pos.y + 1e-6 < targetY) {
        return false;
      }

      if (simCtx.state.onGround && simCtx.state.pos.y + 1e-6 < targetY) {
        return false;
      }
    }

    return maxY + 1e-6 >= targetY;
  }

  public getTopFaceCandidates(prediction: PlacementPrediction) {
    return this.getTopFaceSeedTargetPositions(
      prediction.beforePos,
      prediction.landingPos,
      prediction.crossingPos,
      prediction.projectedTargetPos.y,
      prediction.halfWidth,
    ).map((targetPos) => this.buildCandidate(prediction, targetPos));
  }

  public buildVelocityRecoveryStripCandidates(prediction: PlacementPrediction, candidate: PlacementCandidate) {
    const horizontalVel = prediction.beforeStateCtx.state.vel;
    const absX = Math.abs(horizontalVel.x);
    const absZ = Math.abs(horizontalVel.z);
    if (absX <= 1e-6 && absZ <= 1e-6) {
      return [candidate];
    }

    const step =
      absZ >= absX
        ? new Vec3(0, 0, horizontalVel.z >= 0 ? -1 : 1)
        : new Vec3(horizontalVel.x >= 0 ? -1 : 1, 0, 0);
    return Array.from(
      { length: MAX_VELOCITY_RECOVERY_STRIP_LENGTH + MAX_VELOCITY_RECOVERY_FORWARD_EXTENSION },
      (_, index) => this.buildCandidate(prediction, candidate.targetPos.plus(step.scaled(index))),
    );
  }

  public getVelocityRecoveryFrontOffsets() {
    const offsets = [0];
    for (let backward = 1; backward <= MAX_VELOCITY_RECOVERY_FRONT_OFFSET; backward++) {
      offsets.push(-backward);
    }
    for (let forward = 1; forward <= MAX_VELOCITY_RECOVERY_FORWARD_EXTENSION; forward++) {
      offsets.push(forward);
    }
    return offsets;
  }

  public buildVelocityRecoveryStripPlan(
    prediction: PlacementPrediction,
    candidate: PlacementCandidate,
    length: number,
    frontOffset: number,
  ) {
    const horizontalVel = prediction.beforeStateCtx.state.vel;
    const absX = Math.abs(horizontalVel.x);
    const absZ = Math.abs(horizontalVel.z);
    if (absX <= 1e-6 && absZ <= 1e-6) {
      return { candidates: [candidate] };
    }

    const step =
      absZ >= absX
        ? new Vec3(0, 0, horizontalVel.z >= 0 ? -1 : 1)
        : new Vec3(horizontalVel.x >= 0 ? -1 : 1, 0, 0);
    const frontPos = candidate.targetPos.plus(step.scaled(-frontOffset));
    const positions: PlacementCandidate[] = [];

    for (let i = 0; i < length; i++) {
      positions.push(this.buildCandidate(prediction, frontPos.plus(step.scaled(i))));
    }

    const deduped = positions.filter((planCandidate, index, arr) =>
      arr.findIndex((other) => other.targetPos.equals(planCandidate.targetPos)) === index,
    );
    if (deduped.length !== length) {
      return null;
    }

    return { candidates: deduped };
  }

  private interpolateCrossing(previousPos: Vec3, currentPos: Vec3, trackedYLevel: number) {
    const dy = previousPos.y - currentPos.y;
    if (Math.abs(dy) <= 1e-6) {
      return currentPos.clone();
    }

    const t = Math.max(0, Math.min(1, (previousPos.y - trackedYLevel) / dy));
    return new Vec3(
      previousPos.x + ((currentPos.x - previousPos.x) * t),
      trackedYLevel,
      previousPos.z + ((currentPos.z - previousPos.z) * t),
    );
  }

  private getReachDistanceToTarget(crossingPos: Vec3, targetY: number) {
    const eyePos = this.bot.entity.position.offset(0, this.bot.entity.height, 0);
    const targetCenter = new Vec3(
      Math.floor(crossingPos.x) + 0.5,
      targetY + 0.5,
      Math.floor(crossingPos.z) + 0.5,
    );
    return eyePos.distanceTo(targetCenter);
  }

  private getTopFaceSeedTargetPositions(
    beforePos: Vec3,
    afterPos: Vec3,
    crossingPos: Vec3,
    targetY: number,
    halfWidth: number,
  ) {
    const sweptMinX = Math.floor(Math.min(beforePos.x - halfWidth, afterPos.x - halfWidth));
    const sweptMaxX = Math.floor(Math.max(beforePos.x + halfWidth, afterPos.x + halfWidth));
    const sweptMinZ = Math.floor(Math.min(beforePos.z - halfWidth, afterPos.z - halfWidth));
    const sweptMaxZ = Math.floor(Math.max(beforePos.z + halfWidth, afterPos.z + halfWidth));
    const crossingMinX = crossingPos.x - halfWidth;
    const crossingMaxX = crossingPos.x + halfWidth;
    const crossingMinZ = crossingPos.z - halfWidth;
    const crossingMaxZ = crossingPos.z + halfWidth;
    const positions: Vec3[] = [];

    for (let x = sweptMinX; x <= sweptMaxX; x++) {
      for (let z = sweptMinZ; z <= sweptMaxZ; z++) {
        if (!this.blockColumnIntersectsRect(x, z, crossingMinX, crossingMaxX, crossingMinZ, crossingMaxZ)) {
          continue;
        }

        positions.push(new Vec3(x, targetY, z));
      }
    }

    positions.sort((a, b) => {
      const aCenter = new Vec3(a.x + 0.5, crossingPos.y, a.z + 0.5);
      const bCenter = new Vec3(b.x + 0.5, crossingPos.y, b.z + 0.5);
      const aDist = aCenter.distanceTo(crossingPos);
      const bDist = bCenter.distanceTo(crossingPos);
      if (aDist !== bDist) return aDist - bDist;

      const aForward =
        ((aCenter.x - crossingPos.x) * this.bot.entity.velocity.x) +
        ((aCenter.z - crossingPos.z) * this.bot.entity.velocity.z);
      const bForward =
        ((bCenter.x - crossingPos.x) * this.bot.entity.velocity.x) +
        ((bCenter.z - crossingPos.z) * this.bot.entity.velocity.z);
      return bForward - aForward;
    });

    return positions;
  }

  private blockColumnIntersectsRect(
    blockX: number,
    blockZ: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ) {
    return maxX > blockX && minX < blockX + 1 && maxZ > blockZ && minZ < blockZ + 1;
  }

  private buildCandidate(prediction: PlacementPrediction, targetPos: Vec3): PlacementCandidate {
    return {
      interceptTick: prediction.interceptTick,
      landingPos: prediction.landingPos,
      crossingPos: prediction.crossingPos,
      targetPos,
      referencePos: new Vec3(targetPos.x, targetPos.y - 1, targetPos.z),
      reachDistance: this.getReachDistanceToTarget(
        new Vec3(targetPos.x + 0.5, prediction.crossingPos.y, targetPos.z + 0.5),
        targetPos.y,
      ),
    };
  }
}

class SupportPlanSimulator {
  constructor(
    private readonly bot: EBounceBot,
    private readonly simPhysics: BotcraftPhysics,
    private readonly BlockCtor: any,
  ) {}

  public buildPredictedBlocksForPlan(
    trackedYLevel: number | null,
    prediction: PlacementPrediction,
    plan: PlacementPlan,
    blockName: string,
  ): BuildPredictedBlocksResult {
    const predictedBlocks: Block[] = [];

    for (const candidate of plan.candidates) {
      const existingBlock = this.bot.blockAt(candidate.targetPos);
      if (candidate.reachDistance > BLOCK_REACH_DISTANCE) {
        return { ok: false as const, predictedBlocks };
      }

      if (!isReplaceable(existingBlock)) {
        const existingSupportResult = this.simulateSupportPlan(trackedYLevel, prediction, { candidates: [candidate] }, [] as Block[]);
        if (existingSupportResult.kind !== "supported") {
          return { ok: false as const, predictedBlocks };
        }
        continue;
      }

      const predictedBlock = this.makePredictedBlock(blockName, candidate.targetPos);
      if (predictedBlock == null) {
        return { kind: "build_failed" as const, blockName };
      }
      predictedBlocks.push(predictedBlock);
    }

    return { ok: true as const, predictedBlocks };
  }

  public simulateSupportPlan(
    trackedYLevel: number | null,
    prediction: PlacementPrediction,
    plan: PlacementPlan,
    predictedBlocks: Block[],
  ): SupportSimulationResult {
    if (trackedYLevel == null) {
      return this.makeSupportSimulationResult("failed", 0, prediction.beforeStateCtx);
    }

    const simCtx = prediction.beforeStateCtx.clone();
    const simWorld = predictedBlocks.length === 0
      ? this.bot.world
      : this.makeOverlayWorld(predictedBlocks);
    const initialHorizontalSpeed = Math.hypot(simCtx.state.vel.x, simCtx.state.vel.z);
    const minAllowedHorizontalSpeed = initialHorizontalSpeed * SUPPORT_VELOCITY_RETENTION_RATIO;

    for (let tick = 1; tick <= SUPPORT_CONFIRMATION_TICKS; tick++) {
      this.simPhysics.simulate(simCtx, simWorld);

      const currentHorizontalSpeed = Math.hypot(simCtx.state.vel.x, simCtx.state.vel.z);
      if (
        initialHorizontalSpeed > 1e-6 &&
        currentHorizontalSpeed + 1e-6 < minAllowedHorizontalSpeed
      ) {
        return this.makeSupportSimulationResult("velocity_killed", tick, simCtx, initialHorizontalSpeed, minAllowedHorizontalSpeed);
      }

      if (simCtx.state.isCollidedHorizontally) {
        return this.makeSupportSimulationResult("velocity_killed", tick, simCtx, initialHorizontalSpeed, minAllowedHorizontalSpeed);
      }

      const standingOnTop = Math.abs(simCtx.state.pos.y - trackedYLevel) <= 0.05;
      const supportedByPlan =
        simCtx.state.supportingBlockPos != null &&
        plan.candidates.some((candidate) =>
          simCtx.state.supportingBlockPos!.x === candidate.targetPos.x &&
          simCtx.state.supportingBlockPos!.y === candidate.targetPos.y &&
          simCtx.state.supportingBlockPos!.z === candidate.targetPos.z,
        );
      const withinPlanColumn = plan.candidates.some((candidate) =>
        Math.floor(simCtx.state.pos.x) === candidate.targetPos.x &&
        Math.floor(simCtx.state.pos.z) === candidate.targetPos.z,
      );

      if (supportedByPlan || (simCtx.state.onGround && standingOnTop && withinPlanColumn)) {
        return this.makeSupportSimulationResult("supported", tick, simCtx, initialHorizontalSpeed, minAllowedHorizontalSpeed);
      }
    }

    return this.makeSupportSimulationResult("failed", SUPPORT_CONFIRMATION_TICKS, simCtx, initialHorizontalSpeed, minAllowedHorizontalSpeed);
  }

  public describeSupportSimulationResult(candidates: PlacementCandidate[], result: SupportSimulationResult) {
    return [
      `targets=${candidates.map((candidate) => blockKey(candidate.targetPos)).join("|")}`,
      `result=${result.kind}`,
      `tick=${result.tick}`,
      `pos=${result.pos.toString()}`,
      `vel=${result.vel.toString()}`,
      `speed=${result.horizontalSpeed.toFixed(3)}/${result.initialHorizontalSpeed.toFixed(3)}`,
      `minSpeed=${result.minAllowedHorizontalSpeed.toFixed(3)}`,
      `onGround=${result.onGround}`,
      `collidedHoriz=${result.collidedHorizontally}`,
      `support=${result.supportingBlockKey ?? "null"}`,
    ].join(" ");
  }

  private makePredictedBlock(blockName: string, targetPos: Vec3) {
    const blockInfo = this.bot.registry.blocksByName[blockName];
    if (!blockInfo) return null;

    const block = this.BlockCtor.fromStateId(blockInfo.defaultState, 0);
    block.position = targetPos.clone();
    return block as Block;
  }

  private makeOverlayWorld(predictedBlocks: Block[]): OverlayWorld {
    const predictedBlockMap = new Map(predictedBlocks.map((block) => [blockKey(block.position), block]));
    return {
      getBlock: (pos: Vec3) => {
        const floored = pos.floored();
        const predictedBlock = predictedBlockMap.get(blockKey(floored));
        if (predictedBlock != null) {
          return predictedBlock;
        }
        return this.bot.world.getBlock(pos);
      },
    } as any;
  }

  private makeSupportSimulationResult(
    kind: SupportSimulationResult["kind"],
    tick: number,
    simCtx: EPhysicsCtx<any>,
    initialHorizontalSpeed = 0,
    minAllowedHorizontalSpeed = 0,
  ): SupportSimulationResult {
    return {
      kind,
      tick,
      pos: simCtx.state.pos.clone(),
      vel: simCtx.state.vel.clone(),
      onGround: simCtx.state.onGround,
      collidedHorizontally: simCtx.state.isCollidedHorizontally,
      supportingBlockKey: simCtx.state.supportingBlockPos == null ? null : blockKey(simCtx.state.supportingBlockPos),
      horizontalSpeed: Math.hypot(simCtx.state.vel.x, simCtx.state.vel.z),
      initialHorizontalSpeed,
      minAllowedHorizontalSpeed,
    };
  }
}

export class PredictiveTopPlacementAssist extends EventEmitter {
  private readonly planner: PlacementPlanner;
  private readonly supportPlanSimulator: SupportPlanSimulator;

  // Settings: configurable behavior, not per-tick derived state.
  private readonly settings: PlacementAssistSettings = {
    blockNames: [...DEFAULT_PLACEABLE_BLOCK_NAMES],
    placeOnLastValidTickOnly: false,
    maxAscendStep: 1,
    maxDescendStep: 1,
  };

  // Behavioral state: required for placement decisions or externally observable behavior.
  private readonly state: PlacementAssistState = {
    trackedYLevel: null,
    lastGroundedYLevel: null,
    fallbackYLevel: null,
    pendingEquip: null,
    pendingPlacement: null,
    placedBlockCount: 0,
    satisfiedLandingCount: 0,
    lastResolvedTargetKey: null,
    pitchOverrideState: { mode: "none", pitch: null },
    deferredPlacement: null,
  };

  // Diagnostic state: only used for logs/status output and can be removed without changing placement logic.
  private readonly diagnostics: PlacementAssistDiagnostics = {
    tickNumber: 0,
    lastPredictedTargetKey: null,
    lastWarningKey: null,
    lastSimulationDebug: null,
  };

  constructor(
    private readonly bot: EBounceBot,
    private readonly controller: EBounceController,
  ) {
    super();
    const simPhysics = new BotcraftPhysics(bot.registry);
    const BlockCtor = require("prismarine-block")(bot.registry);
    this.planner = new PlacementPlanner(bot, simPhysics);
    this.supportPlanSimulator = new SupportPlanSimulator(bot, simPhysics, BlockCtor);
  }

  // Lifecycle / setup
  public armFromCurrentYLevel() {
    this.armFromYLevel(this.bot.entity.position.y);
  }

  public armFromYLevel(yLevel: number) {
    this.state.trackedYLevel = yLevel;
    if (this.bot.entity.onGround) {
      this.state.lastGroundedYLevel = this.bot.entity.position.y;
    }
    this.state.fallbackYLevel = null;
    this.diagnostics.lastPredictedTargetKey = null;
    this.diagnostics.lastWarningKey = null;
    this.state.lastResolvedTargetKey = null;
    this.diagnostics.lastSimulationDebug = null;
    this.clearPitchStrategy();
    this.state.deferredPlacement = null;
    this.log(`Tracked Y level armed at ${this.state.trackedYLevel.toFixed(3)}`);
  }

  public clear() {
    this.state.trackedYLevel = null;
    this.state.lastGroundedYLevel = null;
    this.state.fallbackYLevel = null;
    this.diagnostics.lastPredictedTargetKey = null;
    this.state.pendingEquip = null;
    this.state.pendingPlacement = null;
    this.diagnostics.lastWarningKey = null;
    this.state.lastResolvedTargetKey = null;
    this.diagnostics.lastSimulationDebug = null;
    this.clearPitchStrategy();
    this.state.deferredPlacement = null;
  }

  // Public inspection / configuration
  public getTrackedYLevel() {
    return this.state.trackedYLevel;
  }

  public getActiveTrackedYLevel() {
    return this.getCurrentPlanningYLevel();
  }

  public getPlacedBlockCount() {
    return this.state.placedBlockCount;
  }

  public getMode(): PlacementOperationalMode {
    return this.getCurrentMode();
  }

  public status() {
    return [
      `mode=${this.getCurrentMode()}`,
      `trackedY=${this.state.trackedYLevel == null ? "null" : this.state.trackedYLevel.toFixed(3)}`,
      `activeTrackedY=${this.getCurrentPlanningYLevel() == null ? "null" : this.getCurrentPlanningYLevel()!.toFixed(3)}`,
      `predictionTicks=unbounded`,
      `placeTiming=${this.settings.placeOnLastValidTickOnly ? "last_valid_tick" : "immediate"}`,
      `maxAscendStep=${this.settings.maxAscendStep}`,
      `maxDescendStep=${this.settings.maxDescendStep}`,
      `placeBlocks=${this.settings.blockNames.join(",")}`,
      `placedBlocks=${this.state.placedBlockCount}`,
      `satisfiedLandings=${this.state.satisfiedLandingCount}`,
      `lastPredictedTarget=${this.diagnostics.lastPredictedTargetKey ?? "null"}`,
    ].join(" ");
  }

  public setPlaceOnLastValidTickOnly(enabled: boolean) {
    this.settings.placeOnLastValidTickOnly = enabled;
    if (!enabled) this.state.deferredPlacement = null;
  }

  public setMaxDescendStep(maxDescendStep: number) {
    this.settings.maxDescendStep = Math.max(1, Math.floor(maxDescendStep));
  }

  public setMaxAscendStep(maxAscendStep: number) {
    this.settings.maxAscendStep = Math.max(1, Math.floor(maxAscendStep));
  }

  // Tick orchestration
  public tick() {
    this.diagnostics.tickNumber++;
    this.refreshGroundedYLevel();
    this.refreshFallbackState();
    const planningYLevel = this.getCurrentPlanningYLevel();
    const mode = this.getCurrentMode(planningYLevel);
    this.emit("tick_state", {
      tick: this.diagnostics.tickNumber,
      mode,
      trackedYLevel: this.state.trackedYLevel,
      activeTrackedYLevel: planningYLevel,
      pitchDeg: toDegrees(this.bot.entity.pitch),
      pos: this.bot.entity.position.clone(),
      vel: this.bot.entity.velocity.clone(),
    });

    if (!this.controller.isBouncing() || planningYLevel == null) {
      this.diagnostics.lastPredictedTargetKey = null;
      this.clearPitchStrategy();
      return;
    }

    this.ensurePlaceableEquipped();
    this.applyCommittedPitchIfNeeded();

    if (this.state.pendingPlacement != null) {
      return;
    }

    if (
      this.settings.placeOnLastValidTickOnly &&
      this.state.deferredPlacement != null &&
      this.diagnostics.tickNumber >= this.state.deferredPlacement.executeTick
    ) {
      const deferredPlacement = this.state.deferredPlacement;
      this.state.deferredPlacement = null;
      void this.placeRecoveryBlocks(deferredPlacement.plan, deferredPlacement.placeableName);
      return;
    }

    const placeable = findFirstPlaceableBlock(this.bot, this.settings.blockNames);
    if (!placeable) {
      this.log(`No placement block available from [${this.settings.blockNames.join(", ")}].`);
      return;
    }

    const prediction = this.resolvePlanningPrediction(placeable.name, planningYLevel);
    this.diagnostics.lastPredictedTargetKey = prediction == null ? null : blockKey(prediction.projectedTargetPos);
    if (prediction == null) return;

    const selection = this.selectBestPlacementCandidate(prediction, placeable.name);
    if (selection == null) {
      return;
    }

    this.diagnostics.lastWarningKey = null;
    this.diagnostics.lastSimulationDebug = null;
    const targetKey = selection.plan.candidates.map((candidate) => blockKey(candidate.targetPos)).join("|");
    this.state.lastResolvedTargetKey = targetKey;

    if (selection.kind === "already_supported") {
      this.state.deferredPlacement = null;
      this.clearPitchStrategy();
      this.state.satisfiedLandingCount++;
      this.log(
        `Using existing support at ${targetKey} ` +
        `predictedTick=${selection.plan.candidates[0].interceptTick} ` +
        `reach=${Math.max(...selection.plan.candidates.map((candidate) => candidate.reachDistance)).toFixed(2)} ` +
        `crossing=${selection.plan.candidates[0].crossingPos.toString()} ` +
        `landing=${selection.plan.candidates[0].landingPos.toString()}`,
      );
      return;
    }

    if (this.settings.placeOnLastValidTickOnly) {
      const executeTick = this.diagnostics.tickNumber + Math.max(0, selection.plan.candidates[0].interceptTick - 1);
      this.state.deferredPlacement = {
        executeTick,
        placeableName: placeable.name,
        plan: selection.plan,
      };
      if (this.diagnostics.tickNumber < executeTick) {
        return;
      }
      this.state.deferredPlacement = null;
    }

    void this.placeRecoveryBlocks(selection.plan, placeable.name);
  }

  // Control logic
  private getWantedPitchRadians() {
    return this.controller.getDesiredPitchRadians() ?? this.bot.entity.pitch;
  }

  private clearPitchStrategy() {
    this.state.pitchOverrideState = { mode: "none", pitch: null };
    this.controller.setInputPitchOverrideRadians(null);
  }

  private applyCommittedPitchIfNeeded() {
    if (this.state.pitchOverrideState.mode !== "none") {
      this.controller.setInputPitchOverrideRadians(this.state.pitchOverrideState.pitch);
      this.applyImmediatePitch(this.state.pitchOverrideState.pitch);
    }
  }

  private setActivePlanPitchOverride(pitchRadians: number) {
    this.state.pitchOverrideState = { mode: "plan", pitch: pitchRadians };
    this.controller.setInputPitchOverrideRadians(pitchRadians);
    this.applyImmediatePitch(pitchRadians);
  }

  private enterRecoveryPitch(currentPitchRadians: number, currentPrediction: PlacementPrediction) {
    const currentPitchDeg = toDegrees(currentPitchRadians);
    const recoveryPitchDeg = ONE_TICK_UPWARD_RECOVERY_PITCH_DEG;
    const recoveryPitchRadians = toRadians(recoveryPitchDeg);
    if (Math.abs(recoveryPitchDeg - currentPitchDeg) <= 1e-3) {
      return;
    }

    this.state.pitchOverrideState = { mode: "recovery", pitch: recoveryPitchRadians };
    this.controller.setInputPitchOverrideRadians(recoveryPitchRadians);
    this.applyImmediatePitch(recoveryPitchRadians);
    this.log(
      `Applied one-tick upward pitch recovery from ${currentPitchDeg.toFixed(1)} deg ` +
      `to ${recoveryPitchDeg.toFixed(1)} deg delta=${(recoveryPitchDeg - currentPitchDeg).toFixed(1)} deg ` +
      `currentBotPos=${this.bot.entity.position.toString()} currentBotVel=${this.bot.entity.velocity.toString()} ` +
      `${this.describePredictionPositions("", currentPrediction)} ` +
      `predictedTick=${currentPrediction.interceptTick}`,
    );
  }

  private resolvePlanningPrediction(blockName: string, planningYLevel: number) {
    const wantedPitch = this.getWantedPitchRadians();
    const currentlyBelowTrackedY = this.bot.entity.position.y + 1e-6 < planningYLevel;
    const mode = this.getCurrentMode(planningYLevel);
    const activePitch = this.state.pitchOverrideState.mode === "plan"
      ? this.state.pitchOverrideState.pitch
      : wantedPitch;
    const wantedPitchReachesPlanningY = mode === "ascending"
      ? this.planner.reachesYLevel(planningYLevel, wantedPitch)
      : false;

    if (
      mode === "ascending" &&
      this.state.pitchOverrideState.mode === "plan" &&
      (!currentlyBelowTrackedY || wantedPitchReachesPlanningY)
    ) {
      this.clearPitchStrategy();
      this.applyImmediatePitch(wantedPitch);
    }

    if (
      !this.bot.entity.onGround &&
      this.bot.entity.velocity.y <= 0 &&
      this.bot.entity.position.y + 1e-6 < planningYLevel - 1
    ) {
      this.activateFallback();
      return null;
    }

    if (this.state.pitchOverrideState.mode === "recovery") {
      if (currentlyBelowTrackedY) {
        this.applyCommittedPitchIfNeeded();
        return null;
      }
      this.clearPitchStrategy();
      this.applyImmediatePitch(wantedPitch);
    }

    const startPitch = mode === "ascending"
      ? wantedPitch
      : this.state.pitchOverrideState.mode === "plan"
        ? this.state.pitchOverrideState.pitch
        : wantedPitch;

    if (
      mode === "ascending" &&
      !wantedPitchReachesPlanningY &&
      (this.bot.entity.onGround || (this.bot.entity.velocity.y > 0 && this.bot.entity.position.y + 0.05 < planningYLevel))
    ) {
      const adjustedAscendingPitch = this.findAscendingHeightRecoveryPitchPlan(
        wantedPitch,
        planningYLevel,
      );
      if (adjustedAscendingPitch != null) {
        this.setActivePlanPitchOverride(adjustedAscendingPitch);
        return null;
      }
    }

    const prediction = this.predictPlanningIntercept(planningYLevel, startPitch, mode);
    if (prediction == null) {
      return null;
    }

    if (prediction.interceptTick !== 1) {
      return prediction;
    }

    const alternatePrediction = this.findMinimalTwoTickPitchPlan(
      startPitch,
      prediction,
      blockName,
      planningYLevel,
      mode,
    );
    if (alternatePrediction != null) {
      return alternatePrediction;
    }

    this.enterRecoveryPitch(startPitch, prediction);
    return null;
  }

  // Inventory / equipment helpers
  private ensurePlaceableEquipped() {
    if (this.state.pendingEquip != null || this.state.pendingPlacement != null) {
      return;
    }

    const placeable = findFirstPlaceableBlock(this.bot, this.settings.blockNames);
    if (placeable == null || this.bot.heldItem?.name === placeable.name) {
      return;
    }

    this.state.pendingEquip = (async () => {
      try {
        await this.bot.equip(placeable, "hand");
      } catch (error) {
        this.log(`Background equip failed for ${placeable.name}: ${String(error)}`);
      } finally {
        this.state.pendingEquip = null;
      }
    })();
  }

  private findMinimalTwoTickPitchPlan(
    startPitchRadians: number,
    currentPrediction: PlacementPrediction,
    blockName: string,
    planningYLevel: number,
    mode: PlacementOperationalMode,
  ) {
    const currentPitchDeg = toDegrees(startPitchRadians);
    if (Math.abs(currentPitchDeg) <= 1e-3) {
      return null;
    }

    const step = currentPitchDeg < 0 ? PITCH_SHALLOW_SEARCH_STEP_DEG : -PITCH_SHALLOW_SEARCH_STEP_DEG;
    for (
      let nextPitchDeg = currentPitchDeg + step;
      step > 0 ? nextPitchDeg <= 0 : nextPitchDeg >= 0;
      nextPitchDeg += step
    ) {
      const adjustedPrediction = this.predictPlanningIntercept(
        planningYLevel,
        toRadians(nextPitchDeg),
        mode,
      );
      if (adjustedPrediction == null) {
        continue;
      }

      if (
        adjustedPrediction.interceptTick === 2 &&
        this.hasViablePlacementPlan(adjustedPrediction, blockName)
      ) {
        const adjustedPitchRadians = toRadians(nextPitchDeg);
        this.setActivePlanPitchOverride(adjustedPitchRadians);
        this.log(
          `Adjusted pitch immediately from ${currentPitchDeg.toFixed(1)} deg ` +
          `to ${nextPitchDeg.toFixed(1)} deg delta=${(nextPitchDeg - currentPitchDeg).toFixed(1)} deg ` +
          `currentBotPos=${this.bot.entity.position.toString()} currentBotVel=${this.bot.entity.velocity.toString()} ` +
          `${this.describePredictionPositions("before", currentPrediction)} beforePredictedTick=${currentPrediction.interceptTick} ` +
          `${this.describePredictionPositions("after", adjustedPrediction)} afterPredictedTick=${adjustedPrediction.interceptTick}`,
        );
        return adjustedPrediction;
      }
    }

    return null;
  }

  private findAscendingHeightRecoveryPitchPlan(
    startPitchRadians: number,
    planningYLevel: number,
  ): number | null {
    const currentPitchDeg = toDegrees(startPitchRadians);
    if (this.planner.reachesYLevel(planningYLevel, startPitchRadians)) {
      this.log(
        `Ascending pitch recovery skipped: current pitch already reaches planningY ` +
        `pitchDeg=${currentPitchDeg.toFixed(1)} planningY=${planningYLevel.toFixed(3)} ` +
        `botPos=${this.bot.entity.position.toString()} botVel=${this.bot.entity.velocity.toString()}`,
      );
      return null;
    }

    const pitchCandidatesDeg: number[] = [];
    let lastFailureReason: string | null = null;
    const firstPitchDeg = Math.ceil(currentPitchDeg + PITCH_SHALLOW_SEARCH_STEP_DEG);
    for (let nextPitchDeg = firstPitchDeg; nextPitchDeg <= 40; nextPitchDeg += PITCH_SHALLOW_SEARCH_STEP_DEG) {
      pitchCandidatesDeg.push(nextPitchDeg);
    }

    for (const nextPitchDeg of pitchCandidatesDeg) {
      const nextPitchRadians = toRadians(nextPitchDeg);
      const adjustedPrediction = this.planner.predictInterceptAboveTrackedY(
        planningYLevel,
        nextPitchRadians,
      );
      if (adjustedPrediction == null) {
        lastFailureReason =
          `pitch=${nextPitchDeg.toFixed(1)} no_upward_intercept planningY=${planningYLevel.toFixed(3)}`;
        continue;
      }

      if (!this.planner.reachesYLevel(planningYLevel, nextPitchRadians)) {
        lastFailureReason =
          `pitch=${nextPitchDeg.toFixed(1)} adjusted_pitch_still_misses_planningY planningY=${planningYLevel.toFixed(3)}`;
        continue;
      }

      this.log(
        `Adjusted ascending pitch from ${currentPitchDeg.toFixed(1)} deg ` +
        `to ${nextPitchDeg.toFixed(1)} deg delta=${(nextPitchDeg - currentPitchDeg).toFixed(1)} deg ` +
        `planningY=${planningYLevel.toFixed(3)} ` +
        `currentBotPos=${this.bot.entity.position.toString()} currentBotVel=${this.bot.entity.velocity.toString()} ` +
        `${this.describePredictionPositions("after", adjustedPrediction)} afterPredictedTick=${adjustedPrediction.interceptTick}`,
      );
      return nextPitchRadians;
    }

    this.log(
      `Ascending pitch recovery found no adjustment ` +
      `startPitchDeg=${currentPitchDeg.toFixed(1)} planningY=${planningYLevel.toFixed(3)} ` +
      `botPos=${this.bot.entity.position.toString()} botVel=${this.bot.entity.velocity.toString()} ` +
      `searched=${pitchCandidatesDeg.length} lastFailure=${lastFailureReason ?? "none"}`,
    );
    return null;
  }

  private predictPlanningIntercept(
    planningYLevel: number,
    pitchRadians: number,
    mode: PlacementOperationalMode,
  ) {
    return this.planner.predictInterceptBelowTrackedY(planningYLevel, pitchRadians);
  }

  // Immediate bot state synchronization
  private applyImmediateLook(yawRadians: number | null, pitchRadians: number | null) {
    const nextYaw = yawRadians ?? this.bot.entity.yaw;
    const nextPitch = pitchRadians ?? this.bot.entity.pitch;
    void this.bot.look(nextYaw, nextPitch, true);

    if (yawRadians != null) {
      this.bot.entity.yaw = yawRadians;
    }
    if (pitchRadians != null) {
      this.bot.entity.pitch = pitchRadians;
    }

    const livePhysicsState = (this.bot as any).physicsEngineCtx?.state;
    if (livePhysicsState != null) {
      if (yawRadians != null && "yaw" in livePhysicsState) {
        livePhysicsState.yaw = yawRadians;
      }
      if (pitchRadians != null && "pitch" in livePhysicsState) {
        livePhysicsState.pitch = pitchRadians;
      }
    }

    const switchedState = (this.bot as any).physicsSwitcher?.getState?.();
    if (switchedState != null) {
      if (yawRadians != null && "yaw" in switchedState) {
        switchedState.yaw = yawRadians;
      }
      if (pitchRadians != null && "pitch" in switchedState) {
        switchedState.pitch = pitchRadians;
      }
    }
  }

  private applyImmediatePitch(pitchRadians: number) {
    this.applyImmediateLook(null, pitchRadians);
  }

  private describePredictionPositions(label: string, prediction: PlacementPrediction) {
    return (
      `${label}PredictedBeforePos=${prediction.beforePos.toString()} ` +
      `${label}PredictedCrossing=${prediction.crossingPos.toString()} ` +
      `${label}PredictedLanding=${prediction.landingPos.toString()}`
    );
  }

  // Placement execution
  private handlePlacementRequest(
    placeableName: string,
    candidate: PlacementCandidate,
    swingArm: "right" | undefined,
  ) {
    const referenceBlock = this.getPlaceReference(candidate);
    const placementPromise = (this.bot as any)._genericPlace(referenceBlock, new Vec3(0, 1, 0), {
      swingArm,
      forceLook: "ignore",
    });

    // Mirror the placement immediately after dispatch so the local prediction path
    // sees the support before any async continuation resumes.
    this.applyClientSidePlacedBlock(placeableName, candidate.targetPos);
    this.state.placedBlockCount++;
    return placementPromise;
  }

  private async placeRecoveryBlocks(plan: PlacementPlan, placeableName: string) {
    const targetKey = plan.candidates.map((candidate) => blockKey(candidate.targetPos)).join("|");
    this.state.pendingPlacement = (async () => {
      const placementRequestedAt = Date.now();
      try {
        const planningYLevel = this.getCurrentPlanningYLevel();
        if (
          planningYLevel != null &&
          this.bot.entity.position.y + 1e-6 < planningYLevel &&
          this.bot.entity.velocity.y <= 0
        ) {
          this.log(
            `Skipped placement below trackedY at ${targetKey} ` +
            `pos=${this.bot.entity.position.toString()} vel=${this.bot.entity.velocity.toString()} ` +
            `trackedY=${planningYLevel.toFixed(3)} ` +
            `requestMs=${Date.now() - placementRequestedAt}`,
          );
          this.clearPitchStrategy();
          return;
        }

        const placeable = findInventoryItem(this.bot, placeableName);
        if (!placeable) {
          this.log(`Placement block ${placeableName} was no longer available.`);
          return;
        }

        if (this.bot.heldItem?.name !== placeable.name) {
          this.log(
            `Skipped placement at ${targetKey} because ${placeable.name} was not yet equipped ` +
            `held=${this.bot.heldItem?.name ?? "null"} pos=${this.bot.entity.position.toString()} ` +
            `requestMs=${Date.now() - placementRequestedAt}`,
          );
          this.ensurePlaceableEquipped();
          this.clearPitchStrategy();
          return;
        }

        const placementPromises: Promise<unknown>[] = [];
        for (let i = 0; i < plan.candidates.length; i++) {
          const candidate = plan.candidates[i];
          const existingBlock = this.bot.blockAt(candidate.targetPos);
          if (!isReplaceable(existingBlock)) {
            continue;
          }

          placementPromises.push(
            this.handlePlacementRequest(placeable.name, candidate, i === 0 ? "right" : undefined),
          );
        }

        const primaryCandidate = plan.candidates[0];
        this.log(
          `Placed ${placeable.name} at ${targetKey} ` +
          `botPos=${this.bot.entity.position.toString()} pitchDeg=${toDegrees(this.bot.entity.pitch).toFixed(1)} ` +
          `predictedTick=${primaryCandidate.interceptTick} ` +
          `reach=${Math.max(...plan.candidates.map((candidate) => candidate.reachDistance)).toFixed(2)} ` +
          `crossing=${primaryCandidate.crossingPos.toString()} landing=${primaryCandidate.landingPos.toString()} ` +
          `requestMs=${Date.now() - placementRequestedAt}`,
        );
        await Promise.all(placementPromises);
        this.clearPitchStrategy();
      } catch (error) {
        this.log(`Placement failed at ${targetKey}: ${String(error)} requestMs=${Date.now() - placementRequestedAt}`);
        this.clearPitchStrategy();
      } finally {
        this.state.pendingPlacement = null;
      }
    })();
  }

  private selectBestPlacementCandidate(prediction: PlacementPrediction, blockName: string, silent = false) {
    const candidates = this.planner.getTopFaceCandidates(prediction);
    let sawReachFailure = false;
    let closestOutOfReach: PlacementCandidate | null = null;
    this.diagnostics.lastSimulationDebug = null;

    for (const candidate of candidates) {
      const candidateKey = blockKey(candidate.targetPos);
      if (
        this.state.lastResolvedTargetKey?.split("|").includes(candidateKey) &&
        isReplaceable(this.bot.blockAt(candidate.targetPos))
      ) {
        continue;
      }

      const resolution = this.resolvePlacementCandidate(prediction, candidate, blockName);
      switch (resolution.kind) {
        case "success":
        case "already_supported":
          return resolution;
        case "out_of_reach":
          sawReachFailure = true;
          if (closestOutOfReach == null || candidate.reachDistance < closestOutOfReach.reachDistance) {
            closestOutOfReach = candidate;
          }
          continue;
        case "no_support":
        case "occupied":
        case "failed":
          continue;
        case "build_failed":
          if (!silent) {
            this.warnOnce(
              `build:${resolution.blockName}`,
              `WARN: could not build predicted block state for ${resolution.blockName}.`,
            );
          }
          return null;
      }
    }

    if (sawReachFailure) {
      if (!silent) {
        this.warnOnce(
          `reach:${blockKey(prediction.projectedTargetPos)}@${prediction.interceptTick}`,
          `WARN: all top-face candidates near ${blockKey(prediction.projectedTargetPos)} were beyond reach ${BLOCK_REACH_DISTANCE.toFixed(1)}. ` +
          `botPos=${this.bot.entity.position.toString()} botVel=${this.bot.entity.velocity.toString()} ` +
          `crossing=${prediction.crossingPos.toString()} ` +
          `closest=${closestOutOfReach == null ? "null" : blockKey(closestOutOfReach.targetPos)} ` +
          `closestReach=${closestOutOfReach == null ? "null" : closestOutOfReach.reachDistance.toFixed(2)}`,
        );
      }
      return null;
    }

    if (!silent) {
      this.warnOnce(
        `reject:${blockKey(prediction.projectedTargetPos)}@${prediction.interceptTick}`,
        `WARN: no top-face collision candidate produced a landing near ${blockKey(prediction.projectedTargetPos)}. ` +
        `botPos=${this.bot.entity.position.toString()} botVel=${this.bot.entity.velocity.toString()} ` +
        `crossing=${prediction.crossingPos.toString()} candidates=${candidates.map((candidate) => blockKey(candidate.targetPos)).join("|")}` +
        `${this.diagnostics.lastSimulationDebug == null ? "" : ` sim=${this.diagnostics.lastSimulationDebug}`}`,
      );
    }
    return null;
  }

  private hasViablePlacementPlan(prediction: PlacementPrediction, blockName: string) {
    const previousSimulationDebug = this.diagnostics.lastSimulationDebug;
    const selection = this.selectBestPlacementCandidate(prediction, blockName, true);
    this.diagnostics.lastSimulationDebug = previousSimulationDebug;
    return selection != null;
  }

  private getCurrentPlanningYLevel() {
    if (this.state.trackedYLevel == null) {
      return null;
    }

    if (this.state.fallbackYLevel != null) {
      return this.state.fallbackYLevel;
    }

    const epsilon = 1e-6;
    const currentY = this.bot.entity.position.y;
    if (currentY + epsilon < this.state.trackedYLevel) {
      const ascentBaseY =
        this.state.lastGroundedYLevel ??
        (this.bot.entity.onGround ? currentY : Math.floor(currentY));
      const steppedTarget = ascentBaseY + this.settings.maxAscendStep;
      return Math.min(this.state.trackedYLevel, steppedTarget);
    }

    const steppedTarget = currentY - this.settings.maxDescendStep;
    return Math.max(this.state.trackedYLevel, steppedTarget);
  }

  private getCurrentMode(planningYLevel = this.getCurrentPlanningYLevel()): PlacementOperationalMode {
    if (this.state.trackedYLevel == null || planningYLevel == null) {
      return "idle";
    }

    const epsilon = 1e-6;
    const currentY = this.bot.entity.position.y;

    if (this.state.fallbackYLevel != null) {
      return "fallback";
    }

    // Ascending intent is defined by still being below the final tracked level,
    // even when the staged planning level has advanced to that final target.
    if (currentY + epsilon < this.state.trackedYLevel) {
      return "ascending";
    }

    if (!this.controller.isBouncing()) {
      return "idle";
    }

    if (this.state.pitchOverrideState.mode === "recovery") {
      return "recovery";
    }

    if (planningYLevel > this.state.trackedYLevel + epsilon) {
      return "descending";
    }

    return "level";
  }

  private refreshGroundedYLevel() {
    if (!this.bot.entity.onGround) {
      return;
    }

    this.state.lastGroundedYLevel = this.bot.entity.position.y;
  }

  private refreshFallbackState() {
    const fallbackYLevel = this.state.fallbackYLevel;
    if (fallbackYLevel == null) {
      return;
    }

    if (this.bot.entity.onGround) {
      this.state.fallbackYLevel = null;
      return;
    }

    const currentY = this.bot.entity.position.y;
    if (currentY + 1e-6 < fallbackYLevel) {
      this.state.fallbackYLevel = Math.floor(currentY);
    }
  }

  private activateFallback() {
    const fallbackYLevel = Math.floor(this.bot.entity.position.y);
    if (this.state.fallbackYLevel === fallbackYLevel) {
      return;
    }

    this.state.fallbackYLevel = fallbackYLevel;
    this.clearPitchStrategy();
    this.applyImmediatePitch(this.getWantedPitchRadians());
    this.log(
      `Fallback engaged currentY=${this.bot.entity.position.y.toFixed(3)} ` +
      `fallbackY=${fallbackYLevel.toFixed(3)} trackedY=${this.state.trackedYLevel?.toFixed(3) ?? "null"} ` +
      `botVel=${this.bot.entity.velocity.toString()}`,
    );
  }

  private applyClientSidePlacedBlock(blockName: string, targetPos: Vec3) {
    const blockInfo = this.bot.registry.blocksByName[blockName];
    if (!blockInfo) {
      return;
    }

    const updater = (this.bot as any)._updateBlockState;
    if (typeof updater === "function") {
      updater(targetPos, blockInfo.defaultState);
    }
  }

  private getPlaceReference(candidate: PlacementCandidate): Block | PlaceReference {
    const referenceBlock = this.bot.blockAt(candidate.referencePos);
    if (referenceBlock != null) {
      if (referenceBlock.type === this.bot.registry.blocksByName.air.id) {
        return { position: candidate.targetPos.clone() };
      }
      return referenceBlock;
    }

    return {
      position: candidate.referencePos.clone(),
    };
  }

  // Candidate resolution / support simulation
  private resolvePlacementCandidate(prediction: PlacementPrediction, candidate: PlacementCandidate, blockName: string): CandidateResolution {
    const existingBlock = this.bot.blockAt(candidate.targetPos);

    if (candidate.reachDistance > BLOCK_REACH_DISTANCE) {
      return { kind: "out_of_reach", candidate };
    }

    if (!isReplaceable(existingBlock)) {
      const existingResult = this.supportPlanSimulator.simulateSupportPlan(
        this.getCurrentPlanningYLevel(),
        prediction,
        { candidates: [candidate] },
        [] as Block[],
      );
      if (existingResult.kind === "supported") {
        return { kind: "already_supported", plan: { candidates: [candidate] } };
      }

      this.diagnostics.lastSimulationDebug =
        `existing:${this.supportPlanSimulator.describeSupportSimulationResult([candidate], existingResult)}`;
      return { kind: "occupied", candidate };
    }

    const singlePlan: PlacementPlan = { candidates: [candidate] };
    const buildable = this.supportPlanSimulator.buildPredictedBlocksForPlan(
      this.getCurrentPlanningYLevel(),
      prediction,
      singlePlan,
      blockName,
    );
    if ("kind" in buildable) {
      return buildable;
    }
    if (!buildable.ok) {
      return { kind: "failed", candidate };
    }

    const singleResult = this.supportPlanSimulator.simulateSupportPlan(
      this.getCurrentPlanningYLevel(),
      prediction,
      singlePlan,
      buildable.predictedBlocks,
    );
    if (singleResult.kind === "supported") {
      return { kind: "success", plan: singlePlan };
    }

    this.diagnostics.lastSimulationDebug =
      `single:${this.supportPlanSimulator.describeSupportSimulationResult(singlePlan.candidates, singleResult)}`;

    if (singleResult.kind === "velocity_killed") {
      const stripResolution = this.tryVelocityRecoveryStrip(prediction, candidate, blockName, singleResult);
      if (stripResolution.kind === "build_failed") {
        return stripResolution;
      }

      if (stripResolution.kind === "success") {
        return stripResolution;
      }
    }

    return { kind: "failed", candidate };
  }

  private tryVelocityRecoveryStrip(
    prediction: PlacementPrediction,
    candidate: PlacementCandidate,
    blockName: string,
    singleResult: SupportSimulationResult,
  ): CandidateResolution | { kind: "no_strip_match" } {
    const stripCandidates = this.planner.buildVelocityRecoveryStripCandidates(prediction, candidate);
    let bestDebug =
      `single:${this.supportPlanSimulator.describeSupportSimulationResult([candidate], singleResult)}`;

    for (let length = 2; length <= stripCandidates.length; length++) {
      for (const frontOffset of this.planner.getVelocityRecoveryFrontOffsets()) {
        const stripPlan = this.planner.buildVelocityRecoveryStripPlan(
          prediction,
          candidate,
          length,
          frontOffset,
        );
        if (stripPlan == null) {
          continue;
        }

        const buildable = this.supportPlanSimulator.buildPredictedBlocksForPlan(
          this.getCurrentPlanningYLevel(),
          prediction,
          stripPlan,
          blockName,
        );
        if ("kind" in buildable) {
          return buildable;
        }

        if (!buildable.ok) {
          continue;
        }

        const stripResult = this.supportPlanSimulator.simulateSupportPlan(
          this.getCurrentPlanningYLevel(),
          prediction,
          stripPlan,
          buildable.predictedBlocks,
        );
        bestDebug =
          `single:${this.supportPlanSimulator.describeSupportSimulationResult([candidate], singleResult)} ` +
          `strip${length}@${frontOffset}:${this.supportPlanSimulator.describeSupportSimulationResult(stripPlan.candidates, stripResult)}`;
        if (stripResult.kind === "supported") {
          return { kind: "success", plan: stripPlan };
        }
      }
    }

    this.diagnostics.lastSimulationDebug = bestDebug;
    return { kind: "no_strip_match" };
  }

  // Logging / diagnostics
  private log(message: string) {
    this.emit("log", { tick: this.diagnostics.tickNumber, message });
  }

  private warnOnce(key: string, message: string) {
    if (this.diagnostics.lastWarningKey === key) return;
    this.diagnostics.lastWarningKey = key;
    this.log(message);
  }
}

export function registerPlacementAssistLogging(placementAssist: PredictiveTopPlacementAssist) {
  placementAssist.on("log", ({ tick, message }) => {
    console.log(`[ebounce-scaffold][tick=${tick}] ${message}`);
  });
  placementAssist.on("tick_state", ({ tick, mode, trackedYLevel, activeTrackedYLevel, pitchDeg, pos, vel }) => {
    if (mode === "idle") {
      return;
    }

    console.log(
      `[ebounce-scaffold][tick=${tick}] STATE mode=${mode} ` +
      `trackedY=${trackedYLevel == null ? "null" : trackedYLevel.toFixed(3)} ` +
      `activeTrackedY=${activeTrackedYLevel == null ? "null" : activeTrackedYLevel.toFixed(3)} ` +
      `pitchDeg=${pitchDeg.toFixed(1)} ` +
      `pos=${pos.toString()} vel=${vel.toString()}`,
    );
  });
}
