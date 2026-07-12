import { AABB } from "@nxg-org/mineflayer-util-plugin";
import md from "minecraft-data";
import { Block } from "prismarine-block";
import { Vec3 } from "vec3";
import { EPhysicsCtx } from "../settings/entityPhysicsCtx";
import { BoatState, BoatStatus } from "../states/boatState";
import { IEntityState } from "../states";
import { EntityPhysics } from "./entityPhysics";

type PhysicsWorld = {
  getBlock(pos: Vec3): Block | null | undefined;
};

const GRAVITY = Math.fround(0.04);
const BUOYANCY_UNDER_WATER = Math.fround(0.01);
const FLOWING_WATER_VERTICAL = Math.fround(-0.0007);
const ROTATION_PER_TICK = Math.PI / 180;
const DEFAULT_BLOCK_FRICTION = 0.6;
const MAX_CONTROL_ACCELERATION = Math.fround(0.04);
const MAX_VERTICAL_MOTION = Math.fround(GRAVITY + BUOYANCY_UNDER_WATER + 0.101);

export class BoatPhysics extends EntityPhysics {
  constructor(mcData: md.IndexedData) {
    super(mcData);
  }

  simulate(simCtx: EPhysicsCtx, world: PhysicsWorld): IEntityState {
    if (!(simCtx.state instanceof BoatState)) {
      return super.simulate(simCtx, world);
    }

    const state = simCtx.state;
    if (!this.isWorldReady(simCtx, state, world)) {
      state.worldReady = false;
      return state;
    }

    state.worldReady = true;

    state.previousStatus = state.status;
    state.status = this.getStatus(simCtx, state, world);
    this.floatBoat(simCtx, state, world);
    this.controlBoat(state);
    state.lastVerticalVelocity = state.vel.y;

    this.moveEntity(simCtx, state.vel.x, state.vel.y, state.vel.z, world);
    state.age++;
    return state;
  }

  private getBoatBB(simCtx: EPhysicsCtx, state: BoatState): AABB {
    return this.getEntityBB(simCtx, state.pos);
  }

