import { Vec3 } from "vec3";

const f = Math.fround;
const DEG2RAD = Math.PI / 180.0;

// === Constants ==============================================================
/** NAUTILUS_WATER_RESISTANCE — per-tick velocity damping (all axes) in the ridden
 *  water travel. */
export const WATER_RESISTANCE = 0.9;
/** RIDDEN_SPEED_MODIFIER_IN_WATER — moveRelative speed while in water. */
export const RIDDEN_SPEED_IN_WATER = f(0.0325);
/** RIDDEN_SPEED_MODIFIER_ON_LAND — moveRelative speed out of water. */
export const RIDDEN_SPEED_ON_LAND = f(0.02);
/** Base MOVEMENT_SPEED attribute for the nautilus. */
export const MOVEMENT_SPEED = 1.0;
/** DASH_COOLDOWN_TICKS — cooldown set after a dash. */
export const DASH_COOLDOWN_TICKS = 40;
/** DASH_MINIMUM_DURATION_TICKS — dash flag clears once cd < 35 (=40-5). */
export const DASH_MINIMUM_DURATION_TICKS = 5;
/** DASH_MOMENTUM_IN_WATER — look-vector dash scalar in water. */
export const DASH_MOMENTUM_IN_WATER = f(1.2);
/** DASH_MOMENTUM_ON_LAND — look-vector dash scalar on land. */
export const DASH_MOMENTUM_ON_LAND = f(0.5);
/** Mount yaw easing per tick toward the rider yaw (turnSpeed). */
export const YAW_TURN = f(0.5);
/** Mount pitch = rider pitch * 0.5. */
export const MOUNT_PITCH_FACTOR = f(0.5);
/** Backward (zza<0) forwardLook/upLook multiplier (reverse, half). */
export const BACK_MULT = f(-0.5);
/** getInputVector squared-length cutoff. */
export const INPUT_EPS = 1.0e-7;
/** Vec3.normalize zero-length cutoff. */
const NORMALIZE_EPS = f(1.0e-5);

// === Helper primitives ======================================================

