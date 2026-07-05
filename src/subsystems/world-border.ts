import { Vec3 } from "vec3";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** `MAX_SIZE` — max border edge length; ALSO the default size. A float literal
 *  (`5.999997E7F`), hence Math.fround. */
export const MAX_SIZE: number = Math.fround(5.999997e7);

/** `MAX_CENTER_COORDINATE` — max abs value of center X/Z (a plain double). */
export const MAX_CENTER_COORDINATE = 2.9999984e7;

/** default `absoluteMaxSize` — edges are clamped to ±this. */
export const ABS_MAX_SIZE = 29999984;

/** `1.0E-5F` inset subtracted from the max edge in the AABB bounds-check and in
 *  clampVec3ToBound. A float literal. NOTE: this inset affects the boolean queries ONLY,
 *  never the integer-snapped collision box. */
export const EDGE_INSET: number = Math.fround(1.0e-5);

/** `1.0E-7` movement-negligible early-out in Shapes.collide (|distance| < 1e-7 -> 0). */
export const COLLIDE_EPSILON = 1.0e-7;

/** "close to border" distance multiplier of bbMax (dist < bbMax * 2.0). */
export const CLOSE_MULTIPLIER = 2.0;

/** floor for bbMax in the gate (max(absMax(...), 1.0)). */
export const BBMAX_FLOOR = 1.0;

// Gameplay (NOT collision) defaults.
/** default `damagePerBlock` — out-of-border damage per block past safeZone.
 *  Gameplay; not used by the wall. */
export const DEFAULT_DAMAGE_PER_BLOCK = 0.2;
/** default `safeZone` — blocks past the edge before damage. */
export const DEFAULT_SAFE_ZONE = 5.0;
/** default `warningTime` (field, seconds). NOTE the Settings.DEFAULT record uses 300 — a distinct value. */
export const DEFAULT_WARNING_TIME_FIELD = 15;
/** Settings.DEFAULT warningTime. */
export const DEFAULT_WARNING_TIME_SETTINGS = 300;
/** default `warningBlocks`. */
export const DEFAULT_WARNING_BLOCKS = 5;

/** Border lerp status (enum + cosmetic render-color ints, physics-irrelevant). */
export enum BorderStatus {
  GROWING = "GROWING",
  SHRINKING = "SHRINKING",
  STATIONARY = "STATIONARY",
}

/** Cosmetic render colors per status. Not used by physics; retained for completeness. */
export const BORDER_STATUS_COLOR: Record<BorderStatus, number> = {
  [BorderStatus.GROWING]: 4259712,
  [BorderStatus.SHRINKING]: 16724016,
  [BorderStatus.STATIONARY]: 2138367,
};

// -----------------------------------------------------------------------------
// Mth primitives
// -----------------------------------------------------------------------------

/** Mth.clamp(value,min,max) (double). NOTE the asymmetric form — `value < min ? min : Math.min(value, max)`,
 *  NOT `Math.max(min, Math.min(value, max))`; for min<=max they agree, but we mirror vanilla literally. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : Math.min(value, max);
}

/** Mth.lerp(alpha,p0,p1) (double) — `p0 + alpha*(p1 - p0)`.
 *  With alpha=0 returns p0 exactly — why a tick-time edge query (deltaPartialTick=0)
 *  selects previousSize during a moving border. */
export function lerp(alpha: number, p0: number, p1: number): number {
  return p0 + alpha * (p1 - p0);
}

/** Mth.absMax(a,b) (double) — max(abs(a), abs(b)). */
export function absMax(a: number, b: number): number {
  return Math.max(Math.abs(a), Math.abs(b));
}

// -----------------------------------------------------------------------------
// Border state. The WorldBorder + Static/MovingBorderExtent fields a
// 20-tps blocks/tick engine needs.
// -----------------------------------------------------------------------------

export interface WorldBorderState {
  centerX: number; // default 0.0
  centerZ: number; // default 0.0
  size: number; // current edge length
  /** previousSize — the value tick-time edge queries see (deltaPartialTick=0 -> lerp
   *  returns previousSize). For a Static border this equals `size`. */
  prevSize: number;
  /** lerp source/target/remaining. lerpProgress<=0 => the border is Static. */
  lerpFrom: number;
  lerpTo: number;
  lerpProgress: number; // ticks remaining; 0 => static
  lerpDuration: number;
  absoluteMaxSize: number;
}

