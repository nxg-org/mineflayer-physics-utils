import { Vec3 } from "vec3";

// ----------------------------------------------------------------------------
// Constants. Units: blocks, blocks/tick.
// ----------------------------------------------------------------------------

/** Minecart gravity per tick, land. */
export const GRAVITY_LAND = 0.04;
/** Minecart gravity per tick, in water. */
export const GRAVITY_WATER = 0.005;
/** Off-rail air drag (getAirDrag) 0.95F. */
export const AIR_DRAG = Math.fround(0.95);
/** Off-rail ground friction multiplier. */
export const GROUND_FRICTION = 0.5;
/** WATER_SLOWDOWN_FACTOR, extra ×0.95 in water. */
export const WATER_SLOWDOWN_FACTOR = Math.fround(0.95);

/** Base slope slide speed (= 1/128). */
export const SLOPE_SLIDE = 0.0078125;
/** Water slope-speed multiplier. */
export const SLOPE_WATER_MULT = 0.2;
/** New slope speed scaling: max(SLOPE_SLIDE, |v_h|*0.02). */
export const NEW_SLOPE_SPEED_SCALE = 0.02;

/** Cap on `pow` (rail-reproject horizontal speed). */
export const REPROJECT_CAP = 2.0;

/** Old max speed: inWater?0.2:0.4. */
export const MAX_SPEED_ON_LAND = 0.4;
export const MAX_SPEED_IN_WATER = 0.2;
/** getKnownMovement horizontal report clamp (old). */
export const ABSOLUTE_MAX_SPEED = 0.4;

/** max_minecart_speed gamerule default (range [1,1000]). */
export const MAX_MINECART_SPEED_GAMERULE_DEFAULT = 8;
/** ticks/sec divisor in new max speed. */
export const NEW_MAXSPEED_DIVISOR = 20.0;

/** Occupied-cart applied-velocity scale (old). */
export const RIDDEN_SCALE = 0.75;

/** Natural-slowdown factors. */
export const SLOWDOWN_EMPTY_OLD = 0.96;
export const SLOWDOWN_EMPTY_NEW = 0.975;
export const SLOWDOWN_RIDDEN = 0.997;

/** Powered-rail boost increment. */
export const BOOST = 0.06;
/** Old powered-rail start kick. */
export const START_KICK_OLD = 0.02;
/** New powered-rail start kick. */
export const START_KICK_NEW = 0.2;

/** Halt-track (unpowered powered-rail brake). */
export const BRAKE_CUTOFF = 0.03;
export const BRAKE_MULT = 0.5;

/** "moving" speed² threshold (player nudge / boost). */
export const MOVING_SQR_THRESHOLD = 0.01;
/** Player input nudge magnitude. */
export const PLAYER_NUDGE = 0.001;

/** Downhill speed-gain coefficient (old). */
export const DOWNHILL_GAIN = 0.05;
/** Rail Y offset (1/16) in getPos. */
export const RAIL_Y_OFFSET = 0.0625;

/** ON_RAIL_Y_OFFSET (new). */
export const ON_RAIL_Y_OFFSET = 0.1;
/** OPPOSING_SLOPES_REST_AT_SPEED_THRESHOLD (new V-shape rest). */
export const VSHAPE_REST_THRESHOLD = 0.005;
/** Mth.SQRT_OF_TWO (new hill step length). */
export const SQRT_OF_TWO = Math.fround(Math.SQRT2);

// ----------------------------------------------------------------------------
// Rail shapes + EXITS geometry.
// Directions: WEST=(-1,0,0) EAST=(+1,0,0) NORTH=(0,0,-1) SOUTH=(0,0,+1);
// ascending shapes use .below() for the single y=-1 exit.
// ----------------------------------------------------------------------------

export type RailShape =
  | "NORTH_SOUTH"
  | "EAST_WEST"
  | "ASCENDING_EAST"
  | "ASCENDING_WEST"
  | "ASCENDING_NORTH"
  | "ASCENDING_SOUTH"
  | "SOUTH_EAST"
  | "SOUTH_WEST"
  | "NORTH_WEST"
  | "NORTH_EAST";

