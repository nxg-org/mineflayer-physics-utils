import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import type { IPhysics } from "../engines";
import { ControlStateHandler } from "../player/playerControls";
import { EntityState } from "./entityState";
import * as attributes from "../info/attributes";

const DEFAULT_MOVEMENT_SPEED = Math.fround(0.225);
const DEFAULT_JUMP_STRENGTH = Math.fround(0.7);
const INPUT_SCALE = Math.fround(0.9800000190734863);
const STRAFE_SCALE = Math.fround(INPUT_SCALE * 0.5);
const BACKWARD_SCALE = Math.fround(0.25);

type AttributeProp = { value: number; modifiers: Array<{ uuid: string; operation: number; amount: number }> };

export type HorseJumpRelease = {
  released: boolean;
  jumpBoost: number;
};

export class HorseState extends EntityState {
  movementSpeed = DEFAULT_MOVEMENT_SPEED;
  jumpStrength = DEFAULT_JUMP_STRENGTH;

  jumpChargeTicks = 0;
  jumpChargeScale = 0;
  jumpPendingScale = 0;
  previousJumpInput = false;
  isJumping = false;
  allowStandSliding = false;
  saddled = false;

  worldReady = true;
  attributesReady = false;

  riderYaw = 0;
  riderPitch = 0;

  constructor(
    ctx: IPhysics,
    height: number,
    halfWidth: number,
    pos: Vec3,
    vel: Vec3,
    onGround: boolean,
    yaw: number,
    pitch: number,
    control: ControlStateHandler = ControlStateHandler.DEFAULT(),
  ) {
    super(ctx, height, halfWidth, pos, vel, onGround, yaw, pitch, control);
  }

  public static CREATE_FROM_ENTITY(
    ctx: IPhysics,
    entity: Entity,
    control: ControlStateHandler = ControlStateHandler.DEFAULT(),
  ): HorseState {
    const state = new HorseState(
      ctx,
      entity.height ?? 1.6,
      (entity.width ?? 1.3964844) / 2,
      entity.position.clone(),
      entity.velocity.clone(),
      entity.onGround ?? false,
      entity.yaw,
      entity.pitch,
      control.clone(),
    );
    state.updateFromHorseEntity(entity);
    return state;
  }

  public static getMovementSpeedFromAttributes(entityAttributes: Entity["attributes"] | undefined): number {
    const movementSpeedAttr = entityAttributes?.["generic.movement_speed"] as AttributeProp | undefined;
    if (!movementSpeedAttr) return DEFAULT_MOVEMENT_SPEED;
    return Math.fround(attributes.getAttributeValue(movementSpeedAttr));
  }

  public static getJumpStrengthFromAttributes(entityAttributes: Entity["attributes"] | undefined): number {
    const jumpStrengthAttr = entityAttributes?.["horse.jump_strength"] as AttributeProp | undefined;
    if (!jumpStrengthAttr) return DEFAULT_JUMP_STRENGTH;
    return Math.fround(attributes.getAttributeValue(jumpStrengthAttr));
  }

  public static getSaddledFromMetadata(entity: Entity): boolean {
    const flags = entity.metadata?.[17];
    if (typeof flags !== "number") return false;
    return (flags & 0x04) !== 0;
  }

  public updateFromHorseEntity(entity: Entity): HorseState {
    if (entity.attributes) {
      this.movementSpeed = HorseState.getMovementSpeedFromAttributes(entity.attributes);
      this.jumpStrength = HorseState.getJumpStrengthFromAttributes(entity.attributes);
      this.attributesReady = true;
    }
    this.saddled = HorseState.getSaddledFromMetadata(entity);
    return this;
  }

  public updateControls(control: ControlStateHandler, riderYaw: number, riderPitch: number): HorseState {
    this.control = control.clone();
    this.riderYaw = riderYaw;
    this.riderPitch = riderPitch;
    this.yaw = riderYaw;
    this.pitch = Math.fround(riderPitch * 0.5);
    return this;
  }

