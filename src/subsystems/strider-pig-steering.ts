import { Vec3 } from "vec3";
// clamp is the stable shipped Mth.clamp equivalent (src/physics/info/math.ts).
import { clamp } from "../physics/info/math";

const f = Math.fround;

// ===========================================================================
// Mth.sin / Mth.cos — 65536-entry lookup tables.
// Vanilla uses these tables (NOT Math.sin) in getInputVector + boostFactor, so this
// must replicate the table to match vanilla bit-for-bit.
// ===========================================================================
const SIN_SCALE = 10430.378350470453;
const COS_OFFSET = 16384;
const SIN_TABLE: Float32Array = (() => {
  const t = new Float32Array(65536);
  for (let i = 0; i < t.length; i++) t[i] = f(Math.sin(i / SIN_SCALE));
  return t;
})();

export function mthSin(x: number): number {
  // Java long truncates toward zero (hence Math.trunc, not floor).
  const idx = (Math.trunc(x * SIN_SCALE) & 0xffff) >>> 0;
  return SIN_TABLE[idx];
}
export function mthCos(x: number): number {
  const idx = (Math.trunc(x * SIN_SCALE + COS_OFFSET) & 0xffff) >>> 0;
  return SIN_TABLE[idx];
}

// ===========================================================================
// CONSTANTS
// ===========================================================================

export const MIN_BOOST_TIME = 140;
export const MAX_BOOST_TIME = 700; // doc-only; real upper bound is 980 via the random range
export const BOOST_RAND_SPAN = 841; // random.nextInt(841) -> total in [140, 980]
const BOOST_FACTOR_AMPLITUDE = f(1.15); // boostFactor: 1.0 + 1.15*sin(...) -> peak 2.15

export const PIG_MOVEMENT_SPEED = 0.25; // base MOVEMENT_SPEED attribute
export const PIG_RIDDEN_MULT = 0.225; // getRiddenSpeed: attr * 0.225 * boostFactor

export const STRIDER_MOVEMENT_SPEED = f(0.175); // base MOVEMENT_SPEED attribute
export const STRIDER_STEER_WARM = f(0.55); // STEERING_MODIFIER
export const STRIDER_STEER_COLD = f(0.35); // SUFFOCATE_STEERING_MODIFIER
// SUFFOCATING_MODIFIER -0.34 (ADD_MULTIPLIED_BASE) -> attr *= (1 - 0.34) = 0.66 while present.
export const STRIDER_SUFFOCATING_DELTA = f(-0.34);
export const STRIDER_SUFFOCATING_MULT = f(1 + -0.34); // 0.66 effective attribute multiplier

// floatStrider (lava buoyancy): delta.scale(0.5).add(0, 0.05, 0)
export const STRIDER_LAVA_DAMP = 0.5;
export const STRIDER_LAVA_LIFT = 0.05;
// Raft pad max-Y in blocks (liquid collision shape spans y 0..0.5).
export const STRIDER_RAFT_SHAPE_MAX_Y = 0.5;
// isAbove: entityBottom > pos.getY() + shape.max(Y) - 1.0E-5
export const IS_ABOVE_EPS = 1.0e-5;

// Shared downstream constants (copied here, not imported).
const SPEED_NUM = f(0.21600002); // getFrictionInfluencedSpeed normalizer (= 0.6^3)
const GROUND_FRICTION_THRESHOLD = 0.6; // friction > 0.6 gate
const INPUT_LEN_CUTOFF = 1.0e-7; // getInputVector: lengthSqr < 1.0E-7 -> ZERO
const DEG_TO_RAD = f(Math.PI / 180.0);

// ===========================================================================
// ItemBasedSteering — the boost state machine.
// ===========================================================================

export interface SteeringState {
  boosting: boolean;
  boostTime: number;
  boostTimeTotal: number;
}

export function newSteeringState(): SteeringState {
  return { boosting: false, boostTime: 0, boostTimeTotal: 0 };
}