type Vec3i = readonly [number, number, number];

/** EXITS pair (exit0, exit1) per shape. */
export const EXITS: Record<RailShape, readonly [Vec3i, Vec3i]> = {
  NORTH_SOUTH: [[0, 0, -1], [0, 0, 1]],
  EAST_WEST: [[-1, 0, 0], [1, 0, 0]],
  ASCENDING_EAST: [[-1, -1, 0], [1, 0, 0]],
  ASCENDING_WEST: [[-1, 0, 0], [1, -1, 0]],
  ASCENDING_NORTH: [[0, 0, -1], [0, -1, 1]],
  ASCENDING_SOUTH: [[0, -1, -1], [0, 0, 1]],
  SOUTH_EAST: [[0, 0, 1], [1, 0, 0]],
  SOUTH_WEST: [[0, 0, 1], [-1, 0, 0]],
  NORTH_WEST: [[0, 0, -1], [-1, 0, 0]],
  NORTH_EAST: [[0, 0, -1], [1, 0, 0]],
};

/** RailShape.isSlope() — true for the four ASCENDING_*. */
export function isSlope(shape: RailShape): boolean {
  return (
    shape === "ASCENDING_EAST" ||
    shape === "ASCENDING_WEST" ||
    shape === "ASCENDING_NORTH" ||
    shape === "ASCENDING_SOUTH"
  );
}

// ----------------------------------------------------------------------------
// World + minecart state interfaces (the engine-dispatch hookup will fill these
// from the real Bot/world; the parity test fills them from a fixed rig).
// ----------------------------------------------------------------------------

/** Minimal block view at a single block position. */
export interface RailBlockInfo {
  /** True if `state.is(BlockTags.RAILS) && block instanceof BaseRailBlock`. */
  isRail: boolean;
  /** True if `state.is(BlockTags.RAILS)` (used by the y-1 "rail below" probe). */
  isRailTagged: boolean;
  /** Rail orientation; undefined when not a rail. */
  shape?: RailShape;
  /** True only for Blocks.POWERED_RAIL. */
  isPoweredRail: boolean;
  /** True only for Blocks.ACTIVATOR_RAIL. */
  isActivatorRail: boolean;
  /** PoweredRailBlock.POWERED value (powered/activator rails). */
  powered: boolean;
  /** state.isRedstoneConductor(...). */
  isRedstoneConductor: boolean;
}

/** Block lookup. (x,y,z) integer block coords. */
export type BlockGetter = (x: number, y: number, z: number) => RailBlockInfo;

/** Mutable minecart state the per-tick step reads + writes. */
export interface MinecartState {
  /** position (entity origin). */
  pos: Vec3;
  /** position last tick (xo,yo,zo). */
  posO: Vec3;
  /** deltaMovement (velocity), blocks/tick. */
  vel: Vec3;
  /** true if a passenger occupies the cart (isVehicle()). */
  isVehicle: boolean;
  /** the controlling passenger's last client move-intent (world-space xz), or null. */
  moveIntent: Vec3 | null;
  /** true while the cart's feet AABB is in water. */
  isInWater: boolean;
  /** onGround flag (only consulted off-rail). */
  onGround: boolean;
  /** onRails flag. */
  onRails: boolean;
  /** flip bool used to keep visual orientation continuous. */
  flipped: boolean;
  /** yaw (degrees). */
  yRot: number;
  /** yaw last tick. */
  yRotO: number;
  /** firstTick flag. */
  firstTick: boolean;
}

export interface MinecartConfig {
  /** experimental flag: useExperimentalMovement (minecart_improvements). default false → Old. */
  experimental: boolean;
  /** max_minecart_speed gamerule (only used by New). default 8. */
  maxMinecartSpeedGamerule: number;
  /** rideable carts (base Minecart) auto-mount; irrelevant for movement math. */
  rideable?: boolean;
}

// ----------------------------------------------------------------------------
// Small vec helpers mirroring the Vec3/Mth primitives the source uses.
// ----------------------------------------------------------------------------

const V = (x: number, y: number, z: number) => new Vec3(x, y, z);
const ZERO = () => new Vec3(0, 0, 0);

