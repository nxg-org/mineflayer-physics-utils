import { Vec3 } from "vec3";

// ---------------------------------------------------------------------------
// Constants. Java `float` literals are wrapped in Math.fround so they match the
// f32 the client computes with (e.g. 0.04F, 0.9F, 0.45F, 0.05F).
// ---------------------------------------------------------------------------
const f32 = Math.fround;

/** Boat default gravity per tick. */
export const BOAT_GRAVITY = 0.04;
/** getAirDrag 1.0: no passive air drag (all drag is in floatBoat). */
export const AIR_DRAG = 1.0;
/** invFriction default 0.05F (DEAD default — never reached; status is always one of 5). */
export const DRAG_DEFAULT = f32(0.05);
/** IN_WATER / IN_AIR / UNDER_FLOWING_WATER horizontal multiplier 0.9F. */
export const DRAG_WATER = f32(0.9);
/** UNDER_WATER horizontal multiplier 0.45F. */
export const DRAG_UNDERWATER = f32(0.45);
/** UNDER_WATER constant up-buoyancy 0.01F. */
export const BUOY_UNDERWATER = f32(0.01);
/** UNDER_FLOWING_WATER vertical speed -7.0E-4. */
export const UNDERFLOW_VY = -7.0e-4;
/** Buoyancy-to-velocity gain getDefaultGravity()/0.65 = 0.04/0.65. */
export const BUOY_GAIN = BOAT_GRAVITY / 0.65;
/** Vertical damping on buoyant velocity 0.75. */
export const BUOY_DAMP = 0.75;
/** Water re-entry snap offset 0.101. */
export const SNAP_OFFSET = 0.101;
/** Slab probe thickness 0.001 for ground/in-water tests. */
export const PROBE_THICKNESS = 0.001;
/** Forward paddle acceleration (inputUp) +0.04F. */
export const ACCEL_FWD = f32(0.04);
/** Reverse paddle acceleration (inputDown) -0.005F. */
export const ACCEL_BACK = f32(-0.005);
/** Forward creep while pure-turning +0.005F. */
export const ACCEL_TURN_CREEP = f32(0.005);
/** deltaRotation change per tick from left/right input, deg/tick. */
export const TURN_RATE = 1;
/** Boat/raft bounding box width (blocks). */
export const BB_W = 1.375;
/** Boat/raft bounding box height (blocks). */
export const BB_H = 0.5625;
/** Default block friction. */
export const DEFAULT_BLOCK_FRICTION = f32(0.6);
/** Ice / packed ice / frosted ice friction. */
export const ICE_FRICTION = f32(0.98);
/** Blue ice friction. */
export const BLUE_ICE_FRICTION = f32(0.989);
/** Slime block friction. */
export const SLIME_FRICTION = f32(0.8);
/** Default block speed factor. */
export const DEFAULT_SPEED_FACTOR = 1.0;
/** outOfControlTicks eject threshold (server). */
export const OUT_OF_CONTROL_EJECT = 60;

/** Boat status enum (AbstractBoat.Status). */
export type BoatStatus =
  | "IN_WATER"
  | "UNDER_WATER"
  | "UNDER_FLOWING_WATER"
  | "ON_LAND"
  | "IN_AIR";

/** Rider input flags consumed by controlBoat. */
export interface BoatInput {
  left?: boolean;
  right?: boolean;
  up?: boolean;
  down?: boolean;
}

/**
 * Minimal boat physics state: the fields the per-tick physics read & write.
 * Position is carried as a Vec3 so the integrator can apply move(); only `y` and
 * the bounding-box top matter to floatBoat.
 */
export interface BoatState {
  pos: Vec3;
  /** deltaMovement (blocks/tick). */
  vel: Vec3;
  /** yaw VELOCITY, deg/tick — decayed by invFriction each tick. */
  deltaRotation: number;
  /** boat yaw, degrees. */
  yaw: number;
  status: BoatStatus;
  oldStatus: BoatStatus;
  /** local water-surface Y cached as a getStatus side-effect. */
  waterLevel: number;
  /** cached average block friction below (ON_LAND); halved per tick while a Player rides. */
  landFriction: number;
  /** controlling passenger is a Player (drives ON_LAND friction halving). */
  riddenByPlayer: boolean;
  /** boat box height (1.375x0.5625 default; identical for Boat & Raft). */
  bbHeight: number;
  /** counts UNDER_WATER / UNDER_FLOWING_WATER ticks; ejects at 60 (server). */
  outOfControlTicks: number;
}

