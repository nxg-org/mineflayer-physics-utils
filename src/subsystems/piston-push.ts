// -----------------------------------------------------------------------------
// Direction.
// -----------------------------------------------------------------------------
export const enum Dir {
  DOWN = 0,
  UP = 1,
  NORTH = 2,
  SOUTH = 3,
  WEST = 4,
  EAST = 5,
}

// The signed unit vector of the facing.
const STEP: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 0], // DOWN
  [0, 1, 0], // UP
  [0, 0, -1], // NORTH
  [0, 0, 1], // SOUTH
  [-1, 0, 0], // WEST
  [1, 0, 0], // EAST
];
const OPPOSITE: ReadonlyArray<number> = [1, 0, 3, 2, 5, 4];

// axis of a direction: 0=X, 1=Y, 2=Z.
function axisIndexOf(dir: number): 0 | 1 | 2 {
  return dir <= Dir.UP ? 1 : dir <= Dir.SOUTH ? 2 : 0;
}
function axisIsHorizontal(dir: number): boolean {
  return axisIndexOf(dir) !== 1;
}
// POSITIVE(+1)=UP,SOUTH,EAST; NEGATIVE(-1)=DOWN,NORTH,WEST.
function axisDirStep(dir: number): number {
  return dir === Dir.UP || dir === Dir.SOUTH || dir === Dir.EAST ? 1 : -1;
}

// -----------------------------------------------------------------------------
// Plain axis-aligned box.
// -----------------------------------------------------------------------------
export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}
export interface Vec3f {
  x: number;
  y: number;
  z: number;
}

function boxIntersects(a: Box, b: Box): boolean {
  // Strict on all three axes.
  return (
    a.minX < b.maxX &&
    a.maxX > b.minX &&
    a.minY < b.maxY &&
    a.maxY > b.minY &&
    a.minZ < b.maxZ &&
    a.maxZ > b.minZ
  );
}

