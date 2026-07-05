import { Vec3 } from "vec3";
import { clamp } from "../physics/info/math"; // leaf helper: Math.max(min, Math.min(x, max))

/** Java f32 cast (store Java `float` constants/intermediates as f32). */
const f = Math.fround;
/** degrees->radians as an f32 constant. */
const DEG2RAD = f(Math.PI / 180.0);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const HORSE_SIDEWAYS_FACTOR = f(0.5);
export const HORSE_BACK_FACTOR = f(0.25);
export const HORSE_PITCH_FACTOR = f(0.5);
export const HORSE_JUMP_FWD_COEF = f(0.4);

/** Default horse base attributes. */
export const HORSE_ATTR = {
  MOVEMENT_SPEED: f(0.225),
  JUMP_STRENGTH: 0.7,
  STEP_HEIGHT: 1.0,
  MAX_HEALTH: 53.0,
} as const;

export const DASH_COOLDOWN_TICKS = 55;
export const DASH_VERTICAL_MOMENTUM = f(1.4285);
export const DASH_HORIZONTAL_MOMENTUM = f(22.2222);
/** dash flag clears once cd<50. */
export const DASH_MINIMUM_DURATION_TICKS = 5;
/** sprint bonus while dash off cooldown. */
export const CAMEL_RUNNING_SPEED_BONUS = f(0.1);
export const CAMEL_SITDOWN_TICKS = 40;
export const CAMEL_STANDUP_TICKS = 52;

/** Camel attributes. */
export const CAMEL_ATTR = {
  MOVEMENT_SPEED: f(0.09),
  JUMP_STRENGTH: f(0.42),
  STEP_HEIGHT: 1.5,
  MAX_HEALTH: 32.0,
} as const;

// Standard LivingEntity ground-travel constants (the path getRiddenSpeed->
// setSpeed->travel runs the impulses through).
/** friction-influenced speed normalizer. */
const FRICTION_SPEED_NORM = f(0.21600002);
/** Default block friction (grass/dirt/stone) = 0.6. */
const DEFAULT_FRICTION = f(0.6);
/** Base gravity 0.08 b/t^2. */
const BASE_GRAVITY = 0.08;
/** Air horizontal drag is `friction * 0.91` post-move. */
const AIR_DRAG = f(0.91);

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

function v3(x: number, y: number, z: number): Vec3 {
  return new Vec3(x, y, z);
}

/** normalize only if lenSqr>1, ZERO if lenSqr<1e-7, then rotate (x,z) by yaw. */
export function getInputVector(input: Vec3, speed: number, yawDeg: number): Vec3 {
  const lenSqr = input.x * input.x + input.y * input.y + input.z * input.z;
  if (lenSqr < 1.0e-7) return v3(0, 0, 0);
  let mx = input.x, my = input.y, mz = input.z;
  if (lenSqr > 1.0) {
    const inv = 1.0 / Math.sqrt(lenSqr); // Vec3.normalize
    mx *= inv; my *= inv; mz *= inv;
  }
  mx *= speed; my *= speed; mz *= speed;
  // native Math.sin/cos is within table-quantization tolerance of Mth.sin/cos (f32).
  const sin = f(Math.sin(yawDeg * DEG2RAD));
  const cos = f(Math.cos(yawDeg * DEG2RAD));
  return v3(mx * cos - mz * sin, my, mz * cos + mx * sin);
}

/** Unit facing vector from pitch (xRot) + yaw (yRot). */
export function calculateViewVector(pitchDeg: number, yawDeg: number): Vec3 {
  const realX = f(pitchDeg * DEG2RAD);
  const realY = f(-yawDeg * DEG2RAD);
  const yCos = f(Math.cos(realY));
  const ySin = f(Math.sin(realY));
  const xCos = f(Math.cos(realX));
  const xSin = f(Math.sin(realX));
  return v3(f(ySin * xCos), f(-xSin), f(yCos * xCos));
}

// ---------------------------------------------------------------------------
// Charge -> pending scale
// ---------------------------------------------------------------------------

/** jumpAmount in 0..100; >=90 -> 1.0, else 0.4 + 0.4*jumpAmount/90. */
export function getPlayerJumpPendingScale(jumpAmount: number): number {
  return jumpAmount >= 90 ? f(1.0) : f(f(0.4) + f(f(f(0.4) * jumpAmount) / f(90.0)));
}

/** Charge ramp (held jump): ticks<10 -> ticks*0.1; else 0.8 + 2/(ticks-9)*0.1. */
export function chargeRamp(jumpRidingTicks: number): number {
  if (jumpRidingTicks < 10) return f(jumpRidingTicks * f(0.1));
  return f(f(0.8) + f(f(f(2.0) / (jumpRidingTicks - 9)) * f(0.1)));
}