/**
 * boost(random). If already boosting -> false (re-trigger blocked, no durability cost
 * upstream). Else boosting=true, boostTime=0, boostTimeTotal = random.nextInt(841) + 140.
 *
 * @param nextInt841 the value of random.nextInt(841), an int in [0, 840].
 */
export function boostStart(st: SteeringState, nextInt841: number): boolean {
  if (st.boosting) return false;
  st.boosting = true;
  st.boostTime = 0;
  st.boostTimeTotal = (nextInt841 | 0) + MIN_BOOST_TIME;
  return true;
}

/**
 * tickBoost(): `if (boosting && boostTime++ > boostTimeTotal()) boosting=false;`
 * Post-increment: the COMPARISON uses the pre-increment value, THEN increments.
 * Consequence: a boost of total T runs T+1 ticks before stopping (off-by-one).
 */
export function tickBoost(st: SteeringState): void {
  if (st.boosting && st.boostTime++ > st.boostTimeTotal) st.boosting = false;
}

/**
 * boostFactor(): `boosting ? 1.0F + 1.15F * Mth.sin((float)boostTime/boostTimeTotal * PI) : 1.0F`.
 * Half-sine, peak 2.15x at the midpoint (boostTime = total/2), 1.0 at the ends.
 * NOTE all float math: (float)boostTime/boostTimeTotal, Mth.sin (table), 1.15F.
 */
export function boostFactor(st: SteeringState): number {
  if (!st.boosting) return 1.0;
  // float division
  const phase = f(f(st.boostTime) / st.boostTimeTotal);
  const arg = f(phase * f(Math.PI));
  return f(1.0 + f(BOOST_FACTOR_AMPLITUDE * mthSin(arg)));
}

// ===========================================================================
// Ridden speed formulas (the `speed` field set by getRiddenSpeed each tick).
// Both are computed in double then cast to float:  return (float)( ... ).
// ===========================================================================

/** getRiddenSpeed: (float)(attr * 0.225 * boostFactor()). */
export function pigRiddenSpeed(movementSpeedAttr: number, st: SteeringState): number {
  return f(movementSpeedAttr * PIG_RIDDEN_MULT * boostFactor(st));
}

/**
 * getRiddenSpeed: (float)(attr * (suffocating ? 0.35F : 0.55F) * boostFactor()).
 * The `attr` passed in MUST already include the suffocating attribute modifier (x0.66)
 * when cold — both penalties stack (see effectiveStriderMovementSpeed).
 */
export function striderRiddenSpeed(
  movementSpeedAttr: number,
  suffocating: boolean,
  st: SteeringState
): number {
  const mult = suffocating ? STRIDER_STEER_COLD : STRIDER_STEER_WARM;
  return f(movementSpeedAttr * mult * boostFactor(st));
}

/**
 * Effective Strider MOVEMENT_SPEED attribute value, applying the SUFFOCATING_MODIFIER
 * (-0.34, ADD_MULTIPLIED_BASE) when cold:  base * (1 - 0.34) = base * 0.66.
 * Pass the result into striderRiddenSpeed so the two cold penalties stack.
 */
export function effectiveStriderMovementSpeed(baseAttr: number, suffocating: boolean): number {
  return suffocating ? f(baseAttr * STRIDER_SUFFOCATING_MULT) : baseAttr;
}

// ===========================================================================
// getRiddenInput — fixed forward Vec3(0,0,1) for BOTH species.
//   The rider's WASD is ignored entirely; only yaw (look) and the boost item matter.
// ===========================================================================
export function getRiddenInput(): Vec3 {
  return new Vec3(0.0, 0.0, 1.0);
}

// ===========================================================================
// Shared downstream math.
// ===========================================================================

/**
 * getInputVector(input, speed, yRot): lengthSqr<1e-7 -> ZERO; normalize iff lengthSqr>1;
 * scale by speed; rotate by yaw using Mth.sin/Mth.cos. Returns the world-space delta to
 * ADD to velocity.
 */