  public updateJumpCharge(jumpInput: boolean): HorseJumpRelease {
    const result: HorseJumpRelease = { released: false, jumpBoost: 0 };

    if (!jumpInput && this.previousJumpInput) {
      this.jumpPendingScale = this.computePendingJumpScale(this.jumpChargeScale);
      result.released = true;
      result.jumpBoost = Math.floor(this.jumpChargeScale * 100);
      this.jumpChargeTicks = -10;
    } else if (jumpInput && !this.previousJumpInput) {
      this.jumpChargeTicks = 0;
      this.jumpChargeScale = 0;
    } else if (jumpInput) {
      this.jumpChargeTicks++;
      this.jumpChargeScale = this.computeChargeScale(this.jumpChargeTicks);
    } else {
      this.jumpChargeScale = 0;
    }

    this.previousJumpInput = jumpInput;
    return result;
  }

  private computeChargeScale(ticks: number): number {
    if (ticks < 10) {
      return Math.fround(ticks * 0.1);
    }
    return Math.fround(0.8 + (2.0 / (ticks - 9)) * 0.1);
  }

  private computePendingJumpScale(chargeScale: number): number {
    const jumpBoost = Math.floor(chargeScale * 100);
    if (jumpBoost >= 90) {
      return Math.fround(1.0);
    }
    return Math.fround(0.4 + 0.4 * (jumpBoost / 90));
  }

  public getTravelInput(): { strafe: number; forward: number } {
    const control = this.control;
    const strafe = Math.fround(((control.left ? 1 : 0) - (control.right ? 1 : 0)) * STRAFE_SCALE);
    let forward = Math.fround(((control.forward ? 1 : 0) - (control.back ? 1 : 0)) * INPUT_SCALE);
    if (forward <= 0) {
      forward = Math.fround(forward * BACKWARD_SCALE);
    }
    return { strafe, forward };
  }

  public clearGroundJumpPending(): void {
    this.jumpPendingScale = 0;
  }

  public rebaseFromEntity(entity: Entity, options?: { replaceVelocity?: boolean }): HorseState {
    this.pos.set(entity.position.x, entity.position.y, entity.position.z);
    if (options?.replaceVelocity !== false) {
      this.vel.set(entity.velocity.x, entity.velocity.y, entity.velocity.z);
    }
    this.yaw = entity.yaw;
    this.pitch = entity.pitch;
    this.onGround = entity.onGround ?? false;
    const entityExtras = entity as Entity & {
      isCollidedHorizontally?: boolean;
      isCollidedVertically?: boolean;
    };
    this.isCollidedHorizontally = entityExtras.isCollidedHorizontally ?? false;
    this.isCollidedVertically = entityExtras.isCollidedVertically ?? false;
    this.updateFromHorseEntity(entity);
    return this;
  }

  public applyToEntity(entity: Entity) {
    entity.position.set(this.pos.x, this.pos.y, this.pos.z);
    entity.velocity.set(this.vel.x, this.vel.y, this.vel.z);
    entity.yaw = this.yaw;
    entity.pitch = this.pitch;
    entity.onGround = this.onGround;
    const entityExtras = entity as Entity & {
      isCollidedHorizontally?: boolean;
      isCollidedVertically?: boolean;
    };
    entityExtras.isCollidedHorizontally = this.isCollidedHorizontally;
    entityExtras.isCollidedVertically = this.isCollidedVertically;
    return this;
  }

  public clone(): HorseState {
    const other = new HorseState(
      this.ctx,
      this.height,
      this.halfWidth,
      this.pos.clone(),
      this.vel.clone(),
      this.onGround,
      this.yaw,
      this.pitch,
      this.control.clone(),
    );
    other.movementSpeed = this.movementSpeed;
    other.jumpStrength = this.jumpStrength;
    other.jumpChargeTicks = this.jumpChargeTicks;
    other.jumpChargeScale = this.jumpChargeScale;
    other.jumpPendingScale = this.jumpPendingScale;
    other.previousJumpInput = this.previousJumpInput;
    other.isJumping = this.isJumping;
    other.allowStandSliding = this.allowStandSliding;
    other.saddled = this.saddled;
    other.worldReady = this.worldReady;
    other.attributesReady = this.attributesReady;
    other.riderYaw = this.riderYaw;
    other.riderPitch = this.riderPitch;
    other.age = this.age;
    other.isCollidedHorizontally = this.isCollidedHorizontally;
    other.isCollidedVertically = this.isCollidedVertically;
    other.isInWater = this.isInWater;
    other.isInLava = this.isInLava;
    other.supportingBlockPos = this.supportingBlockPos?.clone() ?? null;
    other.jumpBoost = this.jumpBoost;
    return other;
  }
}