/** Vec3.horizontalDistance — Math.hypot(x,z). */
function horizontalDistance(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.z * v.z);
}
/** Vec3.horizontalDistanceSqr — x*x+z*z. */
function horizontalDistanceSqr(v: Vec3): number {
  return v.x * v.x + v.z * v.z;
}
/** Vec3.length. */
function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
/** Vec3.lengthSqr. */
function lengthSqr(v: Vec3): number {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}
/** Vec3.normalize — ZERO if len < 1e-5 (1e-4 in some MC builds). */
function normalize(v: Vec3): Vec3 {
  const len = length(v);
  return len < 1.0e-5 ? ZERO() : V(v.x / len, v.y / len, v.z / len);
}
/** Vec3.horizontal — {x,0,z}. */
function horizontal(v: Vec3): Vec3 {
  return V(v.x, 0, v.z);
}
/** Mth.clamp(v,min,max). */
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
/** Mth.wrapDegrees(double). */
function wrapDegrees(a: number): number {
  let d = a % 360.0;
  if (d >= 180.0) d -= 360.0;
  if (d < -180.0) d += 360.0;
  return d;
}

// ----------------------------------------------------------------------------
// Shared helpers (AbstractMinecart)
// ----------------------------------------------------------------------------

/**
 * AbstractMinecart.getCurrentBlockPosOrRailBelow().
 * floor(x,y,z); old: if block at (x,y-1,z) is RAILS-tagged, y--; new: probe y-0.1-1e-5.
 */
export function getCurrentBlockPosOrRailBelow(
  pos: Vec3,
  getBlock: BlockGetter,
  experimental: boolean
): Vec3i {
  const xt = Math.floor(pos.x);
  let yt = Math.floor(pos.y);
  const zt = Math.floor(pos.z);
  if (experimental) {
    const y = pos.y - 0.1 - Math.fround(1.0e-5); // 1.0E-5F
    if (getBlock(xt, Math.floor(y), zt).isRailTagged) {
      yt = Math.floor(y);
    }
  } else if (getBlock(xt, yt - 1, zt).isRailTagged) {
    yt--;
  }
  return [xt, yt, zt];
}

/** getDefaultGravity — water 0.005 else 0.04. */
export function getDefaultGravity(inWater: boolean): number {
  return inWater ? GRAVITY_WATER : GRAVITY_LAND;
}

/**
 * AbstractMinecart.applyNaturalSlowdown.
 * v.multiply(f,0,f); if inWater scale by 0.95F. Zeroes the y component.
 */
export function applyNaturalSlowdown(v: Vec3, slowdownFactor: number, inWater: boolean): Vec3 {
  let r = V(v.x * slowdownFactor, 0, v.z * slowdownFactor);
  if (inWater) r = V(r.x * WATER_SLOWDOWN_FACTOR, 0, r.z * WATER_SLOWDOWN_FACTOR);
  return r;
}

/** getSlowdownFactor. Old (ridden 0.997 / empty 0.96); New (empty 0.975). */
export function getSlowdownFactor(isVehicle: boolean, experimental: boolean): number {
  if (isVehicle) return SLOWDOWN_RIDDEN;
  return experimental ? SLOWDOWN_EMPTY_NEW : SLOWDOWN_EMPTY_OLD;
}

/** Max speed. Old (0.2/0.4); New (gamerule*(water?0.5:1)/20). */
export function getMaxSpeed(state: MinecartState, cfg: MinecartConfig): number {
  if (cfg.experimental) {
    return (cfg.maxMinecartSpeedGamerule * (state.isInWater ? 0.5 : 1.0)) / NEW_MAXSPEED_DIVISOR;
  }
  return state.isInWater ? MAX_SPEED_IN_WATER : MAX_SPEED_ON_LAND;
}

/**
 * AbstractMinecart.comeOffTrack — off-rail movement:
 *   clamp horiz to ±maxSpeed; if onGround *0.5; move(SELF, v); if airborne *0.95.
 * `move` here is the entity AABB sweep — in this headless port we model the simple
 * no-wall case: pos += vel (Y included; gravity already added at top of tick).
 * Returns the new state (mutated pos/vel).
 */