export function getInputVector(input: Vec3, speed: number, yRotDeg: number): Vec3 {
  const len2 = input.x * input.x + input.y * input.y + input.z * input.z;
  if (len2 < INPUT_LEN_CUTOFF) return new Vec3(0, 0, 0);
  let mx = input.x,
    my = input.y,
    mz = input.z;
  if (len2 > 1.0) {
    const inv = 1.0 / Math.sqrt(len2); // input.normalize()
    mx *= inv;
    my *= inv;
    mz *= inv;
  }
  mx *= speed;
  my *= speed;
  mz *= speed;
  const rad = f(yRotDeg * DEG_TO_RAD);
  const sin = mthSin(rad);
  const cos = mthCos(rad);
  return new Vec3(mx * cos - mz * sin, my, mz * cos + mx * sin);
}

/**
 * moveRelative(speed, input): delta += getInputVector(input, speed, yRot). Returns the
 * new velocity.
 */
export function moveRelative(vel: Vec3, speed: number, input: Vec3, yRotDeg: number): Vec3 {
  const d = getInputVector(input, speed, yRotDeg);
  return new Vec3(vel.x + d.x, vel.y + d.y, vel.z + d.z);
}

/**
 * getFrictionInfluencedSpeed(blockFriction).
 * On ground: friction>0.6 ? speed * (0.21600002F / friction^3) : speed.
 * Off ground (player-controlled): getFlyingSpeed() = speed * 0.1F.
 * @param speed the `speed` field (= getRiddenSpeed output).
 */
export function getFrictionInfluencedSpeed(
  speed: number,
  blockFriction: number,
  onGround: boolean,
  playerControlled = true
): number {
  if (onGround) {
    if (blockFriction > GROUND_FRICTION_THRESHOLD) {
      // f32 throughout: 0.21600002F / (f*f*f), then speed *
      const fric3 = f(f(blockFriction * blockFriction) * blockFriction);
      return f(speed * f(SPEED_NUM / fric3));
    }
    return speed;
  }
  return playerControlled ? f(speed * f(0.1)) : f(0.02);
}

// ===========================================================================
// Strider lava buoyancy / surface detection.
// ===========================================================================

/**
 * isAbove(raft, blockPos, true): entityBottom > pos.getY() + shape.max(Y) - 1.0E-5.
 * With the strider raft shape (Block.column(16,0,8)) shape.max(Y) = 0.5.
 */
export function isAboveRaft(entityBottomY: number, blockY: number): boolean {
  return entityBottomY > blockY + STRIDER_RAFT_SHAPE_MAX_Y - IS_ABOVE_EPS;
}

export interface FloatStriderInput {
  isInLava: boolean;
  vel: Vec3; // current deltaMovement
  entityBottomY: number; // BB minY (feet)
  blockY: number; // blockPosition().getY()
  lavaAbove: boolean; // fluidAt(blockPos.above()).is(LAVA)
}
export interface FloatStriderResult {
  vel: Vec3;
  setOnGround: boolean; // true when surfaced (forced grounded)
}

/**
 * floatStrider().
 * If in lava:
 *   surfaced ( isAbove(raft) && !lavaAbove )  -> setOnGround(true), velocity unchanged
 *   else (submerged)                          -> delta = delta*0.5 + (0, +0.05, 0)
 * Horizontal velocity halves (heavy lava drag); a constant +0.05/tick lift raises
 * the raft to the surface (vertical fixed point = +0.1/tick: vy = vy*0.5 + 0.05).
 * Not in lava -> no-op.
 */
export function floatStrider(inp: FloatStriderInput): FloatStriderResult {
  if (!inp.isInLava) return { vel: inp.vel, setOnGround: false };
  const surfaced = isAboveRaft(inp.entityBottomY, inp.blockY) && !inp.lavaAbove;
  if (surfaced) {
    return { vel: inp.vel, setOnGround: true };
  }
  return {
    vel: new Vec3(
      inp.vel.x * STRIDER_LAVA_DAMP,
      inp.vel.y * STRIDER_LAVA_DAMP + STRIDER_LAVA_LIFT,
      inp.vel.z * STRIDER_LAVA_DAMP
    ),
    setOnGround: false,
  };
}

