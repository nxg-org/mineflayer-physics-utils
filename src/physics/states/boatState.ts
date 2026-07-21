import type { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import type { IPhysics } from "../engines";
import { ControlStateHandler } from "../player/playerControls";
import { EntityState } from "./entityState";

export enum BoatStatus {
  IN_WATER,
  UNDER_WATER,
  UNDER_FLOWING_WATER,
  ON_LAND,
  IN_AIR,
}

export class BoatState extends EntityState {
  status: BoatStatus = BoatStatus.IN_AIR;
  previousStatus: BoatStatus = BoatStatus.IN_AIR;

  waterLevel = -Infinity;
  landFriction = 0;
  yawVelocity = 0;
  lastVerticalVelocity = 0;
  controllingPlayer = false;

  worldReady = true;

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
  ): BoatState {
    return new BoatState(
      ctx,
      entity.height ?? 0.5625,
      (entity.width ?? 1.375) / 2,
      entity.position.clone(),
      entity.velocity.clone(),
      entity.onGround ?? false,
      entity.yaw,
      entity.pitch,
      control.clone(),
    );
  }

  public updateControls(control: ControlStateHandler): BoatState {
    this.control = control.clone();
    return this;
  }

  public rebaseFromEntity(entity: Entity, options?: { replaceVelocity?: boolean }): BoatState {
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

  public clone(): BoatState {
    const other = new BoatState(
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
    other.status = this.status;
    other.previousStatus = this.previousStatus;
    other.waterLevel = this.waterLevel;
    other.landFriction = this.landFriction;
    other.yawVelocity = this.yawVelocity;
    other.lastVerticalVelocity = this.lastVerticalVelocity;
    other.controllingPlayer = this.controllingPlayer;
    other.worldReady = this.worldReady;
    other.age = this.age;
    other.isCollidedHorizontally = this.isCollidedHorizontally;
    other.isCollidedVertically = this.isCollidedVertically;
    return other;
  }
}
