/**
 * Differential fuzz: BotcraftPhysics.fluidPhysics(water) vs a faithful TS port of the
 * decompiled 26.2 fluid push (EntityFluidInteraction.update + Tracker.applyCurrentTo +
 * FlowingFluid.getFlow/getHeight, LiquidBlock level->FluidState mapping).
 *
 * Random water layouts (source / flowing 1..7 / falling 8+, plus stone walls) are placed
 * around a randomly positioned player; both implementations compute the velocity delta
 * from the fluid push and the fluid height. Any mismatch is printed.
 *
 * Run from the package root:
 *   node -r ts-node/register/transpile-only tests/manual/waterPushFuzz.ts
 */
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, loadMcData } from "../helpers/unit/botcraftTestSupport";
import type { Block as PBlock } from "prismarine-block";
import mdRaw from "minecraft-data";

const version = mdRaw("26.2") ? "26.2" : "1.21.11";
const { mcData, Block } = loadMcData(version);
const blocksByName = mcData.blocksByName;
const floorY = 64;

// ---------------- fake world ----------------

class FuzzWorld {
  readonly overrides = new Map<string, { type: number; meta: number }>();

  set(x: number, y: number, z: number, type: number, meta: number) {
    this.overrides.set(`${x},${y},${z}`, { type, meta });
  }

  raw(x: number, y: number, z: number): { type: number; meta: number } {
    const o = this.overrides.get(`${x},${y},${z}`);
    if (o) return o;
    return { type: y < floorY ? blocksByName.stone.id : blocksByName.air.id, meta: 0 };
  }

  getBlock(pos: Vec3) {
    const p = pos.floored();
    const { type, meta } = this.raw(p.x, p.y, p.z);
    const b = new Block(type, 0, meta);
    b.position = p;
    return b;
  }
}

// ---------------- reference port of the 26.2 algorithm ----------------

interface FluidState {
  isWater: boolean;
  amount: number; // 0 when empty
  falling: boolean;
  isSource: boolean;
}

const EMPTY: FluidState = { isWater: false, amount: 0, falling: false, isSource: false };

// LiquidBlock.getFluidState: stateCache = [source, flowing(7)..flowing(1), flowing(8, falling)]
// index min(level, 8). WaterFluid.Source.getAmount = 8; Flowing.getAmount = LEVEL value.
function fluidStateAt(world: FuzzWorld, x: number, y: number, z: number): FluidState {
  const { type, meta } = world.raw(x, y, z);
  if (type !== blocksByName.water.id) return EMPTY;
  const level = Math.min(meta, 8);
  if (level === 0) return { isWater: true, amount: 8, falling: false, isSource: true };
  if (level < 8) return { isWater: true, amount: 8 - level, falling: false, isSource: false };
  return { isWater: true, amount: 8, falling: true, isSource: false };
}

// FlowingFluid.getOwnHeight (float amount / 9.0F)
function ownHeight(s: FluidState): number {
  return Math.fround(s.amount / 9);
}

// FlowingFluid.getHeight: hasSameAbove ? 1 : ownHeight
function fluidHeightAt(world: FuzzWorld, x: number, y: number, z: number): number {
  const s = fluidStateAt(world, x, y, z);
  if (!s.isWater) return 0;
  const above = fluidStateAt(world, x, y + 1, z);
  return above.isWater ? 1.0 : ownHeight(s);
}

function blocksMotion(world: FuzzWorld, x: number, y: number, z: number): boolean {
  const { type } = world.raw(x, y, z);
  return type === blocksByName.stone.id; // fuzz world only has stone / air / water
}

// FlowingFluid.isSolidFace: same fluid -> false; ice -> false; else isFaceSturdy.
// Fuzz world: stone is sturdy on all faces, air/water are not.
function isSolidFace(world: FuzzWorld, x: number, y: number, z: number): boolean {
  const s = fluidStateAt(world, x, y, z);
  if (s.isWater) return false;
  return blocksMotion(world, x, y, z);
}