// ===========================================================================
// Strider warmth / suffocation.
// ===========================================================================
export interface WarmthInput {
  insideWarmBlock: boolean; // stateInside.is(STRIDER_WARM_BLOCKS)
  onWarmBlock: boolean; // stateOn.is(STRIDER_WARM_BLOCKS)
  lavaFluidHeight: number; // getFluidHeight(LAVA)
  onWarmStrider: boolean; // vehicle instanceof Strider && !vehicle.suffocating
}
/** suffocating = !inWarmBlocks && !onWarmStrider. */
export function computeStriderSuffocating(w: WarmthInput): boolean {
  const inWarmBlocks = w.insideWarmBlock || w.onWarmBlock || w.lavaFluidHeight > 0.0;
  return !inWarmBlocks && !w.onWarmStrider;
}

/**
 * canStandOnFluid(fluid): returns true only for LAVA (base LivingEntity returns false).
 * Effect: shouldTravelInFluid = (inWater||inLava) && affectedByFluids && !canStandOnFluid
 * is FALSE for a strider in lava -> it routes to ground/air travel (lava-walk).
 */
export function striderCanStandOnFluid(fluidIsLava: boolean): boolean {
  return fluidIsLava;
}

// ===========================================================================
// Per-tick ridden step — the orchestration.
//   riddenInput = getRiddenInput() = (0,0,1)
//   tickRidden:  snap mob yaw to rider yaw (pitch = rider.xRot*0.5), tickBoost()
//   setSpeed(getRiddenSpeed)
//   travel(riddenInput) -> travelInAir -> moveRelative(getFrictionInfluencedSpeed, input)
// We return the velocity AFTER the moveRelative acceleration is added (the rest of
// travelInAir — gravity, air-drag, friction-drag, move/collide — is the shared engine
// pipeline that the integration step plugs back into).
// ===========================================================================

export type Species = "pig" | "strider";

export interface RidddenStepInput {
  species: Species;
  vel: Vec3; // current deltaMovement
  riderYawDeg: number;
  riderPitchDeg: number;
  movementSpeedAttr: number; // MOVEMENT_SPEED attribute (BASE; suffocation applied here for strider)
  steering: SteeringState; // mutated: tickBoost advances it
  onGround: boolean;
  blockFriction: number; // friction of the block below (lava-walk: treat lava top as ground 0.6)
  suffocating?: boolean; // strider cold-shiver (default false)
}

export interface RiddenStepResult {
  vel: Vec3; // velocity after moveRelative acceleration
  mobYawDeg: number; // snapped to rider yaw
  mobPitchDeg: number; // rider pitch * 0.5
  speed: number; // the `speed` field set by getRiddenSpeed
}

/**
 * One ridden tick for a player-steered pig/strider, up to and including the
 * moveRelative acceleration. Mutates `steering` (tickBoost).
 */
export function tickRiddenSteerable(inp: RidddenStepInput): RiddenStepResult {
  // 1. tickRidden: snap mob rotation to rider
  const mobYawDeg = inp.riderYawDeg;
  const mobPitchDeg = f(inp.riderPitchDeg * 0.5);
  // 2. advance boost timer
  tickBoost(inp.steering);
  // 3. fixed forward input
  const input = getRiddenInput();
  // 4. species ridden speed -> the `speed` field
  let speed: number;
  if (inp.species === "pig") {
    speed = pigRiddenSpeed(inp.movementSpeedAttr, inp.steering);
  } else {
    const suff = inp.suffocating ?? false;
    const attr = effectiveStriderMovementSpeed(inp.movementSpeedAttr, suff);
    speed = striderRiddenSpeed(attr, suff, inp.steering);
  }
  // 5. travel -> travelInAir -> moveRelative(getFrictionInfluencedSpeed(friction), input)
  const accelSpeed = getFrictionInfluencedSpeed(speed, inp.blockFriction, inp.onGround, true);
  const vel = moveRelative(inp.vel, accelSpeed, input, mobYawDeg);
  return { vel, mobYawDeg, mobPitchDeg, speed };
}

// Re-export clamp so consumers of this subsystem have the shared Mth.clamp
// without re-importing it (keeps the public surface small).
export { clamp };
