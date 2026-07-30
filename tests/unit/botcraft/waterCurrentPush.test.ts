import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import type { Block as PBlock } from "prismarine-block";
import { createBotcraftPlayerRig, loadMcData } from "../../helpers/unit/botcraftTestSupport";

/**
 * Water-current push parity tests.
 *
 * Ground truth: a real 26.2 client trace captured in a flowing water channel
 * (physics-trace.jsonl, 1327 in-water ticks) plus the decompiled 26.2 sources
 * (EntityFluidInteraction.update / Tracker.applyCurrentTo, FlowingFluid.getFlow).
 * The real client measured, per fluid height (running max, deflated-box relative):
 *   height 0.3323 -> push 0.00465 (= 0.014 * height, shallow < 0.4 scaling)
 *   height >= 0.4434 -> push 0.01400 (full scale)
 *   terminal drift speed 0.05600 (= 0.014 * 0.8 / 0.2 with the 0.8 water drag)
 * The engine must reproduce these exactly; a prior report of ~0.004-0.006 sustained
 * drift is NOT vanilla and must never come back.
 */

const version = "26.2";
const floorY = 64;

const { mcData, Block } = loadMcData(version);
const blocksByName = mcData.blocksByName;

class ChannelWorld {
  private readonly overrides = new Map<string, { type: number; meta: number }>();

  set(x: number, y: number, z: number, type: number, meta = 0) {
    this.overrides.set(`${x},${y},${z}`, { type, meta });
  }

  getBlock(pos: Vec3): PBlock {
    const p = pos.floored();
    const o = this.overrides.get(`${p.x},${p.y},${p.z}`);
    const type = o ? o.type : p.y < floorY ? blocksByName.stone.id : blocksByName.air.id;
    const b = new Block(type, 0, o ? o.meta : 0);
    b.position = p;
    return b;
  }
}

/** source (meta 0) at z=0, flowing meta 1..7 at z=1..7, stone walls at x=+-1. */
function buildFlowingChannel(): ChannelWorld {
  const world = new ChannelWorld();
  for (let z = 0; z <= 7; z++) {
    world.set(0, floorY, z, blocksByName.water.id, z);
    world.set(-1, floorY, z, blocksByName.stone.id);
    world.set(1, floorY, z, blocksByName.stone.id);
  }
  world.set(0, floorY, -1, blocksByName.stone.id);
  return world;
}

function makeRig(position: Vec3) {
  const rig = createBotcraftPlayerRig({ version, position, groundLevel: floorY });
  return rig;
}

/** Wraps fluidPhysics(water) to capture the velocity delta it applies each tick. */
function captureWaterPush(rig: ReturnType<typeof createBotcraftPlayerRig>) {
  const captured = { push: new Vec3(0, 0, 0) };
  const physicsAny = rig.physics as any;
  const orig = physicsAny.fluidPhysics.bind(rig.physics);
  physicsAny.fluidPhysics = function (ctx: any, world: any, isWater: boolean) {
    if (!isWater) return orig(ctx, world, isWater);
    const before = ctx.state.vel.clone();
    orig(ctx, world, isWater);
    captured.push = ctx.state.vel.minus(before);
  };
  return captured;
}