  private getWorldQueryBlockRange(simCtx: EPhysicsCtx, state: BoatState): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
  } {
    const bb = this.getBoatBB(simCtx, state);
    const sweepX = Math.abs(state.vel.x) + MAX_CONTROL_ACCELERATION;
    const sweepY = Math.max(Math.abs(state.vel.y), Math.abs(state.lastVerticalVelocity), MAX_VERTICAL_MOTION);
    const sweepZ = Math.abs(state.vel.z) + MAX_CONTROL_ACCELERATION;

    const sweptMinX = bb.minX - sweepX;
    const sweptMaxX = bb.maxX + sweepX;
    const sweptMinY = bb.minY - sweepY;
    const sweptMaxY = bb.maxY + sweepY + 0.001;
    const sweptMinZ = bb.minZ - sweepZ;
    const sweptMaxZ = bb.maxZ + sweepZ;

    return {
      minX: Math.floor(sweptMinX) - 1,
      maxX: Math.ceil(sweptMaxX) + 1,
      minY: Math.floor(sweptMinY) - 1,
      maxY: Math.max(
        Math.ceil(sweptMaxY) + 1,
        Math.ceil(bb.maxY - state.lastVerticalVelocity) + 1,
        Math.ceil(bb.maxY) + 1,
      ),
      minZ: Math.floor(sweptMinZ) - 1,
      maxZ: Math.ceil(sweptMaxZ) + 1,
    };
  }

  private isWorldReady(simCtx: EPhysicsCtx, state: BoatState, world: PhysicsWorld): boolean {
    const range = this.getWorldQueryBlockRange(simCtx, state);
    const cursor = new Vec3(0, 0, 0);

    for (cursor.y = range.minY; cursor.y <= range.maxY; cursor.y++) {
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

  private getStatus(simCtx: EPhysicsCtx, state: BoatState, world: PhysicsWorld): BoatStatus {
    const bb = this.getBoatBB(simCtx, state);
    const underwater = this.isUnderwater(bb, world);
    if (underwater != null) {
      state.waterLevel = bb.maxY;
      return underwater;
    }
    if (this.checkInWater(bb, state, world)) {
      return BoatStatus.IN_WATER;
    }
    const groundFriction = this.getGroundFriction(bb, world);
    if (groundFriction > 0) {
      state.landFriction = groundFriction;
      return BoatStatus.ON_LAND;
    }
    return BoatStatus.IN_AIR;
  }

  private isUnderwater(bb: AABB, world: PhysicsWorld): BoatStatus | null {
    const topY = bb.maxY + 0.001;
    const minX = Math.floor(bb.minX);
    const maxX = Math.ceil(bb.maxX);
    const minY = Math.floor(bb.maxY);
    const maxY = Math.ceil(topY);
    const minZ = Math.floor(bb.minZ);
    const maxZ = Math.ceil(bb.maxZ);
    let foundSource = false;
    const cursor = new Vec3(0, 0, 0);

    for (cursor.y = minY; cursor.y < maxY; cursor.y++) {
      for (cursor.x = minX; cursor.x < maxX; cursor.x++) {
        for (cursor.z = minZ; cursor.z < maxZ; cursor.z++) {
          const block = world.getBlock(cursor);
          if (!this.isWaterBlock(block)) continue;
          const fluidHeight = cursor.y + this.getFluidHeight(block, world, cursor);
          if (topY < fluidHeight) {
            if (!this.isSourceWater(block)) {
              return BoatStatus.UNDER_FLOWING_WATER;
            }
            foundSource = true;
          }
        }
      }
    }

    return foundSource ? BoatStatus.UNDER_WATER : null;
  }

  private checkInWater(bb: AABB, state: BoatState, world: PhysicsWorld): boolean {
    const minX = Math.floor(bb.minX);
    const maxX = Math.ceil(bb.maxX);
    const minY = Math.floor(bb.minY);
    const maxY = Math.ceil(bb.minY + 0.001);
    const minZ = Math.floor(bb.minZ);
    const maxZ = Math.ceil(bb.maxZ);
    let inWater = false;
    state.waterLevel = -Infinity;
    const cursor = new Vec3(0, 0, 0);

    for (cursor.x = minX; cursor.x < maxX; cursor.x++) {
      for (cursor.y = minY; cursor.y < maxY; cursor.y++) {
        for (cursor.z = minZ; cursor.z < maxZ; cursor.z++) {
          const block = world.getBlock(cursor);
          if (!this.isWaterBlock(block)) continue;
          const fluidHeight = cursor.y + this.getFluidHeight(block, world, cursor);
          state.waterLevel = Math.max(state.waterLevel, fluidHeight);
          inWater ||= bb.minY < fluidHeight;
        }
      }
    }

    return inWater;
  }

  private getWaterLevelAbove(bb: AABB, lastVerticalVelocity: number, world: PhysicsWorld): number {
    const minX = Math.floor(bb.minX);
    const maxX = Math.ceil(bb.maxX);
    const minY = Math.floor(bb.maxY);
    const maxY = Math.ceil(bb.maxY - lastVerticalVelocity);
    const minZ = Math.floor(bb.minZ);
    const maxZ = Math.ceil(bb.maxZ);
    const cursor = new Vec3(0, 0, 0);

    for (cursor.y = minY; cursor.y < maxY; cursor.y++) {
      let maxSliceHeight = 0;
      for (cursor.x = minX; cursor.x < maxX; cursor.x++) {
        for (cursor.z = minZ; cursor.z < maxZ; cursor.z++) {
          const block = world.getBlock(cursor);
          if (!this.isWaterBlock(block)) continue;
          maxSliceHeight = Math.max(maxSliceHeight, this.getFluidHeight(block, world, cursor));
          if (maxSliceHeight >= 1) break;
        }
        if (maxSliceHeight >= 1) break;
      }

      if (maxSliceHeight >= 1) continue;
      if (maxSliceHeight < 1) {
        return cursor.y + maxSliceHeight;
      }
    }

    return maxY + 1;
  }

  private getGroundFriction(bb: AABB, world: PhysicsWorld): number {
    const groundBB = new AABB(bb.minX, bb.minY - 0.001, bb.minZ, bb.maxX, bb.minY, bb.maxZ);
    const minX = Math.floor(groundBB.minX) - 1;
    const maxX = Math.ceil(groundBB.maxX) + 1;
    const minY = Math.floor(groundBB.minY) - 1;
    const maxY = Math.ceil(groundBB.maxY) + 1;
    const minZ = Math.floor(groundBB.minZ) - 1;
    const maxZ = Math.ceil(groundBB.maxZ) + 1;
    let frictionSum = 0;
    let count = 0;
    const cursor = new Vec3(0, 0, 0);

    for (cursor.x = minX; cursor.x < maxX; cursor.x++) {
      for (cursor.z = minZ; cursor.z < maxZ; cursor.z++) {
        const edgeX = cursor.x === minX || cursor.x === maxX - 1;
        const edgeZ = cursor.z === minZ || cursor.z === maxZ - 1;
        const edge = (edgeX ? 1 : 0) + (edgeZ ? 1 : 0);
        if (edge === 2) continue;

        for (cursor.y = minY; cursor.y < maxY; cursor.y++) {
          if (edge <= 0 || (cursor.y !== minY && cursor.y !== maxY - 1)) {
            const block = world.getBlock(cursor);
            if (!block || block.boundingBox === "empty") continue;
            if (block.name === "lily_pad") continue;
            const shapes = block.shapes;
            if (!shapes?.length) continue;
            for (const shape of shapes) {
              const blockBB = new AABB(shape[0], shape[1], shape[2], shape[3], shape[4], shape[5]);
              blockBB.translate(cursor.x, cursor.y, cursor.z);
              if (blockBB.intersects(groundBB)) {
                frictionSum += this.blockSlipperiness[block.type] ?? DEFAULT_BLOCK_FRICTION;
                count++;
              }
            }
          }
        }
      }
    }

    return count > 0 ? frictionSum / count : 0;
  }

  private isWaterBlock(block: Block | null | undefined): block is Block {
    if (!block) return false;
    return block.type === this.waterId || this.waterLike.has(block.type) || !!block.getProperties().waterlogged;
  }

  private isSameFluid(block: Block, other: Block | null | undefined): boolean {
    if (!other) return false;
    if (block.type === this.waterId) {
      return other.type === this.waterId || !!other.getProperties().waterlogged || this.waterLike.has(other.type);
    }
    if (block.getProperties().waterlogged) {
      return this.isWaterBlock(other);
    }
    if (this.waterLike.has(block.type)) {
      return block.type === other.type || this.isWaterBlock(other);
    }
    return false;
  }

  private isSourceWater(block: Block): boolean {
    if (block.getProperties().waterlogged) return true;
    if (this.waterLike.has(block.type)) return true;
    if (block.type !== this.waterId) return false;
    return Number(block.getProperties().level) === 0;
  }

  private getFluidHeight(block: Block, world: PhysicsWorld, pos: Vec3): number {
    const above = world.getBlock(pos.offset(0, 1, 0));
    if (this.isSameFluid(block, above)) {
      return 1;
    }
    if (block.getProperties().waterlogged || this.waterLike.has(block.type) || block.type === this.waterId) {
      return 1 - this.getLiquidHeightPcent(block);
    }
    return 0;
  }

  private floatBoat(simCtx: EPhysicsCtx, state: BoatState, world: PhysicsWorld): void {
    let gravity = -GRAVITY;
    let buoyancy = 0;
    let invFriction = Math.fround(0.05);

    if (
      state.previousStatus === BoatStatus.IN_AIR &&
      state.status !== BoatStatus.IN_AIR &&
      state.status !== BoatStatus.ON_LAND
    ) {
      const bb = this.getBoatBB(simCtx, state);
      const waterLevelAbove = this.getWaterLevelAbove(bb, state.lastVerticalVelocity, world);
      const targetY = waterLevelAbove - state.height + 0.101;
      const dy = targetY - state.pos.y;
      this.moveEntity(simCtx, 0, dy, 0, world);
      state.vel.y = 0;
      state.lastVerticalVelocity = 0;
      state.status = BoatStatus.IN_WATER;
      return;
    }

    switch (state.status) {
      case BoatStatus.IN_WATER:
        buoyancy = (state.waterLevel - state.pos.y) / state.height;
        invFriction = Math.fround(0.9);
        break;
      case BoatStatus.UNDER_FLOWING_WATER:
        gravity = FLOWING_WATER_VERTICAL;
        invFriction = Math.fround(0.9);
        break;
      case BoatStatus.UNDER_WATER:
        buoyancy = BUOYANCY_UNDER_WATER;
        invFriction = Math.fround(0.45);
        break;
      case BoatStatus.IN_AIR:
        invFriction = Math.fround(0.9);
        break;
      case BoatStatus.ON_LAND:
        invFriction = state.landFriction;
        break;
    }

    state.vel.x = Math.fround(state.vel.x * invFriction);
    state.vel.y = Math.fround(state.vel.y + gravity);
    state.vel.z = Math.fround(state.vel.z * invFriction);
    state.yawVelocity = Math.fround(state.yawVelocity * invFriction);

    if (buoyancy > 0) {
      state.vel.y = Math.fround((state.vel.y + buoyancy * (GRAVITY / 0.65)) * 0.75);
    }
  }

  private controlBoat(state: BoatState): void {
    const control = state.control;
    let acceleration = 0;

    if (control.left) {
      state.yawVelocity += ROTATION_PER_TICK;
    }
    if (control.right) {
      state.yawVelocity -= ROTATION_PER_TICK;
    }
    if (control.right !== control.left && !control.forward && !control.back) {
      acceleration += Math.fround(0.005);
    }

    state.yaw += state.yawVelocity;

    if (control.forward) {
      acceleration += Math.fround(0.04);
    }
    if (control.back) {
      acceleration -= Math.fround(0.005);
    }

    if (acceleration !== 0) {
      state.vel.x = Math.fround(state.vel.x + -Math.sin(state.yaw) * acceleration);
      state.vel.z = Math.fround(state.vel.z + -Math.cos(state.yaw) * acceleration);
    }
  }

  getPaddleState(state: BoatState): { leftPaddle: boolean; rightPaddle: boolean } {
    const { left, right, forward } = state.control;
    return {
      leftPaddle: (right && !left) || forward,
      rightPaddle: (left && !right) || forward,
    };
  }
}