export function comeOffTrack(state: MinecartState, cfg: MinecartConfig): void {
  const maxSpeed = getMaxSpeed(state, cfg);
  let v = state.vel;
  v = V(clamp(v.x, -maxSpeed, maxSpeed), v.y, clamp(v.z, -maxSpeed, maxSpeed));
  if (state.onGround) {
    v = V(v.x * GROUND_FRICTION, v.y * GROUND_FRICTION, v.z * GROUND_FRICTION);
  }
  state.vel = v;
  // move(SELF, v): no-wall sweep — advance the position by the (clamped/ground-damped) delta.
  state.pos = state.pos.offset(v.x, v.y, v.z);
  if (!state.onGround) {
    state.vel = V(v.x * AIR_DRAG, v.y * AIR_DRAG, v.z * AIR_DRAG);
  }
}

// ----------------------------------------------------------------------------
// OldMinecartBehavior.moveAlongTrack — DEFAULT.
// ----------------------------------------------------------------------------

/** getPos(x,y,z) — projects (x,y,z) onto the rail centre line. */
export function getPos(
  x: number,
  y: number,
  z: number,
  getBlock: BlockGetter
): Vec3 | null {
  const xt = Math.floor(x);
  let yt = Math.floor(y);
  const zt = Math.floor(z);
  if (getBlock(xt, yt - 1, zt).isRailTagged) yt--;
  const info = getBlock(xt, yt, zt);
  if (!info.isRail || !info.shape) return null;
  const shape = info.shape;
  const [exit0, exit1] = EXITS[shape];
  const x0 = xt + 0.5 + exit0[0] * 0.5;
  const y0 = yt + RAIL_Y_OFFSET + exit0[1] * 0.5;
  const z0 = zt + 0.5 + exit0[2] * 0.5;
  const x1 = xt + 0.5 + exit1[0] * 0.5;
  const y1 = yt + RAIL_Y_OFFSET + exit1[1] * 0.5;
  const z1 = zt + 0.5 + exit1[2] * 0.5;
  const xD = x1 - x0;
  const yD = (y1 - y0) * 2.0;
  const zD = z1 - z0;
  let progress: number;
  if (xD === 0.0) progress = z - zt;
  else if (zD === 0.0) progress = x - xt;
  else {
    const xx = x - x0;
    const zz = z - z0;
    progress = (xx * xD + zz * zD) * 2.0;
  }
  let rx = x0 + xD * progress;
  let ry = y0 + yD * progress;
  let rz = z0 + zD * progress;
  if (yD < 0.0) ry++;
  else if (yD > 0.0) ry += 0.5;
  return V(rx, ry, rz);
}

/**
 * OldMinecartBehavior.moveAlongTrack(level) — the full ordered pipeline.
 * Mutates state.pos / state.vel. `pos` is the rail block pos (Vec3i).
 */