/** Build a static border (StaticBorderExtent semantics). prevSize==size for a static border. */
export function makeStaticBorder(opts: {
  centerX?: number;
  centerZ?: number;
  size?: number;
  absoluteMaxSize?: number;
} = {}): WorldBorderState {
  const size = opts.size ?? MAX_SIZE;
  return {
    centerX: opts.centerX ?? 0.0,
    centerZ: opts.centerZ ?? 0.0,
    size,
    prevSize: size,
    lerpFrom: size,
    lerpTo: size,
    lerpProgress: 0,
    lerpDuration: 0,
    absoluteMaxSize: opts.absoluteMaxSize ?? ABS_MAX_SIZE,
  };
}

/** Begin a size lerp. from==to short-circuits to Static. lerpProgress=duration,
 *  size=previousSize=calculateSize() at progress 0 (which is `from` when from!=to). */
export function lerpSizeBetween(
  b: WorldBorderState,
  from: number,
  to: number,
  durationTicks: number
): void {
  if (from === to || durationTicks <= 0) {
    b.size = to;
    b.prevSize = to;
    b.lerpFrom = to;
    b.lerpTo = to;
    b.lerpProgress = 0;
    b.lerpDuration = 0;
    return;
  }
  b.lerpFrom = from;
  b.lerpTo = to;
  b.lerpDuration = durationTicks;
  b.lerpProgress = durationTicks;
  // size = previousSize = calculateSize() at progress 0
  // -> progress = (dur - dur)/dur = 0 < 1 -> lerp(0, from, to) = from.
  const initial = calculateSize(b);
  b.size = initial;
  b.prevSize = initial;
}

/** calculateSize() — progress = (lerpDuration - lerpProgress)/lerpDuration;
 *  progress<1 ? lerp(progress, from, to) : to. */
function calculateSize(b: WorldBorderState): number {
  const progress = (b.lerpDuration - b.lerpProgress) / b.lerpDuration;
  return progress < 1.0 ? lerp(progress, b.lerpFrom, b.lerpTo) : b.lerpTo;
}

/** WorldBorder.tick() -> extent.update(). Static: no change. Moving:
 *    lerpProgress--; previousSize = size; size = calculateSize();
 *    when lerpProgress<=0 -> swap to a static border at `to`.
 *  Call once per world tick. */
export function tickBorder(b: WorldBorderState): void {
  if (b.lerpProgress > 0) {
    b.lerpProgress--;
    b.prevSize = b.size;
    b.size = calculateSize(b);
    if (b.lerpProgress <= 0) {
      b.size = b.lerpTo;
      b.prevSize = b.lerpTo;
      b.lerpFrom = b.lerpTo;
      b.lerpProgress = 0;
      b.lerpDuration = 0;
    }
  } else {
    // Static: update() returns self; prevSize already == size.
    b.prevSize = b.size;
  }
}

/** Border status. Moving: `to < from ? SHRINKING : GROWING`. Static: STATIONARY. */
export function getStatus(b: WorldBorderState): BorderStatus {
  if (b.lerpProgress <= 0) return BorderStatus.STATIONARY;
  return b.lerpTo < b.lerpFrom ? BorderStatus.SHRINKING : BorderStatus.GROWING;
}

/** getLerpSpeed() — abs(from - to) / lerpDuration. Static -> 0. */
export function getLerpSpeed(b: WorldBorderState): number {
  if (b.lerpProgress <= 0 || b.lerpDuration === 0) return 0.0;
  return Math.abs(b.lerpFrom - b.lerpTo) / b.lerpDuration;
}

// -----------------------------------------------------------------------------
// Geometry — the box edges (evaluated on demand).
// -----------------------------------------------------------------------------