/** Create a default boat state at a position (acacia/all-wood box, no rider). */
export function makeBoatState(pos: Vec3, opts: Partial<BoatState> = {}): BoatState {
  return {
    pos: pos.clone(),
    vel: new Vec3(0, 0, 0),
    deltaRotation: 0,
    yaw: 0,
    status: "IN_AIR",
    oldStatus: "IN_AIR",
    waterLevel: 0,
    landFriction: 0,
    riddenByPlayer: false,
    bbHeight: BB_H,
    outOfControlTicks: 0,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Environment probe — the world-derived facts getStatus() needs. Supplied by the
// caller so the module stays world-agnostic and unit-testable (the integration
// step wires these to the actual world).
// ---------------------------------------------------------------------------
export interface BoatEnvProbe {
  /** isUnderwater() result: "UNDER_WATER" | "UNDER_FLOWING_WATER" | null. */
  submerged: "UNDER_WATER" | "UNDER_FLOWING_WATER" | null;
  /** waterLevel to cache when submerged (= boundingBox.maxY). */
  submergedWaterLevel: number;
  /** checkInWater() result (bottom slab below a water surface). */
  inWater: boolean;
  /** waterLevel set by checkInWater (highest local water surface). */
  inWaterLevel: number;
  /** getGroundFriction() average block friction below (NaN if count==0). */
  groundFriction: number;
}

/**
 * getStatus() — status selection order:
 *   1. isUnderwater() != null  -> waterLevel = box.maxY, return UNDER_WATER/UNDER_FLOWING_WATER
 *   2. checkInWater()          -> return IN_WATER (waterLevel already set as side-effect)
 *   3. getGroundFriction() > 0 -> landFriction = friction, return ON_LAND  (NaN>0 is false)
 *   4. else                    -> IN_AIR
 * Mutates b.waterLevel / b.landFriction as the source caches them.
 */
export function getStatus(b: BoatState, env: BoatEnvProbe): BoatStatus {
  if (env.submerged !== null) {
    b.waterLevel = env.submergedWaterLevel; // = boundingBox.maxY
    return env.submerged;
  }
  if (env.inWater) {
    b.waterLevel = env.inWaterLevel; // checkInWater side-effect
    return "IN_WATER";
  }
  const friction = env.groundFriction;
  // NaN > 0 is false -> IN_AIR when nothing solid is under the boat (count==0 -> NaN).
  if (friction > 0) {
    b.landFriction = friction; // cached ON_LAND
    return "ON_LAND";
  }
  return "IN_AIR";
}

/** getY(scale): minY + scale*bbHeight. getY(1.0) = top of the box. */
function getY(b: BoatState, scale: number): number {
  return b.pos.y + scale * b.bbHeight;
}

/**
 * floatBoat() — vertical buoyancy/gravity + horizontal drag (invFriction) on
 * vel.x/z and deltaRotation.
 *
 * `getWaterLevelAbove` is only used on the rare water-re-entry SNAP branch and requires a world
 * query + collision test; we accept it via the optional `snap` callback so the common (non-snap)
 * path stays world-free. If `snap` is omitted on a snap-triggering tick, the snap teleport is
 * skipped (status is still forced to IN_WATER, matching the source's post-snap state) but no
 * drag/gravity is applied this tick (the whole else-block is skipped).
 *
 * @returns the status as the source leaves it (snap branch overwrites status to IN_WATER).
 */
export function floatBoat(
  b: BoatState,
  snap?: {
    /** getWaterLevelAbove() — first non-full water layer Y above the boat top. */
    getWaterLevelAbove: () => number;
    /** noCollision(box.move(0, targetY-getY(), 0)) — true if the snap move is clear. */
    noCollisionMovedTo: (targetY: number) => boolean;
  }
): BoatStatus {
  let vspeed = -getGravity(b); // -getGravity(), default -0.04
  let buoyancy = 0.0;
  let invFriction = DRAG_DEFAULT; // 0.05F dead default

  // --- water re-entry snap: was IN_AIR, now in (non-land) water ---
  if (
    b.oldStatus === "IN_AIR" &&
    b.status !== "IN_AIR" &&
    b.status !== "ON_LAND"
  ) {
    b.waterLevel = getY(b, 1.0); // top of box
    if (snap) {
      const targetY = snap.getWaterLevelAbove() - b.bbHeight + SNAP_OFFSET;
      if (snap.noCollisionMovedTo(targetY)) {
        b.pos = new Vec3(b.pos.x, targetY, b.pos.z);
        b.vel = new Vec3(b.vel.x, 0.0, b.vel.z);
        // lastYd = 0 — not tracked in this minimal state
      }
    }
    b.status = "IN_WATER"; // forced; NO drag/gravity applied this tick
    return b.status;
  }

  // --- common per-tick float (status switch) ---
  switch (b.status) {
    case "IN_WATER":
      buoyancy = (b.waterLevel - getY(b, 0.0)) / b.bbHeight;
      invFriction = DRAG_WATER;
      break;
    case "UNDER_FLOWING_WATER":
      vspeed = UNDERFLOW_VY;
      invFriction = DRAG_WATER;
      break;
    case "UNDER_WATER":
      buoyancy = BUOY_UNDERWATER;
      invFriction = DRAG_UNDERWATER;
      break;
    case "IN_AIR":
      invFriction = DRAG_WATER; // gravity already in vspeed
      break;
    case "ON_LAND":
      invFriction = b.landFriction;
      if (b.riddenByPlayer) b.landFriction = f32(b.landFriction / 2.0);
      break;
  }

  // horizontal drag + vertical gravity/sink
  b.vel = new Vec3(b.vel.x * invFriction, b.vel.y + vspeed, b.vel.z * invFriction);
  b.deltaRotation *= invFriction;

  // buoyancy lift — only IN_WATER (below surface) and UNDER_WATER give buoyancy>0
  if (buoyancy > 0.0) {
    b.vel = new Vec3(b.vel.x, (b.vel.y + buoyancy * BUOY_GAIN) * BUOY_DAMP, b.vel.z);
  }
  return b.status;
}

/** getGravity(): noGravity ? 0 : getDefaultGravity(); for boats = 0.04. */
function getGravity(_b: BoatState): number {
  return BOAT_GRAVITY;
}

/**
 * controlBoat() — steering + paddle acceleration. Only runs when isVehicle()
 * (has a controlling passenger). Order: turn -> integrate yaw -> forward/back
 * accel -> add thrust along the POST-turn facing -> set paddle visual state.
 *
 * @returns the paddle visual state {left,right} for completeness.
 */
export function controlBoat(b: BoatState, input: BoatInput): { left: boolean; right: boolean } {
  if (!b.riddenByPlayer) return { left: false, right: false }; // isVehicle() guard
  const left = !!input.left;
  const right = !!input.right;
  const up = !!input.up;
  const down = !!input.down;

  let acceleration = 0.0;
  if (left) b.deltaRotation -= TURN_RATE;
  if (right) b.deltaRotation += TURN_RATE;
  if (right !== left && !up && !down) acceleration += ACCEL_TURN_CREEP; // pure-turn creep

  b.yaw += b.deltaRotation; // integrate yaw BEFORE thrust

  if (up) acceleration += ACCEL_FWD;
  if (down) acceleration += ACCEL_BACK;

  // thrust along facing — sign convention: (sin(-yaw)*a, 0, cos(yaw)*a),
  // yaw in radians = yaw * (PI/180) as a Java float.
  const rad = f32(b.yaw * f32(Math.PI / 180.0));
  b.vel = new Vec3(
    b.vel.x + Math.sin(-rad) * acceleration,
    b.vel.y,
    b.vel.z + Math.cos(rad) * acceleration
  );

  // LEFT paddle is driven by (right && !left) || up, the RIGHT paddle by (left && !right) || up.
  return { left: (right && !left) || up, right: (left && !right) || up };
}

/**
 * move() block speed factor — applied AFTER collision in move(). Multiplies ONLY
 * horizontal velocity by getBlockSpeedFactor() (Y untouched). For boats on normal
 * terrain / open water the factor is 1.0 and this is a no-op; soul sand / honey
 * reduce it. Collision itself (the AABB sweep) is the engine's job at integration
 * time; this is the trailing horizontal scale that floatBoat/controlBoat feed into.
 */
export function applyBlockSpeedFactor(b: BoatState, blockSpeedFactor: number): void {
  b.vel = new Vec3(b.vel.x * blockSpeedFactor, b.vel.y, b.vel.z * blockSpeedFactor);
}

/**
 * One authoritative boat physics step, excluding the world collision sweep
 * (`move`'s AABB part) which belongs to the engine. Order: getStatus -> floatBoat
 * (drag+buoyancy/gravity) -> controlBoat (accel+turn) -> [engine collision] ->
 * applyBlockSpeedFactor (X/Z).
 *
 * The caller supplies `env` (world probes for getStatus) and `input` (rider). The
 * collision sweep is NOT done here; call the engine's collide on b.pos/b.vel between
 * controlBoat and applyBlockSpeedFactor, then call applyBlockSpeedFactor with the
 * resolved block factor.
 *
 * @returns the resolved status for the tick (post-snap if the snap branch fired).
 */
export function boatTickPrelude(
  b: BoatState,
  env: BoatEnvProbe,
  input: BoatInput,
  snap?: Parameters<typeof floatBoat>[1]
): BoatStatus {
  b.oldStatus = b.status;
  b.status = getStatus(b, env);

  // out-of-control timer: only UNDER_WATER / UNDER_FLOWING_WATER accrue; else reset.
  if (b.status !== "UNDER_WATER" && b.status !== "UNDER_FLOWING_WATER") {
    b.outOfControlTicks = 0;
  } else {
    b.outOfControlTicks += 1;
  }

  floatBoat(b, snap); // vertical + horizontal drag
  if (b.riddenByPlayer) controlBoat(b, input); // input -> accel + turn
  // NOTE: engine collision sweep + applyBlockSpeedFactor happen AFTER this, at integration time.
  return b.status;
}

/** Whether the boat should eject passengers this tick (server). */
export function shouldEjectPassengers(b: BoatState): boolean {
  return b.outOfControlTicks >= OUT_OF_CONTROL_EJECT;
}