describe("Botcraft water current push", () => {
  it("applies the full 0.014 push and reaches the vanilla 0.056 terminal drift speed", () => {
    const world = buildFlowingChannel();
    const rig = makeRig(new Vec3(0.5, floorY, 1.5));
    const captured = captureWaterPush(rig);

    const pushes: number[] = [];
    for (let i = 0; i < 50; i++) {
      rig.physics.simulate(rig.playerCtx, world as any);
      rig.playerState.apply(rig.fakePlayer);
      pushes.push(Math.hypot(captured.push.x, captured.push.z));
    }

    // Developed flow (fluid height >= 0.4): every tick pushes the full 0.014.
    for (const p of pushes) {
      expect(p).toBeCloseTo(0.014, 10);
      expect(p).toBeGreaterThanOrEqual(0.01);
      expect(p).toBeLessThanOrEqual(0.014 + 1e-12);
    }

    // Terminal speed 0.014 * 0.8 / 0.2 = 0.056 (real client trace max: 0.05600).
    const speed = Math.hypot(rig.playerState.vel.x, rig.playerState.vel.z);
    expect(speed).toBeGreaterThan(0.039);
    expect(speed).toBeCloseTo(0.056, 4);
    // And the bot actually travels (real client: 6.91 blocks over its run).
    expect(rig.playerState.pos.z).toBeGreaterThan(4.0);
  });

  it("scales the push by the fluid height below 0.4 (real-client 0.00465 at height 0.3323)", () => {
    // mini channel so the level-5 cell (own height 3/9) has a +z gradient
    const world = new ChannelWorld();
    const levels = [4, 5, 6];
    for (let z = 0; z <= 2; z++) {
      world.set(0, floorY, z, blocksByName.water.id, levels[z]);
      world.set(-1, floorY, z, blocksByName.stone.id);
      world.set(1, floorY, z, blocksByName.stone.id);
    }
    const rig = makeRig(new Vec3(0.5, floorY, 1.5));
    const captured = captureWaterPush(rig);

    rig.physics.simulate(rig.playerCtx, world as any);

    // height = 3/9 - 0.001 (deflated box) = 0.332333...; push = 0.014 * height.
    expect((rig.playerState as any).waterHeight).toBeCloseTo(3 / 9 - 0.001, 10);
    expect(captured.push.z).toBeCloseTo(0.014 * (3 / 9 - 0.001), 10);
    expect(captured.push.x).toBeCloseTo(0, 12);
  });

  it("applies the 0.0045 anti-stall floor when nearly still in very shallow flow", () => {
    // level-6 cell (own height 2/9): impulse 0.014 * 0.2212 = 0.0031 < 0.0045 -> floored.
    const world = new ChannelWorld();
    const levels = [5, 6, 7];
    for (let z = 0; z <= 2; z++) {
      world.set(0, floorY, z, blocksByName.water.id, levels[z]);
      world.set(-1, floorY, z, blocksByName.stone.id);
      world.set(1, floorY, z, blocksByName.stone.id);
    }
    const rig = makeRig(new Vec3(0.5, floorY, 1.5));
    const captured = captureWaterPush(rig);

    rig.physics.simulate(rig.playerCtx, world as any);

    expect(captured.push.z).toBeCloseTo(0.0045000000000000005, 12);
    expect(captured.push.x).toBeCloseTo(0, 12);
  });

  it("keeps drifting in deep two-layer water with a falling bottom layer", () => {
    // farm-like deep section: falling water (meta 8) at floor level, flowing 1..7 above it
    const world = new ChannelWorld();
    for (let z = 0; z <= 7; z++) {
      world.set(0, floorY, z, blocksByName.water.id, 8);
      if (z >= 1) world.set(0, floorY + 1, z, blocksByName.water.id, z);
      for (const y of [floorY, floorY + 1]) {
        world.set(-1, y, z, blocksByName.stone.id);
        world.set(1, y, z, blocksByName.stone.id);
      }
    }
    world.set(0, floorY + 1, 0, blocksByName.water.id, 0);
    world.set(0, floorY, -1, blocksByName.stone.id);
    world.set(0, floorY + 1, -1, blocksByName.stone.id);

    const rig = makeRig(new Vec3(0.5, floorY + 0.5, 1.5));
    const captured = captureWaterPush(rig);

    const horizPushes: number[] = [];
    for (let i = 0; i < 80; i++) {
      rig.physics.simulate(rig.playerCtx, world as any);
      rig.playerState.apply(rig.fakePlayer);
      horizPushes.push(Math.hypot(captured.push.x, captured.push.z));
    }

    // Bottom falling cell contributes (0,-1,0) (wall-face bias), top cell a unit
    // horizontal flow; the player average halves the horizontal push to ~0.007
    // (real-client deep rows: 0.007..0.014, mean ~0.0099).
    const meanPush = horizPushes.reduce((s, x) => s + x, 0) / horizPushes.length;
    expect(meanPush).toBeGreaterThan(0.006);
    expect(meanPush).toBeLessThanOrEqual(0.014 + 1e-12);

    // No stall: sustained speed and real travel down the channel.
    const speed = Math.hypot(rig.playerState.vel.x, rig.playerState.vel.z);
    expect(speed).toBeGreaterThan(0.02);
    expect(rig.playerState.pos.z).toBeGreaterThan(3.0);
  });

  it("excludes the cell layer beyond an exactly-integral box edge (vanilla ceil(max)-1)", () => {
    // This exact double makes the deflated box maxX === 2.0 under the engine's op order
    // ((0.3 + posX) + (-0.001)): vanilla iterates floor(min)..ceil(max)-1, so only column
    // x=1 is scanned. The old floor(max) bound also scanned column x=2, whose opposing
    // -z channel cancelled the +z flow and produced zero push.
    const posX = 1.7009999999999998;
    expect(0.3 + posX + -0.001).toBe(2.0); // guard: the boundary case really triggers

    const world = new ChannelWorld();
    for (let z = 0; z <= 3; z++) {
      world.set(1, floorY, z, blocksByName.water.id, z); // +z flow
      world.set(2, floorY, z, blocksByName.water.id, 3 - z); // -z flow
      world.set(0, floorY, z, blocksByName.stone.id);
      world.set(3, floorY, z, blocksByName.stone.id);
    }
    world.set(1, floorY, -1, blocksByName.stone.id);
    world.set(2, floorY, 4, blocksByName.stone.id);

    const rig = makeRig(new Vec3(posX, floorY, 1.5));
    const captured = captureWaterPush(rig);

    rig.physics.simulate(rig.playerCtx, world as any);

    // Only cell (1,64,1) is inside the box. Its flow is (1,0,2)/sqrt(5) (the +z gradient
    // plus the cross-gradient toward the lower neighbouring channel at x=2), so the push
    // is 0.014 * (0.4472, 0, 0.8944).
    expect(captured.push.z).toBeCloseTo(0.014 * (2 / Math.sqrt(5)), 10);
    expect(captured.push.x).toBeCloseTo(0.014 * (1 / Math.sqrt(5)), 10);
  });
});
