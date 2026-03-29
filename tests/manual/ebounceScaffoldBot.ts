import type { Block } from "prismarine-block";
import { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import {
  BotcraftPhysics,
  EPhysicsCtx,
} from "../../src/index";
import {
  buildManagedBot,
  getBotOptionsFromArgs,
  sleep,
} from "../helpers/manual/botSetup";
import {
  EBounceBot,
  EBounceController,
  findInventoryItem,
  MineflayerEBouncePort,
  ensureBounceLoadout,
  registerEBounceLogging,
  toDegrees,
  toRadians,
} from "../helpers/manual/ebounceShared";

const BLOCK_REACH_DISTANCE = 4.5;
const SUPPORT_CONFIRMATION_TICKS = 6;
const SUPPORT_VELOCITY_RETENTION_RATIO = 0.8;
const MAX_VELOCITY_RECOVERY_STRIP_LENGTH = 5;
const MAX_VELOCITY_RECOVERY_FRONT_OFFSET = 3;
const MAX_VELOCITY_RECOVERY_FORWARD_EXTENSION = 1;
const PITCH_SHALLOW_SEARCH_STEP_DEG = 1;
const DEFAULT_PLACEABLE_BLOCK_NAMES = [
  "cobblestone",
  "stone",
  "dirt",
  "netherrack",
  "andesite",
  "diorite",
  "granite",
  "deepslate",
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

let activeBot: Bot;

function getBotOptions() {
  return getBotOptionsFromArgs({
    defaultUsername: "testingbot",
    versionIndex: 4,
    usernameIndex: 5,
    authIndex: 6,
  });
}

function blockKey(pos: Vec3) {
  return `${pos.x},${pos.y},${pos.z}`;
}

function isReplaceable(block: Block | null) {
  if (block == null) return true;
  if (REPLACEABLE_BLOCK_NAMES.has(block.name)) return true;
  return block.boundingBox === "empty";
}

function hasSolidTopSupport(block: Block | null) {
  return block != null && block.boundingBox === "block";
}

function findFirstPlaceableBlock(bot: Bot, names: readonly string[]) {
  for (const name of names) {
    const item = findInventoryItem(bot, name);
    if (item) return item;
  }
  return null;
}

class PredictiveTopPlacementAssist {
  private readonly simPhysics: BotcraftPhysics;
  private readonly BlockCtor: any;
  private trackedYLevel: number | null = null;
  private readonly blockNames = [...DEFAULT_PLACEABLE_BLOCK_NAMES];
  private pendingPlacement: Promise<void> | null = null;
  private placementCooldownTicks = 0;
  private lastPrediction: PlacementPrediction | null = null;
  private placedBlockCount = 0;
  private satisfiedLandingCount = 0;
  private lastWarningKey: string | null = null;
  private lastRealHorizontalCollision = false;
  private lastRealBelowTrackedY = false;
  private lastResolvedTargetKey: string | null = null;
  private lastSimulationDebug: string | null = null;

  constructor(
    private readonly bot: EBounceBot,
    private readonly controller: EBounceController,
  ) {
    this.simPhysics = new BotcraftPhysics(bot.registry);
    this.BlockCtor = require("prismarine-block")(bot.registry);
  }

  public armFromCurrentYLevel() {
    this.trackedYLevel = this.bot.entity.position.y;
    this.lastPrediction = null;
    this.placementCooldownTicks = 0;
    this.lastWarningKey = null;
    this.lastResolvedTargetKey = null;
    this.lastSimulationDebug = null;
    this.log(`Tracked Y level armed at ${this.trackedYLevel.toFixed(3)}`);
  }

  public clear() {
    this.trackedYLevel = null;
    this.lastPrediction = null;
    this.placementCooldownTicks = 0;
    this.pendingPlacement = null;
    this.lastWarningKey = null;
    this.lastRealHorizontalCollision = false;
    this.lastRealBelowTrackedY = false;
    this.lastResolvedTargetKey = null;
    this.lastSimulationDebug = null;
  }

  public status() {
    return [
      `trackedY=${this.trackedYLevel == null ? "null" : this.trackedYLevel.toFixed(3)}`,
      `predictionTicks=unbounded`,
      `placeBlocks=${this.blockNames.join(",")}`,
      `placedBlocks=${this.placedBlockCount}`,
      `satisfiedLandings=${this.satisfiedLandingCount}`,
      `lastPredictedTarget=${this.lastPrediction == null ? "null" : blockKey(this.lastPrediction.projectedTargetPos)}`,
    ].join(" ");
  }

  public tick() {
    if (this.placementCooldownTicks > 0) {
      this.placementCooldownTicks--;
    }

    this.logRealHorizontalCollision();
    this.logRealBelowTrackedY();

    if (!this.controller.isBouncing() || this.trackedYLevel == null) {
      this.lastPrediction = null;
      return;
    }

    if (this.pendingPlacement != null || this.placementCooldownTicks > 0) {
      return;
    }

    let prediction = this.predictInterceptBelowTrackedY();
    this.lastPrediction = prediction;
    if (prediction == null) return;

    const placeable = findFirstPlaceableBlock(this.bot, this.blockNames);
    if (!placeable) {
      this.log(`No placement block available from [${this.blockNames.join(", ")}].`);
      return;
    }

    if (prediction.interceptTick === 1) {
      const adjustedPrediction = this.tryAdjustPitchForExtraLead(prediction, placeable.name);
      if (adjustedPrediction != null) {
        prediction = adjustedPrediction;
        this.lastPrediction = adjustedPrediction;
      }
    }

    const selection = this.selectBestPlacementCandidate(prediction, placeable.name);
    if (selection == null) {
      return;
    }

    this.lastWarningKey = null;
    this.lastSimulationDebug = null;
    const targetKey = selection.plan.candidates.map((candidate) => blockKey(candidate.targetPos)).join("|");
    this.lastResolvedTargetKey = targetKey;

    if (selection.kind === "already_supported") {
      this.satisfiedLandingCount++;
      this.placementCooldownTicks = 2;
      this.log(
        `Using existing support at ${targetKey} ` +
        `predictedTick=${selection.plan.candidates[0].interceptTick} ` +
        `reach=${Math.max(...selection.plan.candidates.map((candidate) => candidate.reachDistance)).toFixed(2)} ` +
        `crossing=${selection.plan.candidates[0].crossingPos.toString()} ` +
        `landing=${selection.plan.candidates[0].landingPos.toString()}`,
      );
      return;
    }

    void this.placeRecoveryBlocks(selection.plan, placeable.name);
  }

  private predictInterceptBelowTrackedY(pitchOverride: number | null = null) {
    if (this.trackedYLevel == null) return null;

    const simCtx = EPhysicsCtx.FROM_BOT(this.simPhysics, this.bot);
    if (pitchOverride != null) {
      simCtx.state.pitch = pitchOverride;
    }
    let tick = 0;

    while (true) {
      tick++;
      const beforeStateCtx = simCtx.clone();
      const previousPos = simCtx.state.pos.clone();
      const previousHalfWidth = simCtx.state.halfWidth;
      this.simPhysics.simulate(simCtx, this.bot.world);

      const currentPos = simCtx.state.pos.clone();
      if (simCtx.state.onGround && currentPos.y >= this.trackedYLevel) {
        return null;
      }

      if (currentPos.y >= this.trackedYLevel) {
        continue;
      }

      const targetY = Math.floor(this.trackedYLevel) - 1;
      const crossingPos = this.interpolateCrossing(previousPos, currentPos, this.trackedYLevel);
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

  private tryAdjustPitchForExtraLead(currentPrediction: PlacementPrediction, blockName: string) {
    const currentPitchDeg = toDegrees(this.bot.entity.pitch);
    if (Math.abs(currentPitchDeg) <= 1e-3) {
      return null;
    }

    const step = currentPitchDeg < 0 ? PITCH_SHALLOW_SEARCH_STEP_DEG : -PITCH_SHALLOW_SEARCH_STEP_DEG;
    for (
      let nextPitchDeg = currentPitchDeg + step;
      step > 0 ? nextPitchDeg <= 0 : nextPitchDeg >= 0;
      nextPitchDeg += step
    ) {
      const adjustedPrediction = this.predictInterceptBelowTrackedY(toRadians(nextPitchDeg));
      if (adjustedPrediction == null) {
        continue;
      }

      if (
        adjustedPrediction.interceptTick >= 2 &&
        this.hasViablePlacementPlan(adjustedPrediction, blockName)
      ) {
        this.controller.setTargetPitchDegrees(nextPitchDeg);
        this.applyImmediatePitch(toRadians(nextPitchDeg));
        this.log(
          `Adjusted pitch immediately from ${currentPitchDeg.toFixed(1)} deg ` +
          `to ${nextPitchDeg.toFixed(1)} deg delta=${(nextPitchDeg - currentPitchDeg).toFixed(1)} deg ` +
          `beforePos=${this.bot.entity.position.toString()} beforeVel=${this.bot.entity.velocity.toString()} ` +
          `beforeCrossing=${currentPrediction.crossingPos.toString()} beforePredictedTick=${currentPrediction.interceptTick} ` +
          `afterCrossing=${adjustedPrediction.crossingPos.toString()} afterPredictedTick=${adjustedPrediction.interceptTick}`,
        );
        return adjustedPrediction;
      }
    }

    return null;
  }

  private applyImmediatePitch(pitchRadians: number) {
    this.bot.entity.pitch = pitchRadians;

    const livePhysicsState = (this.bot as any).physicsEngineCtx?.state;
    if (livePhysicsState != null && "pitch" in livePhysicsState) {
      livePhysicsState.pitch = pitchRadians;
    }

    const switchedState = (this.bot as any).physicsSwitcher?.getState?.();
    if (switchedState != null && "pitch" in switchedState) {
      switchedState.pitch = pitchRadians;
    }
  }

  private async placeRecoveryBlocks(plan: PlacementPlan, placeableName: string) {
    const targetKey = plan.candidates.map((candidate) => blockKey(candidate.targetPos)).join("|");
    this.pendingPlacement = (async () => {
      try {
        const placeable = findInventoryItem(this.bot, placeableName);
        if (!placeable) {
          this.log(`Placement block ${placeableName} was no longer available.`);
          return;
        }

        if (this.bot.heldItem?.name !== placeable.name) {
          await this.bot.equip(placeable, "hand");
        }

        this.placementCooldownTicks = 2;

        for (let i = 0; i < plan.candidates.length; i++) {
          const candidate = plan.candidates[i];
          const existingBlock = this.bot.blockAt(candidate.targetPos);
          if (!isReplaceable(existingBlock)) {
            continue;
          }

          const referenceBlock = this.bot.blockAt(candidate.referencePos);
          if (!hasSolidTopSupport(referenceBlock)) {
            throw new Error(`Missing top support for ${blockKey(candidate.targetPos)}`);
          }

          // Send each place attempt first, then immediately mirror the block into the
          // local world so subsequent physics ticks predict against the intended client state.
          await (this.bot as any)._genericPlace(referenceBlock, new Vec3(0, 1, 0), {
            swingArm: i === 0 ? 'right' : undefined,
            forceLook: 'ignore',
          });
          this.applyClientSidePlacedBlock(placeable.name, candidate.targetPos);
          this.placedBlockCount++;
        }

        const primaryCandidate = plan.candidates[0];
        this.log(
          `Placed ${placeable.name} at ${targetKey} ` +
          `predictedTick=${primaryCandidate.interceptTick} ` +
          `reach=${Math.max(...plan.candidates.map((candidate) => candidate.reachDistance)).toFixed(2)} ` +
          `crossing=${primaryCandidate.crossingPos.toString()} landing=${primaryCandidate.landingPos.toString()}`,
        );
      } catch (error) {
        this.log(`Placement failed at ${targetKey}: ${String(error)}`);
      } finally {
        this.pendingPlacement = null;
      }
    })();
  }

  private log(message: string) {
    console.log(`[ebounce-scaffold] ${message}`);
  }

  private logRealHorizontalCollision() {
    const collidedHorizontally = !!(this.bot.entity as any).isCollidedHorizontally;
    if (!collidedHorizontally) {
      this.lastRealHorizontalCollision = false;
      return;
    }

    if (this.lastRealHorizontalCollision) {
      return;
    }

    this.lastRealHorizontalCollision = true;
    this.log(
      `REAL horizontal collision pos=${this.bot.entity.position.toString()} ` +
      `vel=${this.bot.entity.velocity.toString()} onGround=${this.bot.entity.onGround} ` +
      `support=${(this.bot.entity as any).supportingBlockPos?.toString() ?? "null"}`,
    );
  }

  private logRealBelowTrackedY() {
    if (this.trackedYLevel == null) {
      this.lastRealBelowTrackedY = false;
      return;
    }

    const belowTrackedY = this.bot.entity.position.y + 1e-6 < this.trackedYLevel;
    if (!belowTrackedY) {
      this.lastRealBelowTrackedY = false;
      return;
    }

    if (this.lastRealBelowTrackedY) {
      return;
    }

    this.lastRealBelowTrackedY = true;
    this.log(
      `REAL below trackedY pos=${this.bot.entity.position.toString()} ` +
      `vel=${this.bot.entity.velocity.toString()} onGround=${this.bot.entity.onGround} ` +
      `trackedY=${this.trackedYLevel.toFixed(3)} ` +
      `support=${(this.bot.entity as any).supportingBlockPos?.toString() ?? "null"}`,
    );
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

  private selectBestPlacementCandidate(prediction: PlacementPrediction, blockName: string, silent = false) {
    const candidates = this.getTopFaceCandidates(prediction);
    let sawReachFailure = false;
    let closestOutOfReach: PlacementCandidate | null = null;
    this.lastSimulationDebug = null;

    for (const candidate of candidates) {
      const candidateKey = blockKey(candidate.targetPos);
      if (this.lastResolvedTargetKey?.split("|").includes(candidateKey)) {
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
        `${this.lastSimulationDebug == null ? "" : ` sim=${this.lastSimulationDebug}`}`,
      );
    }
    return null;
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

  private getTopFaceCandidates(prediction: PlacementPrediction) {
    return this.getTopFaceSeedTargetPositions(
      prediction.beforePos,
      prediction.landingPos,
      prediction.crossingPos,
      prediction.projectedTargetPos.y,
      prediction.halfWidth,
    ).map((targetPos) => this.buildCandidate(prediction, targetPos));
  }

  private hasViablePlacementPlan(prediction: PlacementPrediction, blockName: string) {
    const previousSimulationDebug = this.lastSimulationDebug;
    const selection = this.selectBestPlacementCandidate(prediction, blockName, true);
    this.lastSimulationDebug = previousSimulationDebug;
    return selection != null;
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

  private resolvePlacementCandidate(prediction: PlacementPrediction, candidate: PlacementCandidate, blockName: string): CandidateResolution {
    const existingBlock = this.bot.blockAt(candidate.targetPos);
    const referenceBlock = this.bot.blockAt(candidate.referencePos);
    if (!hasSolidTopSupport(referenceBlock)) {
      return { kind: "no_support", candidate };
    }

    if (candidate.reachDistance > BLOCK_REACH_DISTANCE) {
      return { kind: "out_of_reach", candidate };
    }

    if (!isReplaceable(existingBlock)) {
      const existingResult = this.simulateSupportPlan(prediction, { candidates: [candidate] }, [] as Block[]);
      if (existingResult.kind === "supported") {
        return { kind: "already_supported", plan: { candidates: [candidate] } };
      }

      this.lastSimulationDebug = `existing:${this.describeSupportSimulationResult([candidate], existingResult)}`;
      return { kind: "occupied", candidate };
    }

    const predictedBlock = this.makePredictedBlock(blockName, candidate.targetPos);
    if (predictedBlock == null) {
      return { kind: "build_failed", blockName };
    }

    const singlePlan: PlacementPlan = { candidates: [candidate] };
    const singleResult = this.simulateSupportPlan(prediction, singlePlan, [predictedBlock]);
    if (singleResult.kind === "supported") {
      return { kind: "success", plan: singlePlan };
    }

    this.lastSimulationDebug = `single:${this.describeSupportSimulationResult(singlePlan.candidates, singleResult)}`;

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
    const stripCandidates = this.buildVelocityRecoveryStripCandidates(prediction, candidate);
    let bestDebug =
      `single:${this.describeSupportSimulationResult([candidate], singleResult)}`;

    for (let length = 2; length <= stripCandidates.length; length++) {
      for (const frontOffset of this.getVelocityRecoveryFrontOffsets()) {
        const stripPlan = this.buildVelocityRecoveryStripPlan(
          prediction,
          candidate,
          stripCandidates,
          length,
          frontOffset,
        );
        if (stripPlan == null) {
          continue;
        }

        const buildable = this.buildPredictedBlocksForPlan(prediction, stripPlan, blockName);
        if (buildable.kind === "build_failed") {
          return buildable;
        }

        if (!buildable.ok) {
          continue;
        }

        const stripResult = this.simulateSupportPlan(prediction, stripPlan, buildable.predictedBlocks);
        bestDebug =
          `single:${this.describeSupportSimulationResult([candidate], singleResult)} ` +
          `strip${length}@${frontOffset}:${this.describeSupportSimulationResult(stripPlan.candidates, stripResult)}`;
        if (stripResult.kind === "supported") {
          return { kind: "success", plan: stripPlan };
        }
      }
    }

    this.lastSimulationDebug = bestDebug;
    return { kind: "no_strip_match" };
  }

  private buildVelocityRecoveryStripCandidates(prediction: PlacementPrediction, candidate: PlacementCandidate) {
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
    return Array.from({ length: MAX_VELOCITY_RECOVERY_STRIP_LENGTH + MAX_VELOCITY_RECOVERY_FORWARD_EXTENSION }, (_, index) =>
      this.buildCandidate(prediction, candidate.targetPos.plus(step.scaled(index))),
    );
  }

  private getVelocityRecoveryFrontOffsets() {
    const offsets = [0];
    for (let backward = 1; backward <= MAX_VELOCITY_RECOVERY_FRONT_OFFSET; backward++) {
      offsets.push(-backward);
    }
    for (let forward = 1; forward <= MAX_VELOCITY_RECOVERY_FORWARD_EXTENSION; forward++) {
      offsets.push(forward);
    }
    return offsets;
  }

  private buildVelocityRecoveryStripPlan(
    prediction: PlacementPrediction,
    candidate: PlacementCandidate,
    stripCandidates: PlacementCandidate[],
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

  private buildPredictedBlocksForPlan(prediction: PlacementPrediction, plan: PlacementPlan, blockName: string) {
    const predictedBlocks: Block[] = [];

    for (const candidate of plan.candidates) {
      const existingBlock = this.bot.blockAt(candidate.targetPos);
      const referenceBlock = this.bot.blockAt(candidate.referencePos);
      if (!hasSolidTopSupport(referenceBlock) || candidate.reachDistance > BLOCK_REACH_DISTANCE) {
        return { ok: false as const, predictedBlocks };
      }

      if (!isReplaceable(existingBlock)) {
        const existingSupportResult = this.simulateSupportPlan(prediction, { candidates: [candidate] }, [] as Block[]);
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

  private simulateSupportPlan(prediction: PlacementPrediction, plan: PlacementPlan, predictedBlocks: Block[]): SupportSimulationResult {
    if (this.trackedYLevel == null) {
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

      const standingOnTop = Math.abs(simCtx.state.pos.y - this.trackedYLevel) <= 0.05;
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

  private describeSupportSimulationResult(candidates: PlacementCandidate[], result: SupportSimulationResult) {
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

  private warnOnce(key: string, message: string) {
    if (this.lastWarningKey === key) return;
    this.lastWarningKey = key;
    this.log(message);
  }
}

async function handleChatCommand(
  bot: EBounceBot,
  username: string,
  message: string,
  controller: EBounceController,
  placementAssist: PredictiveTopPlacementAssist,
) {
  if (username === bot.username) return;

  const [command, ...args] = message.split(" ");

  switch (command) {
    case "prep":
      try {
        await ensureBounceLoadout(bot);
        bot.chat("Bounce loadout equipped.");
      } catch (error) {
        bot.chat(`Prep failed: ${String(error)}`);
      }
      return;
    case "bounce":
    case "start":
      if (args[0] != null) {
        const yaw = Number(args[0]);
        if (!Number.isNaN(yaw)) controller.setTargetYawDegrees(yaw);
      }
      if (args[1] != null) {
        const pitch = Number(args[1]);
        if (!Number.isNaN(pitch)) controller.setTargetPitchDegrees(pitch);
      }
      placementAssist.armFromCurrentYLevel();
      controller.beginBounce();
      bot.chat("Scaffold bounce sequence started.");
      return;
    case "boost":
      bot.activateItem();
      return;
    case "stop":
      controller.stopFlight();
      placementAssist.clear();
      bot.chat("Scaffold bounce sequence stopped.");
      return;
    case "status":
      bot.chat(controller.status());
      bot.chat(placementAssist.status());
      return;
    case "blocks":
      bot.chat(placementAssist.status());
      return;
    case "yaw":
      if (args[0] === "clear") {
        controller.clearTargetYaw();
        bot.chat("Target yaw cleared.");
        return;
      }

      if (args[0] != null) {
        const yaw = Number(args[0]);
        if (!Number.isNaN(yaw)) {
          controller.setTargetYawDegrees(yaw);
          bot.chat(`Target yaw set to ${yaw.toFixed(1)}.`);
        }
      }
      return;
    case "pitch":
      if (args[0] === "clear") {
        controller.clearTargetPitch();
        bot.chat("Target pitch cleared.");
        return;
      }

      if (args[0] != null) {
        const pitch = Number(args[0]);
        if (!Number.isNaN(pitch)) {
          controller.setTargetPitchDegrees(pitch);
          bot.chat(`Target pitch set to ${pitch.toFixed(1)}.`);
        }
      }
      return;
    case "lockyaw":
      controller.setLockYaw(args[0] !== "false");
      bot.chat(`lockYaw=${args[0] !== "false"}`);
      return;
    case "lockpitch":
      controller.setLockPitch(args[0] !== "false");
      bot.chat(`lockPitch=${args[0] !== "false"}`);
      return;
    case "forcefallflying":
    case "forceff":
      controller.setForceClientSideFallFlying(args[0] !== "false");
      bot.chat(`forceClientSideFallFlying=${args[0] !== "false"}`);
      return;
    case "reset":
      controller.resetState();
      placementAssist.clear();
      bot.quit();
      await sleep(3000);
      activeBot = buildBot();
      return;
    default:
      return;
  }
}

function buildBot() {
  let controller: EBounceController;
  let placementAssist: PredictiveTopPlacementAssist;

  return buildManagedBot<EBounceBot>(getBotOptions, {
    afterCreate: (bot, helpers) => {
      controller = new EBounceController(new MineflayerEBouncePort(bot, helpers.physicsSwitcher, false));
      placementAssist = new PredictiveTopPlacementAssist(bot, controller);
      registerEBounceLogging(bot, controller, false);
      bot.on("physicsTickBegin", () => {
        controller.tick();
        placementAssist.tick();
      });
      bot.on("end", () => {
        placementAssist.clear();
      });
    },
    onSpawn: async (bot, helpers) => {
      helpers.physicsSwitcher.enable();
      console.log("[ebounce-scaffold] new engine enabled");
      console.log("[ebounce-scaffold] chat commands: prep | bounce [yawDeg] [pitchDeg] | boost | stop | status | blocks | yaw <deg|clear> | pitch <deg|clear> | lockyaw <true|false> | lockpitch <true|false> | forcefallflying <true|false> | reset");
      await ensureBounceLoadout(bot).catch(() => {});
    },
    onChat: async (bot, username, message) => {
      await handleChatCommand(bot, username, message, controller, placementAssist);
    },
  });
}

activeBot = buildBot();