// The union box (min of mins, max of maxes).
function minmax(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

function moveBox(box: Box, dx: number, dy: number, dz: number): Box {
  return {
    minX: box.minX + dx,
    minY: box.minY + dy,
    minZ: box.minZ + dz,
    maxX: box.maxX + dx,
    maxY: box.maxY + dy,
    maxZ: box.maxZ + dz,
  };
}

// -----------------------------------------------------------------------------
// Sweep ONE face of `box` by `amount` along `direction`.
// delta = amount * axisDirStep(direction).
// -----------------------------------------------------------------------------
function getMovementArea(box: Box, direction: number, amount: number): Box {
  const delta = amount * axisDirStep(direction);
  const min = Math.min(delta, 0.0);
  const max = Math.max(delta, 0.0);
  switch (direction) {
    case Dir.WEST:
      return { minX: box.minX + min, minY: box.minY, minZ: box.minZ, maxX: box.minX + max, maxY: box.maxY, maxZ: box.maxZ };
    case Dir.EAST:
      return { minX: box.maxX + min, minY: box.minY, minZ: box.minZ, maxX: box.maxX + max, maxY: box.maxY, maxZ: box.maxZ };
    case Dir.DOWN:
      return { minX: box.minX, minY: box.minY + min, minZ: box.minZ, maxX: box.maxX, maxY: box.minY + max, maxZ: box.maxZ };
    case Dir.NORTH:
      return { minX: box.minX, minY: box.minY, minZ: box.minZ + min, maxX: box.maxX, maxY: box.maxY, maxZ: box.minZ + max };
    case Dir.SOUTH:
      return { minX: box.minX, minY: box.minY, minZ: box.maxZ + min, maxX: box.maxX, maxY: box.maxY, maxZ: box.maxZ + max };
    case Dir.UP:
    default:
      return { minX: box.minX, minY: box.maxY + min, minZ: box.minZ, maxX: box.maxX, maxY: box.maxY + max, maxZ: box.maxZ };
  }
}

// Signed overlap of `aabb` past the `aabbToBeOutsideOf` face along `movement`
// (how far to shove the entity out).
function getMovement(aabbToBeOutsideOf: Box, movement: number, aabb: Box): number {
  switch (movement) {
    case Dir.EAST:
      return aabbToBeOutsideOf.maxX - aabb.minX;
    case Dir.WEST:
      return aabb.maxX - aabbToBeOutsideOf.minX;
    case Dir.DOWN:
      return aabb.maxY - aabbToBeOutsideOf.minY;
    case Dir.SOUTH:
      return aabbToBeOutsideOf.maxZ - aabb.minZ;
    case Dir.NORTH:
      return aabb.maxZ - aabbToBeOutsideOf.minZ;
    case Dir.UP:
    default:
      return aabbToBeOutsideOf.maxY - aabb.minY;
  }
}

function getExtendedProgress(extending: boolean, progress: number): number {
  return extending ? progress - 1.0 : 1.0 - progress;
}

// Place a [0,1]-local shape at the block pos offset by the CURRENT extended progress
// along the RAW direction (not movement).
function moveByPositionAndProgress(ev: PistonMoveEvent, box: Box): Box {
  const currentPosition = getExtendedProgress(ev.extending, ev.progress);
  const [sx, sy, sz] = STEP[ev.direction];
  return moveBox(box, ev.x + currentPosition * sx, ev.y + currentPosition * sy, ev.z + currentPosition * sz);
}

function boundsOf(shapes: ReadonlyArray<ReadonlyArray<number>>): Box | null {
  if (shapes.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const s of shapes) {
    if (s[0] < minX) minX = s[0];
    if (s[1] < minY) minY = s[1];
    if (s[2] < minZ) minZ = s[2];
    if (s[3] > maxX) maxX = s[3];
    if (s[4] > maxY) maxY = s[4];
    if (s[5] > maxZ) maxZ = s[5];
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

// -----------------------------------------------------------------------------
// Public types.
// -----------------------------------------------------------------------------

/**
 * One active MOVING_PISTON block entity mid-animation that could move the player
 * THIS tick. Fed by the fork's BLOCK_ACTION -> moving-piston tracking.
 *  - x,y,z            : integer block position of the MOVING_PISTON block entity.
 *  - direction        : the RAW stored facing (0-5); getMovementDirection derives push dir.
 *  - extending        : true while pushing out, false while retracting.
 *  - isSourcePiston   : the moved state is the piston body itself (head retract special case).
 *  - progress         : the block entity's progress at the START of this tick (0.0 or 0.5).
 *                       vanilla steps newProgress = progress + 0.5F (deltaProgress = 0.5).
 *  - movedShapes      : collision AABBs of the moved block state in [0,1] block-local coords
 *                       (a full cube = [[0,0,0,1,1,1]]).
 *  - isSlime / isHoney: movedState.is(SLIME_BLOCK) / is(HONEY_BLOCK) -> launch / drag behaviour.
 */
export interface PistonMoveEvent {
  x: number;
  y: number;
  z: number;
  direction: number;
  extending: boolean;
  isSourcePiston: boolean;
  progress: number;
  movedShapes: ReadonlyArray<ReadonlyArray<number>>;
  isSlime: boolean;
  isHoney: boolean;
}

export interface PistonSubject {
  box: Box; // the player's current AABB
  x: number; // pos.x
  z: number; // pos.z
  onGround: boolean;
  supportingBlockPos: { x: number; y: number; z: number } | null;
}

export interface PistonPushResult {
  velSetAxis: -1 | 0 | 1 | 2; // slime launch: hard-set this vel axis (-1 = none). 0=x 1=y 2=z
  velSetValue: number;
  pushDelta: Vec3f | null; // positional push (pre-collision, apply via entity.move)
  stuckDelta: Vec3f | null; // honey drag (pre-collision, apply via entity.move)
}

const PUSH_OFFSET = 0.01; // true DOUBLE 0.01, NOT a float
const PROGRESS_STEP = 0.5; // newProgress - progress each tick (deltaProgress)
const STICKY_TOP_HEIGHT = 1.5000010000000001; // sticky region top (exact double literal)

/**
 * Reproduce the piston moveCollidedEntities + moveStuckEntities motion for a SINGLE
 * subject (the local player) against ONE active moving piston. Returns the intended
 * motions; the caller applies collision-limited moves + the velocity set.
 *
 * The local player is a NORMAL-reaction entity that is NOT a ServerPlayer: the region
 * query gates processing; for slime the movement-axis velocity is HARD-SET to +/-1.0;
 * then the per-shape swept overlap yields delta = min(maxOverlap, deltaProgress) + 0.01,
 * moved along the movement axis. Independently, a honey (sticky) block horizontally
 * DRAGS an on-top entity by the full deltaProgress.
 */
export function computePistonPush(ev: PistonMoveEvent, subject: PistonSubject): PistonPushResult {
  const result: PistonPushResult = { velSetAxis: -1, velSetValue: 0, pushDelta: null, stuckDelta: null };

  const movement = ev.extending ? ev.direction : OPPOSITE[ev.direction];
  const deltaProgress = PROGRESS_STEP;

  // ---- moveCollidedEntities --------------------------------------
  const bounds = boundsOf(ev.movedShapes);
  if (bounds !== null) {
    const aabb = moveByPositionAndProgress(ev, bounds);
    const region = minmax(getMovementArea(aabb, movement, deltaProgress), aabb);
    // Every entity incl. players has piston push-reaction NORMAL, so there is no reaction gate here.
    if (boxIntersects(region, subject.box)) {
      // slime causeBounce: the local player is NOT a ServerPlayer -> set the movement-axis velocity.
      if (ev.isSlime) {
        const ai = axisIndexOf(movement);
        result.velSetAxis = ai;
        result.velSetValue = STEP[movement][ai]; // +/-1 (the movement axis step)
      }
      // per-shape swept overlap -> delta
      let delta = 0.0;
      for (const shape of ev.movedShapes) {
        const shapeBox: Box = { minX: shape[0], minY: shape[1], minZ: shape[2], maxX: shape[3], maxY: shape[4], maxZ: shape[5] };
        const movingAABB = getMovementArea(moveByPositionAndProgress(ev, shapeBox), movement, deltaProgress);
        if (boxIntersects(movingAABB, subject.box)) {
          delta = Math.max(delta, getMovement(movingAABB, movement, subject.box));
          if (delta >= deltaProgress) break;
        }
      }
      if (delta > 0.0) {
        delta = Math.min(delta, deltaProgress) + PUSH_OFFSET;
        const [sx, sy, sz] = STEP[movement];
        result.pushDelta = { x: delta * sx, y: delta * sy, z: delta * sz };
      }
    }
  }

  // ---- moveStuckEntities (honey drag) -----------------------------
  if (ev.isHoney && axisIsHorizontal(movement)) {
    // stickyTop = the moved shape's max Y.
    let stickyTop = 0.0;
    for (const shape of ev.movedShapes) if (shape[4] > stickyTop) stickyTop = shape[4];
    const stickyLocal: Box = { minX: 0.0, minY: stickyTop, minZ: 0.0, maxX: 1.0, maxY: STICKY_TOP_HEIGHT, maxZ: 1.0 };
    const stickyAabb = moveByPositionAndProgress(ev, stickyLocal);
    if (boxIntersects(stickyAabb, subject.box) && matchesSticky(stickyAabb, subject, ev)) {
      const [sx, sy, sz] = STEP[movement];
      result.stuckDelta = { x: deltaProgress * sx, y: deltaProgress * sy, z: deltaProgress * sz };
    }
  }

  return result;
}

// matchesStickyCritera: push-reaction NORMAL (always true for players) && onGround
// && (supportedBy(pos) || x/z inside the sticky region).
function matchesSticky(aabb: Box, subject: PistonSubject, ev: PistonMoveEvent): boolean {
  if (!subject.onGround) return false;
  const sb = subject.supportingBlockPos;
  const supportedBy = sb != null && sb.x === ev.x && sb.y === ev.y && sb.z === ev.z;
  if (supportedBy) return true;
  return subject.x >= aabb.minX && subject.x <= aabb.maxX && subject.z >= aabb.minZ && subject.z <= aabb.maxZ;
}
