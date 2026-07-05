import { clamp } from "../physics/info/math";

// ---------------------------------------------------------------------------
// Vec3 — minimal immutable port of Minecraft's Vec3.
// Only the methods the propulsion pipeline uses.
// ---------------------------------------------------------------------------

export class V3 {
  constructor(public readonly x: number, public readonly y: number, public readonly z: number) {}

  static readonly ZERO = new V3(0, 0, 0);

  add(x: number, y: number, z: number): V3 {
    return new V3(this.x + x, this.y + y, this.z + z);
  }
  addV(o: V3): V3 {
    return new V3(this.x + o.x, this.y + o.y, this.z + o.z);
  }
  subtract(o: V3): V3 {
    return new V3(this.x - o.x, this.y - o.y, this.z - o.z);
  }
  /** Vec3.multiply(ax,ay,az) */
  multiply(ax: number, ay: number, az: number): V3 {
    return new V3(this.x * ax, this.y * ay, this.z * az);
  }
  /** Vec3.scale(s) */
  scale(s: number): V3 {
    return this.multiply(s, s, s);
  }
  /** Vec3.horizontal() = (x,0,z) */
  horizontal(): V3 {
    return new V3(this.x, 0, this.z);
  }
  /** Vec3.dot(v) */
  dot(o: V3): number {
    return this.x * o.x + this.y * o.y + this.z * o.z;
  }
  /** Vec3.length() */
  length(): number {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  /** Vec3.lengthSqr() */
  lengthSqr(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  /** Vec3.horizontalDistance() */
  horizontalDistance(): number {
    return Math.sqrt(this.x * this.x + this.z * this.z);
  }
  /** Vec3.horizontalDistanceSqr() */
  horizontalDistanceSqr(): number {
    return this.x * this.x + this.z * this.z;
  }
  /** Vec3.normalize() — dist<1e-5 → ZERO. */
  normalize(): V3 {
    const d = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    return d < 1.0e-5 ? V3.ZERO : new V3(this.x / d, this.y / d, this.z / d);
  }
  /** Vec3.projectedOn(onto) */
  projectedOn(onto: V3): V3 {
    const ls = onto.lengthSqr();
    return ls === 0 ? onto : onto.scale(this.dot(onto) / ls);
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** AbstractMinecart.getDefaultGravity */
export const GRAVITY_LAND = 0.04;
export const GRAVITY_WATER = 0.005;
/** AbstractMinecart.getAirDrag (Entity default 0.98) */
export const AIR_DRAG = 0.95;
/** WATER_SLOWDOWN_FACTOR */
export const WATER_SLOWDOWN = 0.95;

// OLD behavior
export const OLD_SLOWDOWN_EMPTY = 0.96;
export const OLD_SLOWDOWN_RIDDEN = 0.997;
export const OLD_MAX_SPEED_LAND = 0.4;
export const OLD_MAX_SPEED_WATER = 0.2;
export const OLD_SLOPE_ACCEL = 0.0078125; // (1/128)
export const SLOPE_ENERGY_COEFF = 0.05; // (oldY-newY)*0.05
export const REPROJECT_CAP = 2.0; // min(2.0, speed)

// NEW behavior
export const NEW_SLOWDOWN_EMPTY = 0.975;
export const NEW_SLOWDOWN_RIDDEN = 0.997;
export const NEW_ON_RAIL_Y_OFFSET = 0.1;
export const NEW_OPPOSING_SLOPES_REST = 0.005;
/** GameRules.MAX_MINECART_SPEED default (range 1..1000) */
export const MAX_MINECART_SPEED_DEFAULT = 8;

// Shared rail propulsion constants
export const SLOPE_WATER_SCALE = 0.2;
export const POWERED_BOOST = 0.06;
export const OLD_KICKSTART = 0.02;
export const NEW_KICKSTART = 0.2;
export const BRAKE_FACTOR = 0.5;
export const BRAKE_STOP_THRESHOLD = 0.03;
export const PLAYER_INPUT_NUDGE = 0.001;
export const RIDDEN_MOVE_SCALE = 0.75;

// Furnace
export const FURNACE_FUEL_PER_ITEM = 3600;
export const FURNACE_MAX_FUEL = 32000;
export const FURNACE_FRICTION_FUELED = 0.8;
export const FURNACE_FRICTION_UNFUELED = 0.98;
export const FURNACE_WATER_SCALE = 0.1;
export const FURNACE_MAXSPEED_LAND = 0.5; // (×super)
export const FURNACE_MAXSPEED_WATER = 0.75; // (×super)

/** Mth.SQRT_OF_TWO = sqrt(2.0f) as a Java float */
export const SQRT_OF_TWO: number = Math.fround(Math.sqrt(2.0));

// ---------------------------------------------------------------------------
// Rail shapes + EXITS geometry
// ---------------------------------------------------------------------------

export type RailShape =
  | "north_south"
  | "east_west"
  | "ascending_east"
  | "ascending_west"
  | "ascending_north"
  | "ascending_south"
  | "south_east"
  | "south_west"
  | "north_west"
  | "north_east";

/** Pair of endpoint unit offsets (Vec3i) per rail shape */
export const EXITS: Record<RailShape, [readonly [number, number, number], readonly [number, number, number]]> = {
  north_south: [[0, 0, -1], [0, 0, 1]],
  east_west: [[-1, 0, 0], [1, 0, 0]],
  ascending_east: [[-1, -1, 0], [1, 0, 0]],
  ascending_west: [[-1, 0, 0], [1, -1, 0]],
  ascending_north: [[0, 0, -1], [0, -1, 1]],
  ascending_south: [[0, -1, -1], [0, 0, 1]],
  south_east: [[0, 0, 1], [1, 0, 0]],
  south_west: [[0, 0, 1], [-1, 0, 0]],
  north_west: [[0, 0, -1], [-1, 0, 0]],
  north_east: [[0, 0, -1], [1, 0, 0]],
};

/** RailShape.isSlope() — true for the 4 ASCENDING_* */
export function isSlope(shape: RailShape): boolean {
  return shape.startsWith("ascending_");
}

export type RailKind = "rail" | "powered_rail" | "detector_rail" | "activator_rail";
const RAILS: ReadonlySet<RailKind> = new Set<RailKind>(["rail", "powered_rail", "detector_rail", "activator_rail"]);
export function isRail(kind: string | null | undefined): boolean {
  return kind != null && RAILS.has(kind as RailKind);
}

// ---------------------------------------------------------------------------
// Cart state — the minimal per-cart momentum state the propulsion model needs.
// pos & delta are blocks / blocks-per-tick. The caller supplies the rail
// context each tick (block kind/shape/powered + occupancy) because that comes
// from the world, not from this subsystem.
// ---------------------------------------------------------------------------

export interface RailCtx {
  /** block kind at getCurrentBlockPosOrRailBelow, or null if off-rail */
  kind: RailKind | null;
  /** rail shape (only meaningful when on a rail) */
  shape: RailShape;
  /** POWERED state of a powered/activator rail (PoweredRailBlock.POWERED) */
  powered: boolean;
  /** integer block coords of the rail block (getCurrentBlockPosOrRailBelow) */
  blockX: number;
  blockY: number;
  blockZ: number;
}

export interface CartState {
  x: number;
  y: number;
  z: number;
  /** previous-tick position (xo/zo), used for yaw + slope-energy oldPos */
  xo: number;
  zo: number;
  vx: number;
  vy: number;
  vz: number;
  inWater: boolean;
  onGround: boolean;
  /** has a passenger (isVehicle()) — toggles ride scale + slowdown factor */
  ridden: boolean;
  /** is this cart rideable (Minecart) — affects ride scale gate */
  rideable: boolean;
}

function delta(s: CartState): V3 {
  return new V3(s.vx, s.vy, s.vz);
}
function setDelta(s: CartState, v: V3): void {
  s.vx = v.x;
  s.vy = v.y;
  s.vz = v.z;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** AbstractMinecart.applyGravity — adds -gravity to dy. */
export function applyGravity(s: CartState): void {
  const g = s.inWater ? GRAVITY_WATER : GRAVITY_LAND;
  s.vy -= g;
}

/**
 * AbstractMinecart.applyNaturalSlowdown.
 *   m = movement.multiply(f,0,f); if inWater m = m.scale(0.95)
 * (Furnace overrides this — see applyFurnaceSlowdown.)
 */
export function applyNaturalSlowdown(v: V3, ridden: boolean, inWater: boolean, behavior: "old" | "new"): V3 {
  const f =
    behavior === "old"
      ? ridden
        ? OLD_SLOWDOWN_RIDDEN
        : OLD_SLOWDOWN_EMPTY
      : ridden
        ? NEW_SLOWDOWN_RIDDEN
        : NEW_SLOWDOWN_EMPTY;
  let m = v.multiply(f, 0, f);
  if (inWater) m = m.scale(WATER_SLOWDOWN);
  return m;
}

/** OLD getMaxSpeed (per-axis clamp value). */
export function oldMaxSpeed(inWater: boolean): number {
  return inWater ? OLD_MAX_SPEED_WATER : OLD_MAX_SPEED_LAND;
}

/**
 * NEW getMaxSpeed.
 *   gamerule * (inWater?0.5:1) / 20    (vector-length clamp, applied elsewhere).
 */
export function newMaxSpeed(inWater: boolean, maxMinecartSpeedRule = MAX_MINECART_SPEED_DEFAULT): number {
  return (maxMinecartSpeedRule * (inWater ? 0.5 : 1.0)) / 20.0;
}

/**
 * AbstractMinecart.comeOffTrack — shared off-rail mover for BOTH behaviors.
 * NOTE: gravity was already applied this tick.
 *   clamp x/z per-axis to ±maxSpeed; if onGround scale 0.5; move; if !onGround scale airDrag.
 * This routine mutates the cart's velocity AND advances pos by the (final)
 * velocity (the engine's collision-aware move() — here a free move; the real
 * engine resolves collisions, which only reduces the step).
 */
export function comeOffTrack(s: CartState, maxSpeed: number): void {
  let v = delta(s);
  v = new V3(clamp(-maxSpeed, v.x, maxSpeed), v.y, clamp(-maxSpeed, v.z, maxSpeed));
  setDelta(s, v);
  if (s.onGround) {
    setDelta(s, delta(s).scale(0.5));
  }
  // move(SELF, delta) — free move (collision resolution is the engine's job)
  v = delta(s);
  s.x += v.x;
  s.y += v.y;
  s.z += v.z;
  if (!s.onGround) {
    setDelta(s, delta(s).scale(AIR_DRAG));
  }
}

// ---------------------------------------------------------------------------
// OLD behavior — OldMinecartBehavior.moveAlongTrack
// Full ordered pipeline. Returns nothing; mutates s in place.
//
// The geometric rail-snap (steps 7,8,10,11) repositions the cart on the rail
// centerline and applies the move()+clamp. We reproduce the velocity transforms
// exactly; for position we follow the source's setPos / move calls.
// ---------------------------------------------------------------------------

export function oldMoveAlongTrack(s: CartState, rail: RailCtx, maxSpeed: number): void {
  const pos = { x: rail.blockX, y: rail.blockY, z: rail.blockZ };
  const oldY = s.y; // oldPos.y proxy for slope-energy (source uses getPos(...).y)
  let x = s.x;
  let y: number = pos.y;
  let z = s.z;
  const shape = rail.shape;

  // step 2 — powered/halt flags
  let powerTrack = false;
  let haltTrack = false;
  if (rail.kind === "powered_rail") {
    powerTrack = rail.powered;
    haltTrack = !powerTrack;
  }

  // step 3 — slope slide
  let slideSpeed = OLD_SLOPE_ACCEL;
  if (s.inWater) slideSpeed *= SLOPE_WATER_SCALE;
  let movement = delta(s);
  switch (shape) {
    case "ascending_east":
      movement = movement.add(-slideSpeed, 0, 0);
      y++;
      break;
    case "ascending_west":
      movement = movement.add(slideSpeed, 0, 0);
      y++;
      break;
    case "ascending_north":
      movement = movement.add(0, 0, slideSpeed);
      y++;
      break;
    case "ascending_south":
      movement = movement.add(0, 0, -slideSpeed);
      y++;
      break;
    default:
      break;
  }
  setDelta(s, movement);

  // step 4 — re-project velocity onto rail direction
  movement = delta(s);
  const [exit0, exit1] = EXITS[shape];
  let xD = exit1[0] - exit0[0];
  let zD = exit1[2] - exit0[2];
  const length = Math.sqrt(xD * xD + zD * zD);
  const flip = movement.x * xD + movement.z * zD;
  if (flip < 0) {
    xD = -xD;
    zD = -zD;
  }
  const pow = Math.min(REPROJECT_CAP, movement.horizontalDistance());
  movement = new V3((pow * xD) / length, movement.y, (pow * zD) / length);
  setDelta(s, movement);

  // step 5 — player input nudge. moveIntent is supplied via s.ridden + caller;
  // for a bot-observed cart we only need the gate that matters for propulsion:
  // if no rider, this branch is skipped entirely. (Rider input is an external
  // force; we expose it through driveOldTick's moveIntent param instead — see
  // oldMoveAlongTrackWithIntent.)

  // step 6 — halt/brake on unpowered powered-rail
  if (haltTrack) {
    const speedLength = delta(s).horizontalDistance();
    if (speedLength < BRAKE_STOP_THRESHOLD) {
      setDelta(s, V3.ZERO);
    } else {
      setDelta(s, delta(s).multiply(BRAKE_FACTOR, 0, BRAKE_FACTOR));
    }
  }

  // step 7 — snap XZ onto the rail centerline
  const x0 = pos.x + 0.5 + exit0[0] * 0.5;
  const z0 = pos.z + 0.5 + exit0[2] * 0.5;
  const x1 = pos.x + 0.5 + exit1[0] * 0.5;
  const z1 = pos.z + 0.5 + exit1[2] * 0.5;
  const xDe = x1 - x0;
  const zDe = z1 - z0;
  let progress: number;
  if (xDe === 0) {
    progress = z - pos.z;
  } else if (zDe === 0) {
    progress = x - pos.x;
  } else {
    const xx = x - x0;
    const zz = z - z0;
    progress = (xx * xDe + zz * zDe) * 2.0;
  }
  x = x0 + xDe * progress;
  z = z0 + zDe * progress;
  s.x = x;
  s.y = y;
  s.z = z;

  // step 8 — move + per-axis clamp
  const scale = s.ridden ? RIDDEN_MOVE_SCALE : 1.0;
  movement = delta(s);
  const moveX = clamp(-maxSpeed, scale * movement.x, maxSpeed);
  const moveZ = clamp(-maxSpeed, scale * movement.z, maxSpeed);
  // move(SELF,(moveX,0,moveZ)) — free move (collision is the engine's job)
  s.x += moveX;
  s.z += moveZ;
  // ascending-exit Y bump
  const fx = Math.floor(s.x);
  const fz = Math.floor(s.z);
  if (exit0[1] !== 0 && fx - pos.x === exit0[0] && fz - pos.z === exit0[2]) {
    s.y += exit0[1];
  } else if (exit1[1] !== 0 && fx - pos.x === exit1[0] && fz - pos.z === exit1[2]) {
    s.y += exit1[1];
  }

  // step 9 — natural slowdown
  setDelta(s, applyNaturalSlowdown(delta(s), s.ridden, s.inWater, "old"));

  // step 10 — slope-energy correction
  // newPos.y proxy = s.y (post-move). speed = (oldY - newY)*0.05.
  {
    const newY = s.y;
    const speed = (oldY - newY) * SLOPE_ENERGY_COEFF;
    const v = delta(s);
    const otherPow = v.horizontalDistance();
    if (otherPow > 0) {
      const f = (otherPow + speed) / otherPow;
      setDelta(s, v.multiply(f, 1.0, f));
    }
    s.y = newY;
  }

  // step 11 — corner exit redirection
  {
    const xn = Math.floor(s.x);
    const zn = Math.floor(s.z);
    if (xn !== pos.x || zn !== pos.z) {
      const v = delta(s);
      const otherPow = v.horizontalDistance();
      setDelta(s, new V3(otherPow * (xn - pos.x), v.y, otherPow * (zn - pos.z)));
    }
  }

  // step 12 — powered-rail BOOST / kickstart
  if (powerTrack) {
    const v = delta(s);
    const speedLength = v.horizontalDistance();
    if (speedLength > 0.01) {
      setDelta(s, v.add((v.x / speedLength) * POWERED_BOOST, 0, (v.z / speedLength) * POWERED_BOOST));
    }
    // else: kickstart from a redstone-conductor side (±0.02) — requires world
    // neighbor probing the caller must supply; left to oldPoweredKickstart().
  }
}

/**
 * OLD powered-rail kickstart from a dead stop. Caller supplies which
 * axis-neighbor block is a redstone conductor. Mutates the cart's horizontal
 * velocity. Only valid when on a POWERED+lit straight rail with
 * horizontalDistance(delta) <= 0.01.
 */
export function oldPoweredKickstart(
  s: CartState,
  shape: RailShape,
  conductor: { west?: boolean; east?: boolean; north?: boolean; south?: boolean }
): void {
  const v = delta(s);
  let dx = v.x;
  let dz = v.z;
  if (shape === "east_west") {
    if (conductor.west) dx = OLD_KICKSTART;
    else if (conductor.east) dx = -OLD_KICKSTART;
  } else if (shape === "north_south") {
    if (conductor.north) dz = OLD_KICKSTART;
    else if (conductor.south) dz = -OLD_KICKSTART;
  } else {
    return; // only EAST_WEST / NORTH_SOUTH kickstart
  }
  setDelta(s, new V3(dx, v.y, dz));
}

// ---------------------------------------------------------------------------
// NEW behavior — calculateTrackSpeed ordered force pipeline.
// Implemented as the per-tick velocity transform for the FIRST iteration (the
// propulsion model). The geometric sub-stepping (stepAlongTrack) is position
// bookkeeping; the propulsion forces — slope, player input, halt,
// naturalSlowdown+clamp, boost — are here.
// ---------------------------------------------------------------------------

/** NEW slope speed — max(0.0078125, hSpeed*0.02), ×0.2 water. */
export function newCalculateSlopeSpeed(v: V3, shape: RailShape, inWater: boolean): V3 {
  let slideSpeed = Math.max(OLD_SLOPE_ACCEL, v.horizontalDistance() * 0.02);
  if (inWater) slideSpeed *= SLOPE_WATER_SCALE;
  switch (shape) {
    case "ascending_east":
      return v.add(-slideSpeed, 0, 0);
    case "ascending_west":
      return v.add(slideSpeed, 0, 0);
    case "ascending_north":
      return v.add(0, 0, slideSpeed);
    case "ascending_south":
      return v.add(0, 0, -slideSpeed);
    default:
      return v;
  }
}

/** NEW halt/brake — POWERED_RAIL && !POWERED. */
export function newCalculateHaltTrackSpeed(v: V3, rail: RailCtx): V3 {
  if (rail.kind === "powered_rail" && !rail.powered) {
    return v.length() < BRAKE_STOP_THRESHOLD ? V3.ZERO : v.scale(BRAKE_FACTOR);
  }
  return v;
}

/**
 * NEW boost — POWERED_RAIL && POWERED.
 *   if len>0.01: normalize.scale(len+0.06)
 *   else: kickstart via redstoneDirection -> dir.scale(len+0.2)  (dir.lengthSqr<=0 -> unchanged)
 * redstoneDirection is a world probe; caller supplies it (or null/ZERO).
 */
export function newCalculateBoostTrackSpeed(v: V3, rail: RailCtx, redstoneDirection: V3 = V3.ZERO): V3 {
  if (rail.kind === "powered_rail" && rail.powered) {
    if (v.length() > 0.01) {
      return v.normalize().scale(v.length() + POWERED_BOOST);
    }
    return redstoneDirection.lengthSqr() <= 0 ? v : redstoneDirection.scale(v.length() + NEW_KICKSTART);
  }
  return v;
}

/**
 * NEW calculateTrackSpeed (first iteration).
 * Ordered gates: slope → playerInput → halt → naturalSlowdown+lengthClamp → boost.
 * The input `v` should be initialStepDeltaMovement.horizontal().
 *
 * `playerInput`: if a ServerPlayer is the first passenger, moveIntent.lengthSqr>0
 * and own horizontalDistanceSqr<0.01, add normalize(moveIntent_h)*0.001. Pass
 * moveIntent (already yaw-rotated unit vector) or null. Setting it suppresses the
 * halt gate (hasHalted=true).
 */
export function newCalculateTrackSpeed(
  v: V3,
  rail: RailCtx,
  opts: {
    inWater: boolean;
    ridden: boolean;
    maxSpeed: number;
    moveIntent?: V3 | null;
    redstoneDirection?: V3;
  }
): V3 {
  let nd = v;
  let hasHalted = false;

  // 1. slope (one-shot)
  const sloped = newCalculateSlopeSpeed(nd, rail.shape, opts.inWater);
  if (sloped.horizontalDistanceSqr() !== nd.horizontalDistanceSqr()) {
    nd = sloped;
  }

  // 2. player input (firstIteration)
  if (opts.moveIntent && opts.moveIntent.lengthSqr() > 0) {
    const riderMovement = opts.moveIntent.normalize();
    const ownDist = nd.horizontalDistanceSqr();
    if (riderMovement.lengthSqr() > 0 && ownDist < 0.01) {
      const nudged = nd.addV(new V3(riderMovement.x, 0, riderMovement.z).normalize().scale(PLAYER_INPUT_NUDGE));
      if (nudged.horizontalDistanceSqr() !== nd.horizontalDistanceSqr()) {
        hasHalted = true;
        nd = nudged;
      }
    }
  }

  // 3. halt/brake
  if (!hasHalted) {
    const halted = newCalculateHaltTrackSpeed(nd, rail);
    if (halted.horizontalDistanceSqr() !== nd.horizontalDistanceSqr()) {
      hasHalted = true;
      nd = halted;
    }
  }

  // 4. natural slowdown + length clamp (firstIteration)
  nd = applyNaturalSlowdown(nd, opts.ridden, opts.inWater, "new");
  if (nd.lengthSqr() > 0) {
    const speed = Math.min(nd.length(), opts.maxSpeed);
    nd = nd.normalize().scale(speed);
  }

  // 5. boost (one-shot)
  const boosted = newCalculateBoostTrackSpeed(nd, rail, opts.redstoneDirection ?? V3.ZERO);
  if (boosted.horizontalDistanceSqr() !== nd.horizontalDistanceSqr()) {
    nd = boosted;
  }

  return nd;
}

// ---------------------------------------------------------------------------
// Furnace self-propulsion — MinecartFurnace
// ---------------------------------------------------------------------------

export interface FurnaceState {
  /** remaining fuel in ticks */
  fuel: number;
  /** push vector (x,z only); set on fuel; re-aimed each tick along motion */
  push: V3;
}

/** addFuel — interactingPos = the fueler's position. */
export function furnaceAddFuel(
  f: FurnaceState,
  cartPos: V3,
  interactingPos: V3,
  isFuelItem: boolean
): boolean {
  if (isFuelItem && f.fuel + FURNACE_FUEL_PER_ITEM <= FURNACE_MAX_FUEL) {
    f.fuel += FURNACE_FUEL_PER_ITEM;
    if (f.fuel > 0) {
      f.push = cartPos.subtract(interactingPos).horizontal();
    }
    return true;
  }
  return false;
}

/** Fuel burn — MinecartFurnace.tick (server branch). Returns hasFuel. */
export function furnaceBurnTick(f: FurnaceState): boolean {
  if (f.fuel > 0) f.fuel--;
  if (f.fuel <= 0) f.push = V3.ZERO;
  return f.fuel > 0;
}

/** calculateNewPushAlong — re-aim push parallel to motion. */
export function furnaceCalculateNewPushAlong(push: V3, deltaMovement: V3): V3 {
  if (push.horizontalDistanceSqr() > 1.0e-4 && deltaMovement.horizontalDistanceSqr() > 0.001) {
    return push.projectedOn(deltaMovement).normalize().scale(push.length());
  }
  return push;
}

/**
 * MinecartFurnace.applyNaturalSlowdown override.
 * REPLACES the base natural slowdown, then chains super.applyNaturalSlowdown.
 *   if push.lengthSqr>1e-7: push = calculateNewPushAlong(d);
 *       newDelta = d.multiply(0.8,0,0.8).add(push); if inWater newDelta*=0.1
 *   else: newDelta = d.multiply(0.98,0,0.98)
 *   return super.applyNaturalSlowdown(newDelta)
 * Mutates f.push. Returns the post-slowdown delta.
 */
export function applyFurnaceSlowdown(f: FurnaceState, d: V3, ridden: boolean, inWater: boolean, behavior: "old" | "new"): V3 {
  let newDelta: V3;
  if (f.push.lengthSqr() > 1.0e-7) {
    f.push = furnaceCalculateNewPushAlong(f.push, d);
    newDelta = d.multiply(FURNACE_FRICTION_FUELED, 0, FURNACE_FRICTION_FUELED).addV(f.push);
    if (inWater) newDelta = newDelta.scale(FURNACE_WATER_SCALE);
  } else {
    newDelta = d.multiply(FURNACE_FRICTION_UNFUELED, 0, FURNACE_FRICTION_UNFUELED);
  }
  return applyNaturalSlowdown(newDelta, ridden, inWater, behavior);
}

/** Furnace getMaxSpeed — super × (water?0.75:0.5). */
export function furnaceMaxSpeed(superMaxSpeed: number, inWater: boolean): number {
  return superMaxSpeed * (inWater ? FURNACE_MAXSPEED_WATER : FURNACE_MAXSPEED_LAND);
}

// ---------------------------------------------------------------------------
// Entity-vs-entity push (the "walking player shoves the cart" force)
// ---------------------------------------------------------------------------

/**
 * Generic Entity.push(other) impulse. The shove a walking entity (a Player)
 * imparts to the cart. Returns the impulse to ADD to the OTHER entity's
 * deltaMovement (push(d,d,d) just adds).
 *   xa=other.x-this.x; za=other.z-this.z; dd=absMax(xa,za); if dd<0.01 -> 0
 *   dd=sqrt(dd); xa/=dd; za/=dd; pow=min(1,1/dd); xa*=pow; za*=pow; xa*=0.05; za*=0.05
 */
export function entityPushImpulse(fromX: number, fromZ: number, toX: number, toZ: number): { xa: number; za: number } {
  let xa = toX - fromX;
  let za = toZ - fromZ;
  // Mth.absMax(xa,za) — the operand with the larger absolute value
  let dd = Math.abs(xa) >= Math.abs(za) ? xa : za;
  dd = Math.abs(dd);
  if (dd < 0.01) return { xa: 0, za: 0 };
  dd = Math.sqrt(dd); // NOTE: sqrt of the absMax, not the distance
  xa /= dd;
  za /= dd;
  const pow = Math.min(1.0, 1.0 / dd);
  return { xa: xa * pow * 0.05, za: za * pow * 0.05 };
}

/**
 * Minecart's own push(other) override.
 * Net per-axis 0.1*0.5 = 0.05 before the /4. Returns {cart, other}: the cart
 * recoils by (-xa,-za); a NON-cart other gets (xa/4, za/4). (Cart-cart goes
 * through pushOtherMinecart — not modeled here.)
 */
export function minecartPushImpulse(
  cartX: number,
  cartZ: number,
  otherX: number,
  otherZ: number
): { cart: { xa: number; za: number }; other: { xa: number; za: number } } | null {
  let xa = otherX - cartX;
  let za = otherZ - cartZ;
  let dd = xa * xa + za * za;
  if (dd < 1.0e-4) return null;
  dd = Math.sqrt(dd);
  xa /= dd;
  za /= dd;
  const pow = Math.min(1.0, 1.0 / dd);
  xa *= pow;
  za *= pow;
  xa *= 0.1;
  za *= 0.1;
  xa *= 0.5;
  za *= 0.5;
  return { cart: { xa: -xa, za: -za }, other: { xa: xa / 4.0, za: za / 4.0 } };
}

// ---------------------------------------------------------------------------
// Per-tick drivers — full AbstractMinecart.tick → behavior.tick sequence for
// the propulsion half (gravity → rail/offrail → slowdown/boost). These are the
// integration entry points; the engine dispatch calls these from its
// ridden/vehicle branch.
// ---------------------------------------------------------------------------

/**
 * OLD per-tick step — AbstractMinecart.tick (applyGravity) → OldMinecartBehavior.tick.
 *   applyGravity; pos=railBelow; onRails? moveAlongTrack : comeOffTrack.
 */
export function oldTick(s: CartState, rail: RailCtx): void {
  s.xo = s.x;
  s.zo = s.z;
  applyGravity(s);
  const maxSpeed = oldMaxSpeed(s.inWater);
  if (isRail(rail.kind)) {
    oldMoveAlongTrack(s, rail, maxSpeed);
  } else {
    comeOffTrack(s, maxSpeed);
  }
}

/**
 * NEW per-tick step (single-iteration propulsion form) —
 * NewMinecartBehavior.tick (applyGravity) → moveAlongTrack first iteration.
 *   applyGravity; onRails? setDelta(calculateTrackSpeed(...)) + step : comeOffTrack.
 * The geometric stepAlongTrack advance is position bookkeeping; this driver
 * applies the propulsion velocity transform and then a free move by the
 * resulting horizontal delta (the engine resolves collisions in real use).
 */
export function newTick(
  s: CartState,
  rail: RailCtx,
  opts: { maxMinecartSpeedRule?: number; moveIntent?: V3 | null; redstoneDirection?: V3 } = {}
): void {
  s.xo = s.x;
  s.zo = s.z;
  applyGravity(s);
  if (isRail(rail.kind)) {
    const maxSpeed = newMaxSpeed(s.inWater, opts.maxMinecartSpeedRule ?? MAX_MINECART_SPEED_DEFAULT);
    const initialH = delta(s).horizontal();
    const nd = newCalculateTrackSpeed(initialH, rail, {
      inWater: s.inWater,
      ridden: s.ridden,
      maxSpeed,
      moveIntent: opts.moveIntent ?? null,
      redstoneDirection: opts.redstoneDirection,
    });
    setDelta(s, new V3(nd.x, s.vy, nd.z));
    // free move along the resulting horizontal delta (position bookkeeping)
    s.x += nd.x;
    s.z += nd.z;
  } else {
    comeOffTrack(s, newMaxSpeed(s.inWater, opts.maxMinecartSpeedRule ?? MAX_MINECART_SPEED_DEFAULT));
  }
}
