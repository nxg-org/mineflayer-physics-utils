import { AABB } from "@nxg-org/mineflayer-util-plugin";
import md from "minecraft-data";
import { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { EPhysicsCtx } from "../settings/entityPhysicsCtx";
import { HorseState } from "../states/horseState";
import { IEntityState } from "../states";
import { EntityPhysics } from "./entityPhysics";

type PhysicsWorld = {
  getBlock(pos: Vec3): Block | null | undefined;
};

const GRAVITY = Math.fround(0.08);
const VERTICAL_DRAG = Math.fround(0.98);
const AIR_HORIZONTAL_INERTIA = Math.fround(0.91);
const WATER_SLOWDOWN = Math.fround(0.8);
const WATER_INPUT_ACCEL = Math.fround(0.02);
const GROUND_FRICTION_MULTIPLIER = Math.fround(0.91);
const FRICTION_INFLUENCED_SPEED_FACTOR = Math.fround(0.21600002);
const DEFAULT_BLOCK_FRICTION = Math.fround(0.6);
const HONEY_JUMP_FACTOR = Math.fround(0.5);
const FORWARD_JUMP_IMPULSE = Math.fround(0.4);

export class HorsePhysics extends EntityPhysics {
  constructor(mcData: md.IndexedData) {
    super(mcData);
  }

  simulate(simCtx: EPhysicsCtx, world: PhysicsWorld): IEntityState {
    if (!(simCtx.state instanceof HorseState)) {
      return super.simulate(simCtx, world);
    }

    const state = simCtx.state;
    if (!this.isWorldReady(simCtx, state, world)) {
      state.worldReady = false;
      return state;
    }

    state.worldReady = true;
    simCtx.stepHeight = 1.0;
    simCtx.gravity = GRAVITY;
    simCtx.airborneInertia = AIR_HORIZONTAL_INERTIA;
    simCtx.airborneAccel = Math.fround(state.movementSpeed * 0.1);
    simCtx.waterInertia = WATER_SLOWDOWN;
    simCtx.liquidAccel = WATER_INPUT_ACCEL;
    simCtx.useControls = false;
    simCtx.collisionBehavior = { blockEffects: true, affectedAfterCollision: true };

    this.updateFluidState(simCtx, state, world);
    this.applyGroundJump(state, world);

    const { strafe, forward } = state.getTravelInput();
    if (state.isInWater || state.isInLava) {
      this.travelInFluid(simCtx, state, strafe, forward, world);
    } else {
      this.travelInAir(simCtx, state, strafe, forward, world);
    }

    state.age++;
    return state;
  }

  private getHorseBB(simCtx: EPhysicsCtx, state: HorseState): AABB {
    return this.getEntityBB(simCtx, state.pos);
  }

  private getWorldReadinessBlockRange(simCtx: EPhysicsCtx, state: HorseState): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  } {
    const bb = this.getHorseBB(simCtx, state);
    const input = state.getTravelInput();
    const yaw = Math.PI - state.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const dx = input.strafe * cos - input.forward * sin;
    const dz = input.forward * cos + input.strafe * sin;
    const swept = bb.clone().extend(dx, state.vel.y, dz);
    const stepBB = bb.clone().extend(dx, 1.0, dz);
    const margin = 1;

    return {
      minX: Math.floor(Math.min(bb.minX, swept.minX, stepBB.minX)) - margin,
      maxX: Math.ceil(Math.max(bb.maxX, swept.maxX, stepBB.maxX)) + margin,
      minY: Math.floor(Math.min(bb.minY, swept.minY, stepBB.minY)) - margin,
      maxY: Math.ceil(Math.max(bb.maxY, swept.maxY, stepBB.maxY)) + margin,
      minZ: Math.floor(Math.min(bb.minZ, swept.minZ, stepBB.minZ)) - margin,
      maxZ: Math.ceil(Math.max(bb.maxZ, swept.maxZ, stepBB.maxZ)) + margin,
    };
  }

  private isWorldReady(simCtx: EPhysicsCtx, state: HorseState, world: PhysicsWorld): boolean {
    const range = this.getWorldReadinessBlockRange(simCtx, state);
    const cursor = new Vec3(0, 0, 0);

    for (cursor.y = range.minY; cursor.y < range.maxY; cursor.y++) {
      for (cursor.z = range.minZ; cursor.z < range.maxZ; cursor.z++) {
        for (cursor.x = range.minX; cursor.x < range.maxX; cursor.x++) {
          if (world.getBlock(cursor) == null) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private updateFluidState(simCtx: EPhysicsCtx, state: HorseState, world: PhysicsWorld): void {
    const vel = state.vel;
    const waterBB = this.getHorseBB(simCtx, state).contract(0.001, state.vel.y < 0 ? 0.401 : 0.001, 0.001);
    const lavaBB = this.getHorseBB(simCtx, state).contract(0.1, state.vel.y < 0 ? 0.4 : 0, 0.1);
    state.isInWater = this.isInWaterApplyCurrent(waterBB, vel, world);
    state.isInLava = this.isMaterialInBB(lavaBB, this.lavaId, world);
  }

  private getGroundFriction(simCtx: EPhysicsCtx, state: HorseState, world: PhysicsWorld): number {
    if (!state.onGround) return Math.fround(1.0);
    const blockPos = state.pos.floored().offset(0, -1, 0);
    const block = world.getBlock(blockPos);
    if (!block || block.boundingBox === "empty") return DEFAULT_BLOCK_FRICTION;
    return Math.fround(this.blockSlipperiness[block.type] ?? DEFAULT_BLOCK_FRICTION);
  }

  private getBlockJumpFactor(simCtx: EPhysicsCtx, state: HorseState, world: PhysicsWorld): number {
    const posBlock = world.getBlock(state.pos.floored());
    const belowBlock = world.getBlock(state.pos.floored().offset(0, -1, 0));
    const posFactor = this.getBlockJumpFactorForBlock(posBlock);
    const belowFactor = this.getBlockJumpFactorForBlock(belowBlock);
    return posFactor === 1.0 ? belowFactor : posFactor;
  }

  private getBlockJumpFactorForBlock(block: Block | null | undefined): number {
    if (!block) return 1.0;
    if (block.type === this.honeyblockId) return HONEY_JUMP_FACTOR;
    return 1.0;
  }

  private applyGroundJump(state: HorseState, world: PhysicsWorld): void {
    if (!state.onGround) return;
    if (state.jumpPendingScale <= 0 || state.isJumping) return;

    const blockJumpFactor = this.getBlockJumpFactor({} as EPhysicsCtx, state, world);
    const jumpBoostPower = state.jumpBoost > 0 ? Math.fround(0.1 * state.jumpBoost) : 0;
    const jumpVelocity = Math.fround(state.jumpStrength * state.jumpPendingScale * blockJumpFactor + jumpBoostPower);
    state.vel.y = Math.max(jumpVelocity, state.vel.y);
    state.isJumping = true;
    state.onGround = false;

    const { forward } = state.getTravelInput();
    if (forward > 0) {
      const notchianYaw = Math.PI - state.yaw;
      const sin = Math.sin(notchianYaw);
      const cos = Math.cos(notchianYaw);
      const impulse = Math.fround(FORWARD_JUMP_IMPULSE * state.jumpPendingScale);
      state.vel.x = Math.fround(state.vel.x - impulse * sin);
      state.vel.z = Math.fround(state.vel.z + impulse * cos);
    }

    state.jumpPendingScale = 0;
  }

  private travelInAir(simCtx: EPhysicsCtx, state: HorseState, strafe: number, forward: number, world: PhysicsWorld): void {
    const groundFriction = this.getGroundFriction(simCtx, state, world);
    const horizontalFriction = Math.fround(groundFriction * GROUND_FRICTION_MULTIPLIER);
    const acceleration = state.onGround
      ? Math.fround(state.movementSpeed * (FRICTION_INFLUENCED_SPEED_FACTOR / (groundFriction * groundFriction * groundFriction)))
      : Math.fround(state.movementSpeed * 0.1);

    this.applyHorseHeading(simCtx, strafe, forward, acceleration);
    this.moveEntity(simCtx, state.vel.x, state.vel.y, state.vel.z, world);

    let dy = state.vel.y;
    dy = Math.fround(dy - GRAVITY);
    state.vel.x = Math.fround(state.vel.x * horizontalFriction);
    state.vel.y = Math.fround(dy * VERTICAL_DRAG);
    state.vel.z = Math.fround(state.vel.z * horizontalFriction);

    if (!state.onGround && state.vel.y <= 0) {
      state.isJumping = false;
    }
    if (state.onGround) {
      state.isJumping = false;
      state.clearGroundJumpPending();
    }
  }

  private travelInFluid(simCtx: EPhysicsCtx, state: HorseState, strafe: number, forward: number, world: PhysicsWorld): void {
    const lastY = state.pos.y;
    this.applyHorseHeading(simCtx, strafe, forward, WATER_INPUT_ACCEL);
    this.moveEntity(simCtx, state.vel.x, state.vel.y, state.vel.z, world);

    let dy = state.vel.y;
    if (state.isInWater) {
      dy = Math.fround(dy - GRAVITY);
      state.vel.x = Math.fround(state.vel.x * WATER_SLOWDOWN);
      state.vel.y = Math.fround(dy * WATER_SLOWDOWN);
      state.vel.z = Math.fround(state.vel.z * WATER_SLOWDOWN);
    } else {
      dy = Math.fround(dy - GRAVITY / 4);
      state.vel.x = Math.fround(state.vel.x * 0.5);
      state.vel.y = Math.fround(dy * 0.5);
      state.vel.z = Math.fround(state.vel.z * 0.5);
    }

    if (
      state.isCollidedHorizontally &&
      this.doesNotCollide(simCtx, state.pos.offset(state.vel.x, 0.6 - state.pos.y + lastY, state.vel.z), world)
    ) {
      state.vel.y = Math.fround(0.3);
    }
  }

  private applyHorseHeading(simCtx: EPhysicsCtx, strafe: number, forward: number, acceleration: number): void {
    const state = simCtx.state as HorseState;
    const yaw = Math.PI - state.yaw;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const offsetX = Math.fround(strafe * cos - forward * sin);
    const offsetZ = Math.fround(forward * cos + strafe * sin);
    state.vel.x = Math.fround(state.vel.x + offsetX * acceleration);
    state.vel.z = Math.fround(state.vel.z + offsetZ * acceleration);
  }
}