export function moveAlongTrackOld(
  state: MinecartState,
  posI: Vec3i,
  getBlock: BlockGetter,
  cfg: MinecartConfig
): void {
  const [px, , pz] = posI;
  const info = getBlock(posI[0], posI[1], posI[2]);
  const shape = info.shape!;
  // resetFallDistance() — n/a here.
  let x = state.pos.x;
  let y = state.pos.y;
  let z = state.pos.z;
  const oldPos = getPos(x, y, z, getBlock);
  y = posI[1];

  let powerTrack = false;
  let haltTrack = false;
  if (info.isPoweredRail) {
    powerTrack = info.powered;
    haltTrack = !powerTrack;
  }

  // 3. Slope acceleration.
  let slideSpeed = SLOPE_SLIDE;
  if (state.isInWater) slideSpeed *= SLOPE_WATER_MULT;
  let movement = state.vel;
  switch (shape) {
    case "ASCENDING_EAST":
      movement = movement.offset(-slideSpeed, 0, 0);
      y++;
      break;
    case "ASCENDING_WEST":
      movement = movement.offset(slideSpeed, 0, 0);
      y++;
      break;
    case "ASCENDING_NORTH":
      movement = movement.offset(0, 0, slideSpeed);
      y++;
      break;
    case "ASCENDING_SOUTH":
      movement = movement.offset(0, 0, -slideSpeed);
      y++;
      break;
  }
  state.vel = movement;

  // 4. Re-project velocity onto the rail direction.
  movement = state.vel;
  const [exit0, exit1] = EXITS[shape];
  let xD = exit1[0] - exit0[0];
  let zD = exit1[2] - exit0[2];
  const railLen = Math.sqrt(xD * xD + zD * zD);
  const flip = movement.x * xD + movement.z * zD;
  if (flip < 0.0) {
    xD = -xD;
    zD = -zD;
  }
  const pow = Math.min(REPROJECT_CAP, horizontalDistance(movement));
  movement = V((pow * xD) / railLen, movement.y, (pow * zD) / railLen);
  state.vel = movement;

  // 5. Player input nudge.
  if (state.moveIntent && lengthSqr(state.moveIntent) > 0.0) {
    const rider = normalize(state.moveIntent);
    const ownDist = horizontalDistanceSqr(state.vel);
    if (lengthSqr(rider) > 0.0 && ownDist < MOVING_SQR_THRESHOLD) {
      state.vel = state.vel.offset(
        state.moveIntent.x * PLAYER_NUDGE,
        0,
        state.moveIntent.z * PLAYER_NUDGE
      );
      haltTrack = false;
    }
  }

  // 6. Halt track (brake).
  if (haltTrack) {
    const speedLength = horizontalDistance(state.vel);
    if (speedLength < BRAKE_CUTOFF) state.vel = ZERO();
    else state.vel = V(state.vel.x * BRAKE_MULT, 0, state.vel.z * BRAKE_MULT);
  }

  // 7. Snap position onto the rail line.
  const x0 = px + 0.5 + exit0[0] * 0.5;
  const z0 = pz + 0.5 + exit0[2] * 0.5;
  const x1 = px + 0.5 + exit1[0] * 0.5;
  const z1 = pz + 0.5 + exit1[2] * 0.5;
  xD = x1 - x0;
  zD = z1 - z0;
  let progress: number;
  if (xD === 0.0) progress = z - pz;
  else if (zD === 0.0) progress = x - px;
  else {
    const xx = x - x0;
    const zz = z - z0;
    progress = (xx * xD + zz * zD) * 2.0;
  }
  x = x0 + xD * progress;
  z = z0 + zD * progress;
  state.pos = V(x, y, z);

  // 8. Apply the move (clamped, scaled).
  const scale = state.isVehicle ? RIDDEN_SCALE : 1.0;
  const maxSpeed = getMaxSpeed(state, cfg);
  movement = state.vel;
  const moveDelta = V(
    clamp(scale * movement.x, -maxSpeed, maxSpeed),
    0,
    clamp(scale * movement.z, -maxSpeed, maxSpeed)
  );
  // move(SELF, moveDelta): headless no-wall sweep — advance pos by the horizontal delta.
  state.pos = state.pos.offset(moveDelta.x, moveDelta.y, moveDelta.z);

  // 9. Climb a slope exit if the cart crossed into an exit cell with Y offset ≠ 0.
  const fx = Math.floor(state.pos.x);
  const fz = Math.floor(state.pos.z);
  if (exit0[1] !== 0 && fx - px === exit0[0] && fz - pz === exit0[2]) {
    state.pos = V(state.pos.x, state.pos.y + exit0[1], state.pos.z);
  } else if (exit1[1] !== 0 && fx - px === exit1[0] && fz - pz === exit1[2]) {
    state.pos = V(state.pos.x, state.pos.y + exit1[1], state.pos.z);
  }

  // 10. Natural slowdown.
  state.vel = applyNaturalSlowdown(
    state.vel,
    getSlowdownFactor(state.isVehicle, false),
    state.isInWater
  );

  // 11. Slope-derived speed correction.
  const newPos = getPos(state.pos.x, state.pos.y, state.pos.z, getBlock);
  if (newPos !== null && oldPos !== null) {
    const speed = (oldPos.y - newPos.y) * DOWNHILL_GAIN;
    const v3 = state.vel;
    const otherPow = horizontalDistance(v3);
    if (otherPow > 0.0) {
      const factor = (otherPow + speed) / otherPow;
      state.vel = V(v3.x * factor, v3.y * 1.0, v3.z * factor);
    }
    state.pos = V(state.pos.x, newPos.y, state.pos.z);
  }

  // 12. Corner velocity redirect.
  const xn = Math.floor(state.pos.x);
  const zn = Math.floor(state.pos.z);
  if (xn !== px || zn !== pz) {
    const v3 = state.vel;
    const otherPow = horizontalDistance(v3);
    state.vel = V(otherPow * (xn - px), v3.y, otherPow * (zn - pz));
  }

  // 13. Powered-rail boost.
  if (powerTrack) {
    const v3 = state.vel;
    const speedLength = horizontalDistance(v3);
    if (speedLength > MOVING_SQR_THRESHOLD) {
      // note source uses the literal 0.06 (the `double speed=0.06` is dead).
      state.vel = v3.offset(
        (v3.x / speedLength) * BOOST,
        0,
        (v3.z / speedLength) * BOOST
      );
    } else {
      // stationary start kick toward a redstone-conductor side.
      let dx = v3.x;
      let dz = v3.z;
      if (shape === "EAST_WEST") {
        if (getBlock(px - 1, posI[1], pz).isRedstoneConductor) dx = START_KICK_OLD; // west()
        else if (getBlock(px + 1, posI[1], pz).isRedstoneConductor) dx = -START_KICK_OLD; // east()
      } else if (shape === "NORTH_SOUTH") {
        if (getBlock(px, posI[1], pz - 1).isRedstoneConductor) dz = START_KICK_OLD; // north()
        else if (getBlock(px, posI[1], pz + 1).isRedstoneConductor) dz = -START_KICK_OLD; // south()
      } else {
        return; // non-straight powered rail at rest → no kick.
      }
      state.vel = V(dx, v3.y, dz);
    }
  }
}

