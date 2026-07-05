import { Vec3 } from "vec3";

const f = Math.fround;
const DEG2RAD = Math.PI / 180.0;

// === Constants ===============================================================
/** Drives both the ridden-input scale and the travel speed. */
export const FLYING_SPEED = 0.05;
/** Ridden-input scale = 3.9F * FLYING_SPEED. 3.9 is a float literal, the attribute a
 *  double, so the product is the f32 3.9 times the double 0.05. */
export const RIDDEN_INPUT_SCALE = f(3.9) * FLYING_SPEED;
/** travel speed = (float)FLYING_SPEED * 5.0F / 3.0F, computed entirely in float. */
export const TRAVEL_SPEED = f((f(FLYING_SPEED) * 5.0) / 3.0);
/** Per-tick velocity damping, all 3 axes (air). */
export const AIR_DAMPING = 0.91;
/** Per-tick damping while in water. */
export const WATER_DAMPING = 0.8;
/** Per-tick damping while in lava. */
export const LAVA_DAMPING = 0.5;
/** Yaw easing per tick toward rider yaw. */
export const YAW_TURN = f(0.08);
/** Mount pitch = rider pitch * 0.5. */
export const MOUNT_PITCH_FACTOR = f(0.5);
/** Jump key vertical input add (lift). */
export const JUMP_LIFT = 0.5;
/** Backward (zza<0) thrust + vertical multiplier (reverse, half). */
export const BACK_MULT = -0.5;
/** getInputVector squared-length cutoff. */
export const INPUT_EPS = 1e-7;
/** canAddPassenger cap. */
export const MAX_PASSENGERS = 4;
/** Ticks the ghast freezes after passenger add/remove. */
export const MAX_STILL_TIMEOUT = 10;
/** tickCount before the still timeout begins counting down. */
export const STILL_TIMEOUT_ON_LOAD_GRACE_PERIOD = 60;

/** 4 passenger seat offsets (front, left, back, right).
 *  Y = 4.0 (top of the 4.0-tall body); ±1.7 around center; rotated by mount yaw. */
export const SEATS: ReadonlyArray<Readonly<{ x: number; y: number; z: number }>> = [
  { x: 0.0, y: 4.0, z: 1.7 }, // [0] front (controller seat)
  { x: -1.7, y: 4.0, z: 0.0 }, // [1] left
  { x: 0.0, y: 4.0, z: -1.7 }, // [2] back
  { x: 1.7, y: 4.0, z: 0.0 }, // [3] right
];

// === Helper primitives =======================================================

/** Normalize an angle into (-180, 180].
 *  (NOTE: the engine's util/mathUtil.wrapDegrees returns a radians-style value and is
 *  NOT equivalent; use this exact form here.) */