/** floor(scale*100) -> jumpAmount. */
export function chargeToJumpAmount(jumpRidingScale: number): number {
  return Math.floor(f(jumpRidingScale * f(100.0)));
}

// ---------------------------------------------------------------------------
// Rider input snapshot (what the controlling Player supplies each tick)
// ---------------------------------------------------------------------------

export interface RiderInput {
  /** strafe (-1 left / +1 right). */
  xxa: number;
  /** forward (+1) / backward (-1). */
  zza: number;
  /** rider yaw degrees. */
  yaw: number;
  /** rider pitch degrees. */
  pitch: number;
  /** rider sprint key state. camel sprint bonus. */
  sprinting: boolean;
  /** rider normal jump key held — guards executeRidersJump. */
  jumping: boolean;
}

// ---------------------------------------------------------------------------
// Block-context the species hooks query (feet/below jump+speed factors, jumpBoost)
// ---------------------------------------------------------------------------

export interface MountBlockCtx {
  /** Block jumpFactor at feet (1.0 default, honey 0.5). */
  jumpFactorHere: number;
  /** Block jumpFactor below (1.0 default, honey 0.5). */
  jumpFactorBelow: number;
  /** Block speedFactor at feet (1.0 default, soul_sand/honey 0.4). */
  speedFactorHere: number;
  /** Block speedFactor below. */
  speedFactorBelow: number;
  /** feet/below block friction for the standard ground travel (default 0.6). */
  blockFriction: number;
  /** Jump Boost effect amplifier (0-based), or null. */
  jumpBoostAmplifier: number | null;
}

export function defaultBlockCtx(): MountBlockCtx {
  return {
    jumpFactorHere: 1.0,
    jumpFactorBelow: 1.0,
    speedFactorHere: 1.0,
    speedFactorBelow: 1.0,
    blockFriction: DEFAULT_FRICTION,
    jumpBoostAmplifier: null,
  };
}

/** here==1.0 ? below : here. */
function blockJumpFactor(ctx: MountBlockCtx): number {
  return ctx.jumpFactorHere === 1.0 ? ctx.jumpFactorBelow : ctx.jumpFactorHere;
}

/** here==1.0 ? below : here (MOVEMENT_EFFICIENCY lerp toward 1 omitted:
 *  default attr 0 -> returns raw block speed factor). */
function blockSpeedFactor(ctx: MountBlockCtx): number {
  return ctx.speedFactorHere === 1.0 ? ctx.speedFactorBelow : ctx.speedFactorHere;
}

/** hasEffect(JUMP_BOOST) ? 0.1*(amp+1) : 0. */
function jumpBoostPower(ctx: MountBlockCtx): number {
  return ctx.jumpBoostAmplifier == null ? 0.0 : f(f(0.1) * (ctx.jumpBoostAmplifier + 1.0));
}

/** JUMP_STRENGTH * multiplier * blockJumpFactor + jumpBoost. All f32. */
function getJumpPower(jumpStrength: number, multiplier: number, ctx: MountBlockCtx): number {
  return f(f(f(jumpStrength) * multiplier * blockJumpFactor(ctx)) + jumpBoostPower(ctx));
}

// ---------------------------------------------------------------------------
// Base ridden mount
// ---------------------------------------------------------------------------

export abstract class RiddenMount {
  pos: Vec3 = v3(0, 0, 0);
  vel: Vec3 = v3(0, 0, 0);
  /** body/look yaw (degrees) — snapped to rider yaw in tickRidden. */
  yaw = 0;
  /** pitch (degrees) — set to rider.pitch*0.5 in tickRidden (horse). */
  pitch = 0;
  onGround = true;

  /** speed (set by setSpeed in travelRidden). */
  speed = 0;

  /** pending charged-jump scale (0 = none). */
  playerJumpPendingScale = 0;
  /** one-shot per rear (set on charge). */
  allowStandSliding = false;
  /** standing flag. */
  standing = false;

  /** Whether a saddle is equipped. */
  saddled = true;

  /** Per-tick block context (feet/below factors). */
  blockCtx: MountBlockCtx = defaultBlockCtx();

  abstract baseMovementSpeed(): number; // MOVEMENT_SPEED attr
  abstract jumpStrength(): number;       // JUMP_STRENGTH attr

  // --- species hooks (base = pass-through) ---