/** Mth.wrapDegrees — normalize an angle into (-180, 180]. */
export function wrapDegrees(angle: number): number {
  let a = angle % 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** Vec3.normalize: dist<1e-5 -> ZERO. */
function normalize(v: Vec3): Vec3 {
  const dist = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return dist < NORMALIZE_EPS ? new Vec3(0, 0, 0) : new Vec3(v.x / dist, v.y / dist, v.z / dist);
}

/**
 * Entity.getInputVector:
 *  if |input|² < 1e-7 -> ZERO; if |input|² > 1 -> normalize first; scale by speed;
 *  rotate X/Z by yRot (deg), Y passes through unrotated.
 *
 *  The nautilus riddenInput is NOT pre-scaled, so |input|² CAN exceed 1 (e.g.
 *  strafe=1 + full forward -> |v|²=2) and the >1 normalize branch DOES fire — the
 *  impulse magnitude then saturates at `speed`.
 */
export function getInputVector(input: Vec3, speed: number, yRotDeg: number): Vec3 {
  const len2 = input.x * input.x + input.y * input.y + input.z * input.z;
  if (len2 < INPUT_EPS) return new Vec3(0, 0, 0);
  const base = len2 > 1.0 ? normalize(input) : input;
  const mx = base.x * speed;
  const my = base.y * speed;
  const mz = base.z * speed;
  // f64 Math.sin/cos (not vanilla's f32 Mth table) matches the engine's applyInputs for cross-parity.
  const rad = f(yRotDeg * DEG2RAD);
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  return new Vec3(mx * cos - mz * sin, my, mz * cos + mx * sin);
}

/**
 * Entity.calculateViewVector(xRot, yRot) — the unit facing vector from pitch (xRot)
 * + yaw (yRot); this is `getLookAngle()` with no head-vs-body distinction (all-f32).
 * The nautilus dash uses the CONTROLLER's (rider's) look angle for the dash direction.
 */
export function calculateViewVector(pitchDeg: number, yawDeg: number): Vec3 {
  const realX = f(pitchDeg * DEG2RAD);
  const realY = f(-yawDeg * DEG2RAD);
  const yCos = f(Math.cos(realY));
  const ySin = f(Math.sin(realY));
  const xCos = f(Math.cos(realX));
  const xSin = f(Math.sin(realX));
  return new Vec3(f(ySin * xCos), f(-xSin), f(yCos * xCos));
}

/** getPlayerJumpPendingScale(jumpAmount): jumpAmount in 0..100; >=90 -> 1.0,
 *  else 0.4 + 0.4*jumpAmount/90. */
export function getPlayerJumpPendingScale(jumpAmount: number): number {
  return jumpAmount >= 90 ? f(1.0) : f(f(0.4) + f(f(f(0.4) * jumpAmount) / f(90.0)));
}

// === Rider / mount state ======================================================

/** The rider's per-tick control axes + look, as read by getRiddenInput/dash. */
export interface NautilusRiderInput {
  /** controller.xxa — strafe axis (left/right), -1..1. */
  xxa: number;
  /** controller.zza — forward axis (forward/back), -1..1. */
  zza: number;
  /** rider XRot (pitch) degrees; MC convention: + = looking down, − = looking up. */
  pitchDeg: number;
  /** rider YRot (yaw) degrees; the mount eases toward this. */
  yawDeg: number;
  /** rider jump key held (LivingEntity.isJumping()) — the dash is triggered only
   *  when a pending scale exists AND the key is NOT currently held (edge). */
  jumping: boolean;
}

/** A minimal mutable mount state for the ridden nautilus water model. Position/
 *  velocity in blocks & blocks/tick; yaw/pitch in degrees. */
export interface NautilusMountState {
  pos: Vec3;
  vel: Vec3;
  /** mount yaw (yRot), degrees. Eased 0.5/tick toward the rider yaw. */
  yawDeg: number;
  /** mount pitch (xRot), degrees. Set to rider pitch * 0.5 each ridden tick. */
  pitchDeg: number;
  /** whether the nautilus body is in water (selects speed/damping/dash momentum). */
  inWater: boolean;
  /** whether the nautilus is saddled (gates canJump / onPlayerJump). */
  saddled: boolean;
  /** Block speedFactor under the mount (1.0 default; soul_sand 0.4). Dash scaler. */
  blockSpeedFactor: number;
  /** pending dash scale (0 = none). */
  playerJumpPendingScale: number;
  /** ticks remaining before the next dash is allowed. */
  dashCooldown: number;
  /** synced DASH flag. */
  dashing: boolean;
}

/** A convenience factory for a fresh ridden-nautilus state (in water, saddled). */
export function makeNautilusState(pos: Vec3 = new Vec3(0, 0, 0)): NautilusMountState {
  return {
    pos,
    vel: new Vec3(0, 0, 0),
    yawDeg: 0,
    pitchDeg: 0,
    inWater: true,
    saddled: true,
    blockSpeedFactor: 1.0,
    playerJumpPendingScale: 0,
    dashCooldown: 0,
    dashing: false,
  };
}

// === Core control law =========================================================

/**
 * AbstractNautilus.getRiddenInput:
 *
 *   strafe = controller.xxa
 *   forward = 0 ; up = 0
 *   if controller.zza != 0:
 *     forwardLook =  cos(XRot·π/180)
 *     upLook      = -sin(XRot·π/180)
 *     if controller.zza < 0:  forwardLook *= -0.5 ; upLook *= -0.5   (reverse, half)
 *     up = upLook ; forward = forwardLook
 *   return Vec3(strafe, up, forward)          // NOTE: UNSCALED
 *
 * Returns the raw mount-relative input Vec3 (X=strafe, Y=up, Z=forward). No jump-lift.
 */
export function getRiddenInput(rider: NautilusRiderInput): Vec3 {
  const strafe = rider.xxa;
  let forward = 0.0;
  let up = 0.0;
  if (rider.zza !== 0.0) {
    const pr = f(rider.pitchDeg * DEG2RAD);
    let forwardLook = f(Math.cos(pr));
    let upLook = -f(Math.sin(pr));
    if (rider.zza < 0.0) {
      forwardLook = f(forwardLook * BACK_MULT);
      upLook = f(upLook * BACK_MULT);
    }
    up = upLook;
    forward = forwardLook;
  }
  return new Vec3(strafe, up, forward);
}

/**
 * AbstractNautilus.getRiddenRotation: mount pitch = rider XRot * 0.5 ;
 * mount target yaw = rider YRot.
 */
export function getRiddenRotation(rider: NautilusRiderInput): { pitchDeg: number; targetYawDeg: number } {
  return { pitchDeg: f(rider.pitchDeg * MOUNT_PITCH_FACTOR), targetYawDeg: rider.yawDeg };
}

/**
 * AbstractNautilus.getRiddenSpeed:
 *   isInWater() ? 0.0325F * MOVEMENT_SPEED : 0.02F * MOVEMENT_SPEED.
 * Computed f32 (0.0325F/0.02F are floats, the attribute is cast to float).
 */
export function getRiddenSpeed(state: NautilusMountState): number {
  const base = state.inWater ? RIDDEN_SPEED_IN_WATER : RIDDEN_SPEED_ON_LAND;
  return f(base * f(MOVEMENT_SPEED));
}

/**
 * AbstractNautilus.executeRidersJump — the DASH.
 *   addDeltaMovement( controller.getLookAngle() *
 *     (isInWater ? 1.2F : 0.5F) * amount * MOVEMENT_SPEED * getBlockSpeedFactor() )
 *   dashCooldown = 40 ; setDashing(true).
 * ADDS to velocity (does NOT overwrite). The dash direction is the RIDER's full 3-D
 * look vector (can climb/dive). Mutates `state.vel`, `dashCooldown`, `dashing`.
 */
export function executeRidersJump(state: NautilusMountState, rider: NautilusRiderInput, amount: number): void {
  const look = calculateViewVector(rider.pitchDeg, rider.yawDeg);
  const momentum = state.inWater ? DASH_MOMENTUM_IN_WATER : DASH_MOMENTUM_ON_LAND;
  // Java eval order: (1.2F * amount) [float] * MOVEMENT_SPEED [double] * blockSpeedFactor [float->double].
  const factor = f(momentum * amount) * f(MOVEMENT_SPEED) * state.blockSpeedFactor;
  state.vel = new Vec3(state.vel.x + look.x * factor, state.vel.y + look.y * factor, state.vel.z + look.z * factor);
  state.dashCooldown = DASH_COOLDOWN_TICKS;
  state.dashing = true;
}

/**
 * AbstractNautilus.canJump — saddled.
 */
export function canJump(state: NautilusMountState): boolean {
  return state.saddled;
}

/**
 * AbstractNautilus.onPlayerJump:
 *   if saddled && dashCooldown <= 0: playerJumpPendingScale = getPlayerJumpPendingScale(jumpAmount).
 * Call when the client sends the ridden-jump packet (jumpAmount 0..100).
 */
export function onPlayerJump(state: NautilusMountState, jumpAmount: number): void {
  if (state.saddled && state.dashCooldown <= 0) {
    state.playerJumpPendingScale = getPlayerJumpPendingScale(jumpAmount);
  }
}

/**
 * AbstractNautilus.tickRidden rotation easing + dash trigger:
 *   diff = wrapDegrees(targetYaw - yRot)
 *   yRot += diff * 0.5F                         (50%/tick toward rider yaw)
 *   setRot(yRot, riderPitch*0.5)
 *   if authoritative && playerJumpPendingScale > 0 && !isJumping():
 *       executeRidersJump(playerJumpPendingScale, controller)   // adds dash to vel
 *   playerJumpPendingScale = 0
 * Mutates mount.yawDeg, mount.pitchDeg, and (on dash) mount.vel/dashCooldown/dashing.
 */
export function tickRidden(state: NautilusMountState, rider: NautilusRiderInput): void {
  const rotation = getRiddenRotation(rider);
  const diff = wrapDegrees(rotation.targetYawDeg - state.yawDeg);
  state.yawDeg = state.yawDeg + f(diff * YAW_TURN);
  state.pitchDeg = rotation.pitchDeg;
  // isLocalInstanceAuthoritative() — treat as true for the controlled mount.
  if (state.playerJumpPendingScale > 0.0 && !rider.jumping) {
    executeRidersJump(state, rider, state.playerJumpPendingScale);
  }
  state.playerJumpPendingScale = 0.0;
}

/**
 * One ridden WATER tick — the full LivingEntity.travelRidden -> travelInWater spine,
 * MINUS the world-collision move() (the engine's AABB mover owns that; an optional
 * `move` callback keeps the module collision-agnostic and self-contained).
 *
 *   riddenInput = getRiddenInput(rider)
 *   tickRidden(rider)                                  (ease yaw 0.5, set pitch, maybe DASH)
 *   speed = getRiddenSpeed()                           (0.0325F water / 0.02F land)
 *   travelInWater:
 *     moveRelative: vel += getInputVector(riddenInput, speed, mountYaw)
 *     move(SELF, vel)                                  (collide & translate; here pos += vel)
 *     vel *= 0.9                                        (NAUTILUS_WATER_RESISTANCE)
 *
 * The dash impulse (added in tickRidden) and the input impulse (added in
 * moveRelative) are BOTH in `vel` when move() runs, and BOTH get damped by 0.9 after
 * (executeRidersJump runs in tickRidden, before travel).
 *
 * @param move optional collision mover returning {pos, dx, dy, dz} (the collided
 *   displacement). On a blocked axis vanilla Entity.move zeroes that axis'
 *   deltaMovement BEFORE the 0.9 damping. Defaults to free water flight (pos += vel).
 * @returns the riddenInput used (for inspection/testing).
 */
export type NautilusMove = (pos: Vec3, vel: Vec3) => { pos: Vec3; dx: number; dy: number; dz: number };

export function tickRiddenWater(
  state: NautilusMountState,
  rider: NautilusRiderInput,
  move?: NautilusMove
): Vec3 {
  // 1) build the raw mount-relative input (strafe, upLook, forwardLook).
  const riddenInput = getRiddenInput(rider);

  // 2) tickRidden: ease mount yaw toward rider yaw, set pitch, maybe fire the dash.
  tickRidden(state, rider);

  // 3) getRiddenSpeed.
  const speed = getRiddenSpeed(state);

  // 4) travelInWater — moveRelative: add the yaw-rotated, speed-scaled impulse.
  const impulse = getInputVector(riddenInput, speed, state.yawDeg);
  state.vel = new Vec3(state.vel.x + impulse.x, state.vel.y + impulse.y, state.vel.z + impulse.z);

  // 5) move(SELF, vel): collide & translate (or free-flight pos += vel). On a blocked
  //    axis, vanilla Entity.move zeroes that axis' velocity BEFORE the damping scale.
  if (move) {
    const c = move(state.pos, state.vel);
    if (c.dx !== state.vel.x) state.vel = new Vec3(0, state.vel.y, state.vel.z);
    if (c.dy !== state.vel.y) state.vel = new Vec3(state.vel.x, 0, state.vel.z);
    if (c.dz !== state.vel.z) state.vel = new Vec3(state.vel.x, state.vel.y, 0);
    state.pos = c.pos;
  } else {
    state.pos = new Vec3(state.pos.x + state.vel.x, state.pos.y + state.vel.y, state.pos.z + state.vel.z);
  }

  // 6) damping on ALL three axes — NO gravity term (travelInWater override).
  state.vel = new Vec3(state.vel.x * WATER_RESISTANCE, state.vel.y * WATER_RESISTANCE, state.vel.z * WATER_RESISTANCE);

  return riddenInput;
}

/**
 * AbstractNautilus.tick dash/cooldown bookkeeping.
 * Call ONCE per game tick (independent of the ridden movement step):
 *   if isDashing() && dashCooldown < 35: setDashing(false)   (DASH_COOLDOWN - DASH_MINIMUM)
 *   if dashCooldown > 0: dashCooldown--                      (ready-sound at 0, omitted)
 * Mutates dashing / dashCooldown.
 */
export function nautilusTick(state: NautilusMountState): void {
  if (state.dashing && state.dashCooldown < DASH_COOLDOWN_TICKS - DASH_MINIMUM_DURATION_TICKS) {
    state.dashing = false;
  }
  if (state.dashCooldown > 0) {
    state.dashCooldown--;
  }
}

/**
 * A small driver class wrapping the per-tick ridden-water model for engine dispatch.
 * Construct with an initial mount state; call `step(rider)` each movement tick and
 * `tick()` each game tick (cooldown bookkeeping). `requestDash(jumpAmount)` mirrors
 * the client ridden-jump packet (onPlayerJump).
 */
export class NautilusRidingMount {
  state: NautilusMountState;

  constructor(initial: NautilusMountState = makeNautilusState()) {
    this.state = initial;
  }

  /** Advance one ridden water tick. Returns the riddenInput used. */
  step(rider: NautilusRiderInput, move?: NautilusMove): Vec3 {
    return tickRiddenWater(this.state, rider, move);
  }

  /** Game-tick cooldown/flag bookkeeping. */
  tick(): void {
    nautilusTick(this.state);
  }

  /** Client ridden-jump request -> pending dash scale. */
  requestDash(jumpAmount: number): void {
    onPlayerJump(this.state, jumpAmount);
  }

  /** Whether the mount can jump (saddled). */
  canJump(): boolean {
    return canJump(this.state);
  }
}