export interface BorderEdges {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** The four edges at tick time: clamp(center ± lerp(dpt, prevSize, size)/2, -absMax, +absMax).
 *  At deltaPartialTick=0 (the default) lerp(0, prevSize, size) = prevSize, so tick-time edges use
 *  `prevSize` for a moving border (== size for a static one). deltaPartialTick is passed explicitly
 *  to remain bit-faithful; default 0 = vanilla tick-time. */
export function edges(b: WorldBorderState, deltaPartialTick = 0.0): BorderEdges {
  const s = lerp(deltaPartialTick, b.prevSize, b.size);
  const half = s / 2.0;
  const am = b.absoluteMaxSize;
  return {
    minX: clamp(b.centerX - half, -am, am),
    minZ: clamp(b.centerZ - half, -am, am),
    maxX: clamp(b.centerX + half, -am, am),
    maxZ: clamp(b.centerZ + half, -am, am),
  };
}

/** getSize() — current edge length. */
export function getSize(b: WorldBorderState): number {
  return b.size;
}

// -----------------------------------------------------------------------------
// Queries.
// -----------------------------------------------------------------------------

/** getDistanceToBorder(x,z) = min(x-minX, maxX-x, z-minZ, maxZ-z). Positive inside,
 *  negative outside; returns the distance to the NEAREST of the four walls. */
export function distanceToBorder(b: WorldBorderState, x: number, z: number): number {
  const e = edges(b);
  const fromNorth = z - e.minZ;
  const fromSouth = e.maxZ - z;
  const fromWest = x - e.minX;
  const fromEast = e.maxX - x;
  let min = Math.min(fromWest, fromEast);
  min = Math.min(min, fromNorth);
  return Math.min(min, fromSouth);
}

/** isWithinBounds(x,z,margin): x >= minX-m && x < maxX+m && z >= minZ-m && z < maxZ+m.
 *  NOTE the half-open `<` on the max side. */
export function isWithinBounds(
  b: WorldBorderState,
  x: number,
  z: number,
  margin = 0.0
): boolean {
  const e = edges(b);
  return (
    x >= e.minX - margin &&
    x < e.maxX + margin &&
    z >= e.minZ - margin &&
    z < e.maxZ + margin
  );
}

/** isWithinBounds(AABB) overload — checks BOTH corners (min and max), insetting the
 *  max corner by EDGE_INSET (1e-5F). */
export function isAabbWithinBounds(
  b: WorldBorderState,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number
): boolean {
  const hiX = maxX - EDGE_INSET;
  const hiZ = maxZ - EDGE_INSET;
  return isWithinBounds(b, minX, minZ) && isWithinBounds(b, hiX, hiZ);
}

/** clampVec3ToBound(x,y,z) = (clamp(x,minX,maxX-1e-5), y, clamp(z,minZ,maxZ-1e-5)).
 *  Y unchanged. NOT used by collision — for teleport/spawn placement; useful to snap a
 *  respawn target inside. */
export function clampVec3ToBound(
  b: WorldBorderState,
  x: number,
  y: number,
  z: number
): { x: number; y: number; z: number } {
  const e = edges(b);
  return {
    x: clamp(x, e.minX, e.maxX - EDGE_INSET),
    y,
    z: clamp(z, e.minZ, e.maxZ - EDGE_INSET),
  };
}

/** isInsideCloseToBorder(source, aabb) — the gate that decides whether the wall
 *  participates in this move:
 *    bbMax = max(absMax(box.xSize, box.zSize), 1.0)
 *    return getDistanceToBorder(x,z) < bbMax*2.0 && isWithinBounds(x,z, bbMax)
 *  `x`,`z` are the entity CENTER (getX()/getZ()), `aabbXSize`/`aabbZSize`
 *  are the AABB's full extents. Both conditions must hold. An entity that is OUTSIDE
 *  the border fails condition 2 (and the wall is not added -> no pull-back). */
export function isInsideCloseToBorder(
  b: WorldBorderState,
  x: number,
  z: number,
  aabbXSize: number,
  aabbZSize: number
): boolean {
  const bbMax = Math.max(absMax(aabbXSize, aabbZSize), BBMAX_FLOOR);
  return (
    distanceToBorder(b, x, z) < bbMax * CLOSE_MULTIPLIER && // dist < bbMax*2
    isWithinBounds(b, x, z, bbMax)
  );
}

// -----------------------------------------------------------------------------
// The collision wall.
//
// The wall is all space OUTSIDE the integer-snapped interior box, infinite in Y (vanilla
// builds it as a VoxelShape complement of that box). In an AABB-sweep engine the wall is
// equivalently the FOUR outward half-space slabs of that interior box (the entity can only
// ever touch one face per axis). We model it as the interior box bounds + four slab AABBs.
// -----------------------------------------------------------------------------

export interface BorderWall {
  /** integer-snapped interior box: floor(min), ceil(max). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** The integer-snapped interior box whose COMPLEMENT (infinite in Y) is the wall.
 *  floor on the min side, ceil on the max side. The solid region is everything OUTSIDE
 *  [minX,maxX]x[minZ,maxZ]. */
export function borderWallBox(b: WorldBorderState): BorderWall {
  const e = edges(b);
  return {
    minX: Math.floor(e.minX),
    minZ: Math.floor(e.minZ),
    maxX: Math.ceil(e.maxX),
    maxZ: Math.ceil(e.maxZ),
  };
}

/** An axis-aligned box collider (a finite stand-in for the wall's slabs; Y is
 *  unbounded in vanilla but irrelevant to the X/Z sweep, so we leave Y open by
 *  using ±Infinity). */
export interface ColliderBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** The wall as the FOUR outward slabs of the integer-snapped interior box, each
 *  infinite in Y (and spanning the full Z range on the X slabs / full X range on the
 *  Z slabs). A swept AABB inside the box can only ever contact the inner face of one
 *  slab per axis, so this reproduces the wall exactly for collision purposes. */
export function borderWallSlabs(b: WorldBorderState): ColliderBox[] {
  const w = borderWallBox(b);
  const NEG = -Infinity;
  const POS = Infinity;
  return [
    // West slab: everything with X < minX. Inner face at X = minX.
    { minX: NEG, minY: NEG, minZ: NEG, maxX: w.minX, maxY: POS, maxZ: POS },
    // East slab: everything with X > maxX. Inner face at X = maxX.
    { minX: w.maxX, minY: NEG, minZ: NEG, maxX: POS, maxY: POS, maxZ: POS },
    // North slab: everything with Z < minZ. Inner face at Z = minZ.
    { minX: NEG, minY: NEG, minZ: NEG, maxX: POS, maxY: POS, maxZ: w.minZ },
    // South slab: everything with Z > maxZ. Inner face at Z = maxZ.
    { minX: NEG, minY: NEG, minZ: w.maxZ, maxX: POS, maxY: POS, maxZ: POS },
  ];
}

// -----------------------------------------------------------------------------
// Per-axis collision clip.
//
// For a single box on one axis the clip is: if the moving AABB's projection on the
// OTHER two axes overlaps the collider, shorten the displacement so the AABB stops
// at the collider's near face. Shapes.collide folds the displacement through every
// shape; we replicate the `|distance| < 1e-7 -> 0` early-out too.
// -----------------------------------------------------------------------------

export type Axis = "x" | "y" | "z";

interface AABBLike {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Whether the moving AABB overlaps the collider on the two axes OTHER than `axis`.
 *  (Half-open on max.) */
function overlapsPerpendicular(moving: AABBLike, c: ColliderBox, axis: Axis): boolean {
  if (axis !== "x") {
    if (moving.maxX <= c.minX || moving.minX >= c.maxX) return false;
  }
  if (axis !== "y") {
    if (moving.maxY <= c.minY || moving.minY >= c.maxY) return false;
  }
  if (axis !== "z") {
    if (moving.maxZ <= c.minZ || moving.minZ >= c.maxZ) return false;
  }
  return true;
}

/** Clip `distance` for one collider on one axis. Positive distance moves toward +axis
 *  (clipped against the collider's min face); negative toward -axis (clipped against its
 *  max face). Returns the (possibly shortened) distance. */
function collideBoxAxis(
  axis: Axis,
  moving: AABBLike,
  c: ColliderBox,
  distance: number
): number {
  if (!overlapsPerpendicular(moving, c, axis)) return distance;
  if (axis === "x") {
    if (distance > 0.0 && moving.maxX <= c.minX) {
      return Math.min(distance, c.minX - moving.maxX);
    }
    if (distance < 0.0 && moving.minX >= c.maxX) {
      return Math.max(distance, c.maxX - moving.minX);
    }
    return distance;
  }
  if (axis === "y") {
    if (distance > 0.0 && moving.maxY <= c.minY) {
      return Math.min(distance, c.minY - moving.maxY);
    }
    if (distance < 0.0 && moving.minY >= c.maxY) {
      return Math.max(distance, c.maxY - moving.minY);
    }
    return distance;
  }
  // z
  if (distance > 0.0 && moving.maxZ <= c.minZ) {
    return Math.min(distance, c.minZ - moving.maxZ);
  }
  if (distance < 0.0 && moving.minZ >= c.maxZ) {
    return Math.max(distance, c.maxZ - moving.minZ);
  }
  return distance;
}

/** Shapes.collide(axis, moving, shapes, distance) — folds the displacement through
 *  every shape; early-returns 0 once `|distance| < 1e-7`. */
export function shapesCollide(
  axis: Axis,
  moving: AABBLike,
  colliders: ColliderBox[],
  distance: number
): number {
  let d = distance;
  for (const c of colliders) {
    if (Math.abs(d) < COLLIDE_EPSILON) return 0.0;
    d = collideBoxAxis(axis, moving, c, d);
  }
  return d;
}

/** Direction.axisStepOrder(movement): abs(movement.x) < abs(movement.z) ? [y,z,x] : [y,x,z].
 *  Y is ALWAYS resolved first, then X/Z by relative magnitude. NOT a plain
 *  descending-|component| sort. */
export function axisStepOrder(movement: { x: number; y: number; z: number }): Axis[] {
  return Math.abs(movement.x) < Math.abs(movement.z)
    ? ["y", "z", "x"]
    : ["y", "x", "z"];
}

// -----------------------------------------------------------------------------
// Public collision API — the shape provider + a standalone per-axis resolver.
//
// `provideCollisionShapes` is the integration seam: the engine's collide() builds
// its collider list (entities, then THIS, then blocks) and runs the same per-axis
// sweep. Calling code uses the SAME gate vanilla does (isInsideCloseToBorder) so
// the (potentially huge) wall is only added when the entity is near AND inside.
// -----------------------------------------------------------------------------

/** Returns the border wall colliders to APPEND to the collision sweep for this
 *  move, or `[]` when the gate fails (entity not near-and-inside).
 *  `box` is the entity AABB (already expandedTowards the movement by the caller). */
export function provideCollisionShapes(
  b: WorldBorderState,
  entityBox: AABBLike
): ColliderBox[] {
  const x = (entityBox.minX + entityBox.maxX) / 2.0; // entity center X
  const z = (entityBox.minZ + entityBox.maxZ) / 2.0; // entity center Z
  const xSize = entityBox.maxX - entityBox.minX;
  const zSize = entityBox.maxZ - entityBox.minZ;
  if (!isInsideCloseToBorder(b, x, z, xSize, zSize)) return [];
  return borderWallSlabs(b);
}

/** Standalone resolver: clip `movement` (blocks/tick) against the border wall ONLY
 *  (gate -> per-axis sweep in axisStepOrder -> Shapes.collide). Returns the resolved
 *  per-axis displacement as a Vec3.
 *  In the real engine the wall colliders would be MERGED with block/entity colliders
 *  in ONE sweep; this isolated form (border-only) is exact when no block intersects
 *  the same face. */
export function collide(
  b: WorldBorderState,
  entityBox: AABBLike,
  movement: { x: number; y: number; z: number }
): Vec3 {
  const colliders = provideCollisionShapes(b, entityBox);
  if (colliders.length === 0) {
    return new Vec3(movement.x, movement.y, movement.z);
  }
  const resolved = { x: 0, y: 0, z: 0 };
  // Move a working copy of the box by the already-resolved axes between steps.
  for (const axis of axisStepOrder(movement)) {
    const m = movement[axis];
    if (m !== 0) {
      const moved: AABBLike = {
        minX: entityBox.minX + resolved.x,
        minY: entityBox.minY + resolved.y,
        minZ: entityBox.minZ + resolved.z,
        maxX: entityBox.maxX + resolved.x,
        maxY: entityBox.maxY + resolved.y,
        maxZ: entityBox.maxZ + resolved.z,
      };
      resolved[axis] = shapesCollide(axis, moved, colliders, m);
    }
  }
  return new Vec3(resolved.x, resolved.y, resolved.z);
}

// -----------------------------------------------------------------------------
// Gameplay damage (NOT physics) — lower priority. Players only, server-side.
//   dist = getDistanceToBorder(this) + safeZone
//   if (dist < 0 && damagePerBlock > 0): hurt = max(1, floor(-dist * damagePerBlock))
// This is gameplay, separate from the collision wall — a movement engine can ignore it.
// -----------------------------------------------------------------------------

/** Out-of-border damage amount for a player at (x,z). Returns 0 when inside (or within
 *  safeZone). damagePerBlock/safeZone default to 0.2 / 5.0. */
export function outOfBorderDamage(
  b: WorldBorderState,
  x: number,
  z: number,
  damagePerBlock = DEFAULT_DAMAGE_PER_BLOCK,
  safeZone = DEFAULT_SAFE_ZONE
): number {
  const dist = distanceToBorder(b, x, z) + safeZone;
  if (dist < 0 && damagePerBlock > 0) {
    return Math.max(1, Math.floor(-dist * damagePerBlock));
  }
  return 0;
}