  /** getRiddenInput base — returns selfInput. Overridden per species. */
  getRiddenInput(rider: RiderInput, selfInput: Vec3): Vec3 {
    return selfInput;
  }
  /** getRiddenSpeed base — returns getSpeed(). Overridden per species. */
  getRiddenSpeed(rider: RiderInput): number {
    return this.speed;
  }
  /** getRiddenRotation — (pitch*0.5, yaw). Overridden by camel. */
  getRiddenRotation(rider: RiderInput): { pitch: number; yaw: number } {
    return { pitch: f(rider.pitch * HORSE_PITCH_FACTOR), yaw: rider.yaw };
  }

  /** executeRidersJump — overridden per species. */
  protected abstract executeRidersJump(amount: number, input: Vec3): void;

  /** tickRidden orchestration (rotation + charged-jump trigger).
   *  Camel adds a stand-up post-step (overridden). */
  tickRidden(rider: RiderInput, riddenInput: Vec3): void {
    const rot = this.getRiddenRotation(rider);
    this.yaw = rot.yaw;
    this.pitch = rot.pitch;
    // authoritative side (treat as always-true for the controlled mount):
    if (this.onGround) {
      if (this.playerJumpPendingScale > 0 && !rider.jumping) {
        this.executeRidersJump(this.playerJumpPendingScale, riddenInput);
      }
      this.playerJumpPendingScale = 0; // consumed only on ground
    }
  }

  /** Gate flow: client charges -> onPlayerJump sets pending. */
  onPlayerJump(jumpAmount: number): void {
    if (!this.saddled) return;
    if (jumpAmount < 0) jumpAmount = 0;
    else {
      this.allowStandSliding = true;
      // horse rears; camel canPerformRearing=false -> no-op.
      if (this.canPerformRearing()) this.standing = true;
    }
    this.playerJumpPendingScale = getPlayerJumpPendingScale(jumpAmount);
  }

  /** Horse: true; Camel: false. */
  canPerformRearing(): boolean {
    return true;
  }

  /** Species travel pre-hook — base = no horizontal cancel. */
  protected travelSpeciesPre(input: Vec3): Vec3 {
    return input;
  }

  /** Ground travel path used by travelRidden. Order: moveRelative(frictionInfluencedSpeed,
   *  input) -> integrate -> gravity -> horizontal drag. Reproduced here so jump/dash
   *  impulses flow into position correctly in isolation. */
  travel(input: Vec3): void {
    input = this.travelSpeciesPre(input);
    const friction = this.onGround ? this.blockCtx.blockFriction : f(1.0);
    // getFrictionInfluencedSpeed: ground & f>0.6 ->
    // speed*(0.21600002/f^3); off-ground -> flyingSpeed = speed*0.1 (player-controlled).
    let moveSpeed: number;
    if (this.onGround) {
      moveSpeed = friction > 0.6 ? f(this.speed * f(FRICTION_SPEED_NORM / f(friction * friction * friction))) : this.speed;
    } else {
      moveSpeed = f(this.speed * f(0.1)); // getFlyingSpeed (player-controlled)
    }
    // moveRelative: vel += getInputVector(input, moveSpeed, yaw)
    const delta = getInputVector(input, moveSpeed, this.yaw);
    this.vel = this.vel.offset(delta.x, delta.y, delta.z);
    this.pos = this.pos.offset(this.vel.x, this.vel.y, this.vel.z);
    this.vel.y -= BASE_GRAVITY;
    const hDrag = this.onGround ? f(friction * AIR_DRAG) : AIR_DRAG;
    this.vel.x = f(this.vel.x * hDrag);
    this.vel.z = f(this.vel.z * hDrag);
    this.vel.y = f(this.vel.y * f(0.98)); // vertical air drag 0.98
  }

  travelRidden(rider: RiderInput, selfInput: Vec3): void {
    const riddenInput = this.getRiddenInput(rider, selfInput);
    this.tickRidden(rider, riddenInput);
    // canSimulateMovement() — treat as true for the controlled mount.
    this.speed = this.getRiddenSpeed(rider);
    this.travel(riddenInput);
  }

  /** One full ridden step driven by a rider input (selfInput defaults to ZERO — a
   *  mob's own xxa/yya/zza is 0; the rider drives via getRiddenInput shaping). */
  step(rider: RiderInput): void {
    this.travelRidden(rider, v3(0, 0, 0));
  }
}

// ---------------------------------------------------------------------------
// Horse (AbstractHorse + Horse/Donkey/Mule/Skeleton/Zombie — inherited verbatim)
// ---------------------------------------------------------------------------