const HORIZONTAL: Array<[number, number]> = [
  [0, 1], // SOUTH
  [0, -1], // NORTH
  [1, 0], // EAST
  [-1, 0], // WEST
];

// FlowingFluid.getFlow (26.2 lines 54-99)
function refGetFlow(world: FuzzWorld, x: number, y: number, z: number): Vec3 {
  const fluid = fluidStateAt(world, x, y, z);
  let flowX = 0;
  let flowZ = 0;
  for (const [dx, dz] of HORIZONTAL) {
    const nx = x + dx;
    const nz = z + dz;
    const neighbour = fluidStateAt(world, nx, y, nz);
    // affectsFlow: empty or same fluid
    if (!(neighbour.isWater || neighbour.amount === 0)) continue;
    let neighborHeight = ownHeight(neighbour);
    let distance = 0;
    if (neighborHeight === 0) {
      if (!blocksMotion(world, nx, y, nz)) {
        const below = fluidStateAt(world, nx, y - 1, nz);
        if (below.isWater || below.amount === 0) {
          neighborHeight = ownHeight(below);
          if (neighborHeight > 0) {
            distance = Math.fround(ownHeight(fluid) - (neighborHeight - Math.fround(0.8888889)));
          }
        }
      }
    } else if (neighborHeight > 0) {
      distance = Math.fround(ownHeight(fluid) - neighborHeight);
    }
    if (distance !== 0) {
      flowX += dx * distance;
      flowZ += dz * distance;
    }
  }
  let flow = new Vec3(flowX, 0, flowZ);
  if (fluid.falling) {
    for (const [dx, dz] of HORIZONTAL) {
      const nx = x + dx;
      const nz = z + dz;
      if (isSolidFace(world, nx, y, nz) || isSolidFace(world, nx, y + 1, nz)) {
        flow = normalize(flow).offset(0, -6, 0);
        break;
      }
    }
  }
  return normalize(flow);
}

// Vec3.normalize in vanilla: `dist < 1.0E-5F ? ZERO : ...` (26.2 Vec3.java)
const NORMALIZE_EPS = Math.fround(1.0e-5);
function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return len < NORMALIZE_EPS ? new Vec3(0, 0, 0) : new Vec3(v.x / len, v.y / len, v.z / len);
}

interface RefResult {
  push: Vec3;
  height: number;
  inWater: boolean;
}

// EntityFluidInteraction.update + Tracker.applyCurrentTo (player path), WATER only
function refFluidPush(world: FuzzWorld, pos: Vec3, vel: Vec3, bbWidth: number, bbHeight: number): RefResult {
  const half = bbWidth / 2;
  const minX = pos.x - half + 0.001;
  const maxX = pos.x + half - 0.001;
  const minY = pos.y + 0.001;
  const maxY = pos.y + bbHeight - 0.001;
  const minZ = pos.z - half + 0.001;
  const maxZ = pos.z + half - 0.001;

  const x0 = Math.floor(minX);
  const y0 = Math.floor(minY);
  const z0 = Math.floor(minZ);
  const x1 = Math.ceil(maxX) - 1;
  const y1 = Math.ceil(maxY) - 1;
  const z1 = Math.ceil(maxZ) - 1;

  let height = 0;
  let acc = new Vec3(0, 0, 0);
  let count = 0;

  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        const s = fluidStateAt(world, x, y, z);
        if (!s.isWater) continue;
        const fluidTop = y + fluidHeightAt(world, x, y, z);
        if (fluidTop < minY) continue;
        height = Math.max(fluidTop - minY, height);
        let flow = refGetFlow(world, x, y, z);
        if (height < 0.4) {
          flow = flow.scaled(height);
        }
        acc = acc.plus(flow);
        count++;
      }
    }
  }

  const inWater = height > 0;
  if (count === 0 || acc.x * acc.x + acc.y * acc.y + acc.z * acc.z < 1.0e-5) {
    return { push: new Vec3(0, 0, 0), height, inWater };
  }
  let impulse = acc.scaled(1 / count); // player path
  impulse = impulse.scaled(0.014);
  if (Math.abs(vel.x) < 0.003 && Math.abs(vel.z) < 0.003 && impulse.norm() < 0.0045000000000000005) {
    impulse = normalize(impulse).scaled(0.0045000000000000005);
  }
  return { push: impulse, height, inWater };
}