export function wrapDegrees(angle: number): number {
  let a = angle % 360;
  if (a >= 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

/** Normalize into (-45, 45]. Used to snap yaw to nearest 90° while on still-timeout. */
export function wrapDegrees90(angle: number): number {
  let a = angle % 90;
  if (a >= 45) a -= 90;
  if (a < -45) a += 90;
  return a;
}

/** Snap a yaw to the nearest multiple of 90° (still-timeout look control). */
export function snapYawTo90(yaw: number): number {
  return yaw - wrapDegrees90(yaw);
}

/** if |input|² < 1e-7 -> ZERO; if |input|² > 1 -> normalize first; scale by speed;
 *  rotate X/Z by yRot (deg), Y passes through unrotated. */
export function getInputVector(input: Vec3, speed: number, yRotDeg: number): Vec3 {
  const len2 = input.x * input.x + input.y * input.y + input.z * input.z;
  if (len2 < INPUT_EPS) return new Vec3(0, 0, 0);
  let mx = input.x;
  let my = input.y;
  let mz = input.z;
  if (len2 > 1.0) {
    const n = Math.sqrt(len2);
    mx /= n;
    my /= n;
    mz /= n;
  }
  mx *= speed;
  my *= speed;
  mz *= speed;
  // Mth.sin/cos use a lookup table; numerically equivalent to Math.sin/cos in float.
  const sin = f(Math.sin(f(yRotDeg * DEG2RAD)));
  const cos = f(Math.cos(f(yRotDeg * DEG2RAD)));
  return new Vec3(mx * cos - mz * sin, my, mz * cos + mx * sin);
}

/** Seat offset rotated by NEGATIVE mount yaw (local -> world): p.yRot(-rotY·π/180). */
export function transformSeat(p: { x: number; y: number; z: number }, mountYawDeg: number): Vec3 {
  const rad = -mountYawDeg * DEG2RAD;
  const s = Math.sin(rad);
  const c = Math.cos(rad);
  return new Vec3(p.x * c + p.z * s, p.y, p.z * c - p.x * s);
}

// === Rider / mount state ======================================================

/** The rider's per-tick control axes + look, as read by getRiddenInput.
 *  xxa = strafe (A/D), zza = forward (W/S) — the rider's raw axis values AFTER
 *  their own input decay. */
export interface GhastRiderInput {
  xxa: number; // strafe axis (left/right), -1..1
  zza: number; // forward axis (forward/back), -1..1
  /** rider XRot (pitch) in degrees; MC convention: + = looking down, − = looking up. */
  pitchDeg: number;
  /** rider YRot (yaw) in degrees; the mount eases toward this. */
  yawDeg: number;
  jumping: boolean;
}

/** Medium the ghast body currently occupies (selects the damping factor). */
export type GhastMedium = "air" | "water" | "lava";

/** A minimal mutable mount state for the ridden flight model. Position/velocity in
 *  blocks & blocks/tick; yaw/pitch in degrees. */
export interface GhastMountState {
  pos: Vec3;
  vel: Vec3;
  /** mount yaw (yRot), degrees. Eased toward the rider yaw each tick. */
  yawDeg: number;
  /** mount pitch (xRot), degrees. Set to rider pitch * 0.5 each ridden tick. */
  pitchDeg: number;
  /** medium for the damping branch (air default). */
  medium?: GhastMedium;
  /** server still-timeout counter (ticks). While >0 the rider cannot control. */
  serverStillTimeout?: number;
  /** synced "STAYS_STILL" flag (true forces still). */
  staysStill?: boolean;
  /** whether the ghast wears the Harness (BODY armor). Required to be controllable. */
  wearingHarness?: boolean;
  /** ticks the entity has existed (gates the grace period). */
  tickCount?: number;
}

// === Core control law =========================================================

/**
 * The flight control law. Returns the already-scaled impulse-direction vector (|v| ≤ ~0.35).
 */
export function getRiddenInput(rider: GhastRiderInput): Vec3 {
  const strafe = rider.xxa;
  let forward = 0.0;
  let up = 0.0;
  if (rider.zza !== 0.0) {
    const pr = f(rider.pitchDeg * DEG2RAD);
    let forwardLook = f(Math.cos(pr));
    let upLook = -f(Math.sin(pr));
    if (rider.zza < 0.0) {
      forwardLook *= BACK_MULT;
      upLook *= BACK_MULT;
    }
    up = upLook;
    forward = forwardLook;
  }
  if (rider.jumping) {
    up += JUMP_LIFT;
  }
  return new Vec3(strafe * RIDDEN_INPUT_SCALE, up * RIDDEN_INPUT_SCALE, forward * RIDDEN_INPUT_SCALE);
}

/** mount pitch = rider XRot * 0.5 ; mount target yaw = rider YRot. */
export function getRiddenRotation(rider: GhastRiderInput): { pitchDeg: number; targetYawDeg: number } {
  return { pitchDeg: f(rider.pitchDeg * MOUNT_PITCH_FACTOR), targetYawDeg: rider.yawDeg };
}

/**
 * Rotation easing: eases mount yaw 8%/tick toward rider yaw, sets pitch.
 * Mutates mount.yawDeg and mount.pitchDeg in place.
 */
export function tickRidden(mount: GhastMountState, rider: GhastRiderInput): void {
  const rotation = getRiddenRotation(rider);
  const diff = wrapDegrees(rotation.targetYawDeg - mount.yawDeg);
  mount.yawDeg = mount.yawDeg + diff * YAW_TURN;
  mount.pitchDeg = rotation.pitchDeg;
}

/** Pick the damping factor for the current medium. */
export function dampingFor(medium: GhastMedium | undefined): number {
  if (medium === "water") return WATER_DAMPING;
  if (medium === "lava") return LAVA_DAMPING;
  return AIR_DAMPING;
}

/** staysStill || serverStillTimeout > 0. While true the rider cannot control. */
export function isOnStillTimeout(mount: GhastMountState): boolean {
  return !!mount.staysStill || (mount.serverStillTimeout ?? 0) > 0;
}

/**
 * The rider drives the mount only if it wears the Harness AND is not on still-timeout.
 */
export function isControllable(mount: GhastMountState): boolean {
  // Default to harness-on when the field is omitted (caller is simulating a ride).
  const harness = mount.wearingHarness === undefined ? true : mount.wearingHarness;
  return harness && !isOnStillTimeout(mount);
}

/**
 * One ridden flight tick — the travelRidden -> travelFlying spine, MINUS the
 * world-collision move() (accepts an optional `move` callback so the module stays
 * collision-agnostic).
 *
 * If the mount is not controllable (still-timeout / no harness) the rider input is
 * IGNORED: no impulse is added, the body still damps, and yaw snaps toward 90°.
 *
 * @param move optional collision mover: (pos, vel) => newPos. Defaults to pos+vel
 *             (free-flight, no collision).
 * @returns the riddenInput used (for inspection/testing).
 */
export function tickRiddenFlight(
  mount: GhastMountState,
  rider: GhastRiderInput,
  move?: (pos: Vec3, vel: Vec3) => Vec3
): Vec3 {
  const speed = TRAVEL_SPEED;
  const damping = dampingFor(mount.medium);

  if (!isControllable(mount)) {
    // Frozen: ignore rider input. Snap yaw to nearest 90°, still apply damping to
    // bleed off any residual velocity.
    mount.yawDeg = snapYawTo90(mount.yawDeg);
    const movedFrozen = move ? move(mount.pos, mount.vel) : mount.pos.plus(mount.vel);
    mount.pos = movedFrozen;
    mount.vel = mount.vel.scaled(damping);
    return new Vec3(0, 0, 0);
  }

  // 1) build the flight impulse direction (pre-scaled by 0.195).
  const riddenInput = getRiddenInput(rider);

  // 2) tickRidden: ease mount yaw toward rider yaw, set mount pitch.
  tickRidden(mount, rider);

  // 3) moveRelative: add the yaw-rotated, speed-scaled impulse to velocity.
  const impulse = getInputVector(riddenInput, speed, mount.yawDeg);
  mount.vel = mount.vel.plus(impulse);

  // 4) move(SELF, vel): collide & translate (or free-flight pos += vel).
  const moved = move ? move(mount.pos, mount.vel) : mount.pos.plus(mount.vel);
  mount.pos = moved;

  // 5) damping on ALL three axes — NO gravity term.
  mount.vel = mount.vel.scaled(damping);

  return riddenInput;
}

/**
 * Seat placement for every passenger this tick. Seat index clamps to [0, 3]; the offset
 * rotates with the mount yaw; the rider's VEHICLE attachment is ~ZERO for a player so the
 * subtraction is omitted. Returns the world positions in passenger order.
 */
export function positionPassengers(mount: GhastMountState, passengerCount: number): Vec3[] {
  const out: Vec3[] = [];
  const n = SEATS.length;
  for (let i = 0; i < passengerCount; i++) {
    const seat = SEATS[Math.max(0, Math.min(i, n - 1))];
    const off = transformSeat(seat, mount.yawDeg);
    out.push(new Vec3(mount.pos.x + off.x, mount.pos.y + off.y, mount.pos.z + off.z));
  }
  return out;
}

/**
 * A small driver class wrapping the per-tick flight model for the engine dispatch.
 * Construct with an initial mount state; call `step(rider)` each tick.
 */
export class HappyGhastFlyingMount {
  state: GhastMountState;

  constructor(initial: GhastMountState) {
    this.state = initial;
  }

  /** Advance one ridden tick. Returns the riddenInput used. */
  step(rider: GhastRiderInput, move?: (pos: Vec3, vel: Vec3) => Vec3): Vec3 {
    return tickRiddenFlight(this.state, rider, move);
  }

  /** Seat world-positions for `count` passengers this tick. */
  seats(count: number): Vec3[] {
    return positionPassengers(this.state, count);
  }
}