export class HorseMount extends RiddenMount {
  movementSpeed = HORSE_ATTR.MOVEMENT_SPEED;
  jumpStrengthAttr = HORSE_ATTR.JUMP_STRENGTH;

  baseMovementSpeed(): number {
    return this.movementSpeed;
  }
  jumpStrength(): number {
    return this.jumpStrengthAttr;
  }

  /** zero if standing&!sliding; else (xxa*0.5, 0, zza<=0?zza*0.25:zza). */
  getRiddenInput(rider: RiderInput, _selfInput: Vec3): Vec3 {
    if (this.onGround && this.playerJumpPendingScale === 0 && this.standing && !this.allowStandSliding) {
      return v3(0, 0, 0);
    }
    const sideways = f(rider.xxa * HORSE_SIDEWAYS_FACTOR);
    let forward = f(rider.zza);
    if (forward <= 0.0) forward = f(forward * HORSE_BACK_FACTOR);
    return v3(sideways, 0.0, forward);
  }

  /** getRiddenSpeed — MOVEMENT_SPEED attr. */
  getRiddenSpeed(_rider: RiderInput): number {
    return this.movementSpeed;
  }

  /** vel.y = getJumpPower(amount) (overwrite); if input.z>0 add 0.4*amount forward shove. */
  protected executeRidersJump(amount: number, input: Vec3): void {
    const impulse = getJumpPower(this.jumpStrengthAttr, amount, this.blockCtx);
    this.vel = v3(this.vel.x, impulse, this.vel.z); // OVERWRITE y
    if (input.z > 0.0) {
      const sin = f(Math.sin(f(this.yaw * DEG2RAD)));
      const cos = f(Math.cos(f(this.yaw * DEG2RAD)));
      this.vel = this.vel.offset(f(f(-0.4) * sin * amount), 0.0, f(f(0.4) * cos * amount));
    }
  }
}

// ---------------------------------------------------------------------------
// Camel (extends AbstractHorse; dash, sitting, sprint bonus)
// ---------------------------------------------------------------------------

export class CamelMount extends RiddenMount {
  movementSpeed = CAMEL_ATTR.MOVEMENT_SPEED;
  jumpStrengthAttr = CAMEL_ATTR.JUMP_STRENGTH;

  /** dashCooldown — starts 0, set 55 on dash. */
  dashCooldown = 0;
  /** DASH synced flag. */
  dashing = false;
  /** LAST_POSE_CHANGE_TICK (signed): <0 => sitting. Modeled via sitting flag +
   *  poseTime for the pose-transition window. */
  sitting = false;
  /** ticks elapsed in the current pose — drives isInPoseTransition. */
  poseTime = 9999;
  /** Whether this camel is currently in liquid (for the dash-flag clear gate). */
  inLiquid = false;
  /** Whether this camel is itself a passenger (dash-flag clear gate). */
  isPassenger = false;

  baseMovementSpeed(): number {
    return this.movementSpeed;
  }
  jumpStrength(): number {
    return this.jumpStrengthAttr;
  }

  /** getJumpCooldown — returns dashCooldown. */
  getJumpCooldown(): number {
    return this.dashCooldown;
  }

  /** isCamelSitting — LAST_POSE_CHANGE_TICK < 0. */
  isCamelSitting(): boolean {
    return this.sitting;
  }

  /** isInPoseTransition — poseTime < (sitting?40:52). */
  isInPoseTransition(): boolean {
    return this.poseTime < (this.sitting ? CAMEL_SITDOWN_TICKS : CAMEL_STANDUP_TICKS);
  }

  /** refuseToMove — sitting || inPoseTransition. */
  refuseToMove(): boolean {
    return this.isCamelSitting() || this.isInPoseTransition();
  }

  /** canPerformRearing — false (dash has no visual rear). */
  canPerformRearing(): boolean {
    return false;
  }

  /** canJump — !refuseToMove && super(saddled). */
  canJump(): boolean {
    return !this.refuseToMove() && this.saddled;
  }

  /** onPlayerJump — gated saddled && cd<=0 && onGround. */
  onPlayerJump(jumpAmount: number): void {
    if (this.saddled && this.dashCooldown <= 0 && this.onGround) {
      super.onPlayerJump(jumpAmount);
    }
  }

  /** getRiddenInput — ZERO if refuseToMove, else horse shaping. */
  getRiddenInput(rider: RiderInput, _selfInput: Vec3): Vec3 {
    if (this.refuseToMove()) return v3(0, 0, 0);
    // super = horse shaping (standing path can't apply: camel never rears)
    if (this.onGround && this.playerJumpPendingScale === 0 && this.standing && !this.allowStandSliding) {
      return v3(0, 0, 0);
    }
    const sideways = f(rider.xxa * HORSE_SIDEWAYS_FACTOR);
    let forward = f(rider.zza);
    if (forward <= 0.0) forward = f(forward * HORSE_BACK_FACTOR);
    return v3(sideways, 0.0, forward);
  }