// ----------------------------------------------------------------------------
// NewMinecartBehavior speed components (experimental). The full sub-stepping
// stepAlongTrack polyline advance is large; we port the velocity-shaping core
// (slope / halt / boost / slowdown+clamp).
// ----------------------------------------------------------------------------

/** calculateSlopeSpeed. slideSpeed = max(0.0078125, |v_h|*0.02) (×0.2 water). */
export function calculateSlopeSpeedNew(
  deltaMovement: Vec3,
  shape: RailShape,
  inWater: boolean
): Vec3 {
  let slideSpeed = Math.max(SLOPE_SLIDE, horizontalDistance(deltaMovement) * NEW_SLOPE_SPEED_SCALE);
  if (inWater) slideSpeed *= SLOPE_WATER_MULT;
  switch (shape) {
    case "ASCENDING_EAST":
      return deltaMovement.offset(-slideSpeed, 0, 0);
    case "ASCENDING_WEST":
      return deltaMovement.offset(slideSpeed, 0, 0);
    case "ASCENDING_NORTH":
      return deltaMovement.offset(0, 0, slideSpeed);
    case "ASCENDING_SOUTH":
      return deltaMovement.offset(0, 0, -slideSpeed);
    default:
      return deltaMovement;
  }
}

/** calculateHaltTrackSpeed. Unpowered powered rail: len<0.03?ZERO:v*0.5. */
export function calculateHaltTrackSpeedNew(deltaMovement: Vec3, info: RailBlockInfo): Vec3 {
  if (info.isPoweredRail && !info.powered) {
    return length(deltaMovement) < BRAKE_CUTOFF
      ? ZERO()
      : V(deltaMovement.x * BRAKE_MULT, deltaMovement.y * BRAKE_MULT, deltaMovement.z * BRAKE_MULT);
  }
  return deltaMovement;
}

/**
 * calculateBoostTrackSpeed. Powered rail:
 *   len>0.01 → v̂*(len+0.06); else redstoneDir*(len+0.2) (ZERO redstoneDir → unchanged).
 */
