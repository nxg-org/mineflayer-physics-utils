/**
 * Repro script for the water-drift divergence (real client ~0.014 push / 0.056 sustained
 * in a developed flowing channel vs engine reportedly ~0.004 push / 0.006 sustained).
 *
 * Builds a straight flowing-water channel (source meta 0 at z=0, flowing meta 1..7 at
 * z=1..7) on a stone floor and lets a zero-input player drift. Prints the per-tick
 * horizontal fluid push (captured by wrapping fluidPhysics) and the horizontal speed.
 *
 * Run from the package root:
 *   node -r ts-node/register/transpile-only tests/manual/waterDriftRepro.ts
 */
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, loadMcData } from "../helpers/unit/botcraftTestSupport";
import type { Block as PBlock } from "prismarine-block";

import mdRaw from "minecraft-data";
const version = mdRaw("26.2") ? "26.2" : "1.21.11";
console.log(`using minecraft-data version ${version}`);
const floorY = 64; // stone below y=64, so the floor surface is at y=64

const { mcData, Block } = loadMcData(version);
const blocksByName = mcData.blocksByName;

class ChannelWorld {
  private readonly overrides: Record<string, PBlock> = {};

  setBlock(x: number, y: number, z: number, type: number, meta: number) {
    const b = new Block(type, 0, meta);
    b.position = new Vec3(x, y, z);
    this.overrides[`${x},${y},${z}`] = b;
  }

  getBlock(pos: Vec3) {
    const p = pos.floored();
    const o = this.overrides[`${p.x},${p.y},${p.z}`];
    if (o) return o;
    const type = p.y < floorY ? blocksByName.stone.id : blocksByName.air.id;
    const b = new Block(type, 0, 0);
    b.position = p;
    return b;
  }
}

const world = new ChannelWorld();
// water channel along +z: source (meta 0) at z=0, flowing meta 1..7 at z=1..7.
// walls on both sides so it is a real channel (not required for physics, but faithful).
const waterId = blocksByName.water.id;
for (let z = 0; z <= 7; z++) {
  world.setBlock(0, floorY, z, waterId, z);
  world.setBlock(-1, floorY, z, blocksByName.stone.id, 0);
  world.setBlock(1, floorY, z, blocksByName.stone.id, 0);
}
world.setBlock(0, floorY, -1, blocksByName.stone.id, 0);

// sanity: dump what the engine sees for the channel blocks
for (let z = -1; z <= 8; z++) {
  const b = world.getBlock(new Vec3(0, floorY, z)) as any;
  console.log(
    `z=${z} name=${b.name} meta=${b.metadata} bbox=${b.boundingBox} props=${JSON.stringify(b.getProperties())}`
  );
}

const rig = createBotcraftPlayerRig({
  version,
  position: new Vec3(0.5, floorY, 1.5),
  groundLevel: floorY,
});

// capture the horizontal push added by fluidPhysics(water) each tick
let lastPush = 0;
let lastNumPush = -1;
const physicsAny = rig.physics as any;
const origFluid = physicsAny.fluidPhysics.bind(rig.physics);
physicsAny.fluidPhysics = function (ctx: any, w: any, isWater: boolean) {
  if (!isWater) return origFluid(ctx, w, isWater);
  const before = ctx.state.vel.clone();
  origFluid(ctx, w, isWater);
  const d = ctx.state.vel.minus(before);
  lastPush = Math.hypot(d.x, d.z);
};

const pushes: number[] = [];
const speeds: number[] = [];
for (let i = 0; i < 120; i++) {
  lastPush = 0;
  rig.physics.simulate(rig.playerCtx, world as any);
  rig.playerState.apply(rig.fakePlayer);
  const st = rig.playerState;
  const speed = Math.hypot(st.vel.x, st.vel.z);
  pushes.push(lastPush);
  speeds.push(speed);
  if (i < 20 || i % 10 === 0) {
    console.log(
      `tick ${i} pos=(${st.pos.x.toFixed(4)}, ${st.pos.y.toFixed(4)}, ${st.pos.z.toFixed(4)}) ` +
        `vel=(${st.vel.x.toFixed(5)}, ${st.vel.y.toFixed(5)}, ${st.vel.z.toFixed(5)}) ` +
        `push=${lastPush.toFixed(5)} speedXZ=${speed.toFixed(5)} inWater=${st.isInWater} wh=${(st as any).waterHeight?.toFixed?.(4)}`
    );
  }
  if (st.pos.z > 7.2) {
    console.log(`reached end of channel at tick ${i}`);
    break;
  }
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const n = pushes.length;
const tail = Math.floor(n / 2);
console.log(`--- summary over ${n} ticks ---`);
console.log(`push:  mean=${mean(pushes).toFixed(5)} max=${Math.max(...pushes).toFixed(5)} meanLastHalf=${mean(pushes.slice(tail)).toFixed(5)}`);
console.log(`speed: mean=${mean(speeds).toFixed(5)} max=${Math.max(...speeds).toFixed(5)} meanLastHalf=${mean(speeds.slice(tail)).toFixed(5)}`);
console.log(`targets: push in [0.0100, 0.0140]; sustained speed ~0.039-0.056`);