  /** getRiddenSpeed — MS + (sprint && cd==0 ? 0.1 : 0). */
  getRiddenSpeed(rider: RiderInput): number {
    const bonus = rider.sprinting && this.getJumpCooldown() === 0 ? CAMEL_RUNNING_SPEED_BONUS : f(0.0);
    return f(this.movementSpeed + bonus);
  }

  /** getRiddenRotation — frozen if refuseToMove, else horse. */
  getRiddenRotation(rider: RiderInput): { pitch: number; yaw: number } {
    if (this.refuseToMove()) return { pitch: this.pitch, yaw: this.yaw };
    return { pitch: f(rider.pitch * HORSE_PITCH_FACTOR), yaw: rider.yaw };
  }

  /** travel pre-hook — zero horizontal delta+input if refuseToMove&&onGround. */
  protected travelSpeciesPre(input: Vec3): Vec3 {
    if (this.refuseToMove() && this.onGround) {
      this.vel = v3(0.0, this.vel.y, 0.0);
      return v3(0.0, input.y, 0.0);
    }
    return input;
  }

  /** tickRidden — super, then stand up if pushed forward. */
  tickRidden(rider: RiderInput, riddenInput: Vec3): void {
    super.tickRidden(rider, riddenInput);
    if (rider.zza > 0.0 && this.isCamelSitting() && !this.isInPoseTransition()) {
      this.standUp();
    }
  }

  /** standUp — clears sitting; pose transition begins (poseTime 0). */
  standUp(): void {
    if (this.isCamelSitting()) {
      this.sitting = false;
      this.poseTime = 0;
    }
  }

  /** The DASH.
   *  horiz = lookXZ.normalize() * 22.2222 * amount * MOVEMENT_SPEED * blockSpeedFactor
   *  vert  = 1.4285 * amount * getJumpPower()   (getJumpPower no-arg => multiplier 1.0)
   *  addDeltaMovement(horiz + (0,vert,0)); dashCooldown=55; setDashing(true). */
  protected executeRidersJump(amount: number, _input: Vec3): void {
    const jumpMomentum = getJumpPower(this.jumpStrengthAttr, 1.0, this.blockCtx); // no-arg => mult 1
    // horizontal look direction, normalized
    const look = calculateViewVector(this.pitch, this.yaw);
    let hx = look.x, hz = look.z; // y flattened
    const hLen = Math.sqrt(hx * hx + hz * hz);
    if (hLen > 0) {
      hx /= hLen;
      hz /= hLen;
    }
    const horizMag = f(f(f(DASH_HORIZONTAL_MOMENTUM * amount) * this.movementSpeed) * blockSpeedFactor(this.blockCtx));
    const dashX = hx * horizMag;
    const dashZ = hz * horizMag;
    const dashY = f(f(DASH_VERTICAL_MOMENTUM * amount) * jumpMomentum);
    this.vel = this.vel.offset(dashX, dashY, dashZ); // addDeltaMovement (ADD, not overwrite)
    this.dashCooldown = DASH_COOLDOWN_TICKS;
    this.dashing = true;
  }

  /** Camel cooldown/pose bookkeeping. Call ONCE per game tick (before/independent of the
   *  ridden movement step). */
  camelTick(): void {
    // dash-flag clear once cooldown counts below 50 and grounded/liquid/passenger
    if (this.dashing && this.dashCooldown < 50 && (this.onGround || this.inLiquid || this.isPassenger)) {
      this.dashing = false;
    }
    if (this.dashCooldown > 0) this.dashCooldown--; // ready-sound at 0 (omitted)
    // sitting-in-water forces instant stand
    if (this.isCamelSitting() && this.inLiquid) {
      this.sitting = false;
      this.poseTime = CAMEL_STANDUP_TICKS; // full-stand (isInPoseTransition false)
    }
    if (this.poseTime < CAMEL_STANDUP_TICKS) this.poseTime++;
  }

  /** Begin sitting down: poseTime resets, sitting flag set. */
  sitDown(): void {
    if (!this.isCamelSitting()) {
      this.sitting = true;
      this.poseTime = 0;
    }
  }
}

// re-export the clamp we depend on (so consumers/tests can reuse the same leaf helper)
export { clamp };