export function calculateBoostTrackSpeedNew(
  deltaMovement: Vec3,
  redstoneDir: Vec3
): Vec3 {
  const len = length(deltaMovement);
  if (len > MOVING_SQR_THRESHOLD) {
    const n = normalize(deltaMovement);
    return V(n.x * (len + BOOST), n.y * (len + BOOST), n.z * (len + BOOST));
  }
  if (lengthSqr(redstoneDir) <= 0.0) return deltaMovement;
  return V(
    redstoneDir.x * (len + START_KICK_NEW),
    redstoneDir.y * (len + START_KICK_NEW),
    redstoneDir.z * (len + START_KICK_NEW)
  );
}

/** isDecending(movement, shape). */
export function isDecending(movement: Vec3, shape: RailShape): boolean {
  switch (shape) {
    case "ASCENDING_EAST":
      return movement.x < 0.0;
    case "ASCENDING_WEST":
      return movement.x > 0.0;
    case "ASCENDING_NORTH":
      return movement.z > 0.0;
    case "ASCENDING_SOUTH":
      return movement.z < 0.0;
    default:
      return false;
  }
}

// ----------------------------------------------------------------------------
// Top-level per-tick step. Server-side only (no client lerp).
// ----------------------------------------------------------------------------

export class MinecartPhysics {
  constructor(
    public readonly getBlock: BlockGetter,
    public readonly cfg: MinecartConfig = {
      experimental: false,
      maxMinecartSpeedGamerule: MAX_MINECART_SPEED_GAMERULE_DEFAULT,
    }
  ) {}

  /** applyGravity() — adds -gravity to vel.y. */
  applyGravity(state: MinecartState): void {
    state.vel = V(state.vel.x, state.vel.y - getDefaultGravity(state.isInWater), state.vel.z);
  }

  /**
   * One server tick of rail physics (Old behavior path of OldMinecartBehavior.tick).
   * Order: setOldPos → applyGravity → find rail → onRails?moveAlongTrack:comeOffTrack → yaw.
   * The NEW behavior's full sub-stepping loop is not run here (the velocity-shaping
   * components are exported for callers that need them); `cfg.experimental` selects the
   * Old-vs-New slowdown/maxspeed/rail-probe constants used throughout.
   */
  tick(state: MinecartState): void {
    // record last-tick position (Entity.setOldPosAndRot equivalent for yaw derivation).
    state.posO = state.pos.clone();
    state.yRotO = state.yRot;

    // 1. gravity (applyGravity at the top).
    this.applyGravity(state);

    // 2. find rail block under the cart.
    const posI = getCurrentBlockPosOrRailBelow(state.pos, this.getBlock, this.cfg.experimental);
    const info = this.getBlock(posI[0], posI[1], posI[2]);
    const onRails = info.isRail;
    state.onRails = onRails;

    // 3. onRails ? moveAlongTrack : comeOffTrack.
    if (onRails) {
      moveAlongTrackOld(state, posI, this.getBlock, this.cfg);
    } else {
      comeOffTrack(state, this.cfg);
    }

    // 5. yaw from horizontal displacement since last tick.
    const xDiff = state.posO.x - state.pos.x;
    const zDiff = state.posO.z - state.pos.z;
    if (xDiff * xDiff + zDiff * zDiff > 0.001) {
      state.yRot = (Math.atan2(zDiff, xDiff) * 180.0) / Math.PI;
      if (state.flipped) state.yRot += 180.0;
    }
    const rotDiff = wrapDegrees(state.yRot - state.yRotO);
    if (rotDiff < -170.0 || rotDiff >= 170.0) {
      state.yRot += 180.0;
      state.flipped = !state.flipped;
    }
    state.yRot = state.yRot % 360.0;

    state.firstTick = false;
  }
}

/** Convenience factory for a default-survival (Old) minecart sim. */
export function createOldMinecart(getBlock: BlockGetter): MinecartPhysics {
  return new MinecartPhysics(getBlock, {
    experimental: false,
    maxMinecartSpeedGamerule: MAX_MINECART_SPEED_GAMERULE_DEFAULT,
  });
}