// ---------------- engine side ----------------

const rig = createBotcraftPlayerRig({
  version,
  position: new Vec3(0.5, floorY, 0.5),
  groundLevel: floorY,
});
const physicsAny = rig.physics as any;

function engineFluidPush(world: FuzzWorld, pos: Vec3, vel: Vec3): { push: Vec3; height: number; inWater: boolean } {
  const st = rig.playerState as any;
  st.pos.set(pos.x, pos.y, pos.z);
  st.vel.set(vel.x, vel.y, vel.z);
  st.pose = 0; // STANDING
  st.flying = false;
  st.isInWater = false;
  st.isUnderWater = false;
  st.waterHeight = 0;
  const before = st.vel.clone();
  physicsAny.fluidPhysics(rig.playerCtx, world, true);
  return { push: st.vel.minus(before), height: st.waterHeight, inWater: st.isInWater };
}

// ---------------- fuzz loop ----------------

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0xC0FFEE);
let mismatches = 0;
const N = 20000;
for (let iter = 0; iter < N; iter++) {
  const world = new FuzzWorld();
  // random layout in a 5x3x5 region centered at origin column
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      for (let y = floorY; y <= floorY + 2; y++) {
        const r = rand();
        if (r < 0.35) {
          // water with random level: source, flowing 1..7, falling 8..15
          const lr = rand();
          const meta = lr < 0.25 ? 0 : lr < 0.75 ? 1 + Math.floor(rand() * 7) : 8 + Math.floor(rand() * 8);
          world.set(x, y, z, blocksByName.water.id, meta);
        } else if (r < 0.45) {
          world.set(x, y, z, blocksByName.stone.id, 0);
        }
        // else air
      }
    }
  }

  const pos = new Vec3(
    -0.5 + rand() * 2,
    floorY + rand() * 1.5,
    -0.5 + rand() * 2
  );
  const vel = new Vec3((rand() - 0.5) * 0.2, (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.2);
  if (rand() < 0.3) {
    vel.x = 0;
    vel.z = 0;
  }

  const ref = refFluidPush(world, pos, vel, 0.6, 1.8);
  const eng = engineFluidPush(world, pos, vel);

  const dp = ref.push.minus(eng.push).norm();
  const dh = Math.abs(ref.height - eng.height);
  if (dp > 2e-7 || dh > 2e-6 || ref.inWater !== eng.inWater) {
    mismatches++;
    if (mismatches <= 10) {
      console.log(`  dp=${dp} dh=${dh}`);
      console.log(`MISMATCH iter=${iter} pos=(${pos.x.toFixed(3)},${pos.y.toFixed(3)},${pos.z.toFixed(3)}) vel=(${vel.x.toFixed(3)},${vel.y.toFixed(3)},${vel.z.toFixed(3)})`);
      console.log(`  ref push=(${ref.push.x.toFixed(6)},${ref.push.y.toFixed(6)},${ref.push.z.toFixed(6)}) h=${ref.height.toFixed(5)} inWater=${ref.inWater}`);
      console.log(`  eng push=(${eng.push.x.toFixed(6)},${eng.push.y.toFixed(6)},${eng.push.z.toFixed(6)}) h=${eng.height.toFixed(5)} inWater=${eng.inWater}`);
      const cells: string[] = [];
      for (const [k, v] of world.overrides) {
        if (v.type === blocksByName.water.id) cells.push(`w:${k}:${v.meta}`);
        else cells.push(`s:${k}`);
      }
      console.log(`  layout: ${cells.join(" ")}`);
    }
  }
}
console.log(`fuzz done: ${N} iterations, ${mismatches} mismatches`);
