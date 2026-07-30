import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import type { Block as PBlock } from "prismarine-block";
import { blocksMotion } from "../../../src/physics/engines/botcraft";
import { createBotcraftPlayerRig, loadMcData } from "../../helpers/unit/botcraftTestSupport";

/**
 * Parity tests for the vanilla `BlockState.blocksMotion()` port and the `getFlow` fall-through
 * it gates.
 *
 * Ground truth: decompiled 26.2 sources.
 *   BlockBehaviour.java:542  blocksMotion() = block != COBWEB && block != BAMBOO_SAPLING && isSolid()
 *   BlockBehaviour.java:484  calculateSolid() = forceSolidOn -> true, forceSolidOff -> false,
 *                            empty collision shape -> false, else bounds average size >= 0.7291666666666666
 *                            (or ysize >= 1.0)
 *   FlowingFluid.java        getFlow() only falls through to the block BELOW a non-fluid neighbour
 *                            when `!level.getBlockState(pos).blocksMotion()`
 *
 * The engine previously approximated blocksMotion() as `boundingBox === "empty"`, which is wrong
 * for the 138 forceSolidOn blocks (every sign, wall, fence gate, pressure plate, dead coral, ...).
 * That made getFlow take a code path vanilla never takes and produced a flow pointing the wrong
 * way next to a sign.
 */

const version = "26.2";
const floorY = 64;

const { mcData, Block } = loadMcData(version);
const blocksByName = mcData.blocksByName;

/**
 * State offset of a block's DEFAULT state. Not always 0: for a wall sign, offset 0 is the
 * WATERLOGGED state and the default (dry) one is offset 1.
 */
function defaultMeta(name: string): number {
  const data = blocksByName[name] as any;
  if (data == null) throw new Error(`minecraft-data has no block named ${name}`);
  if (data.defaultState == null || data.minStateId == null) return 0;
  return data.defaultState - data.minStateId;
}

function makeBlock(name: string): PBlock {
  const data = blocksByName[name];
  if (data == null) throw new Error(`minecraft-data has no block named ${name}`);
  const b = new Block(data.id, 0, defaultMeta(name));
  b.position = new Vec3(0, floorY, 0);
  return b;
}

describe("Botcraft blocksMotion (vanilla BlockBehaviour parity)", () => {
  it("reports forceSolidOn blocks with an empty collision box as blocking motion", () => {
    // Both are boundingBox "empty" with zero collision shapes, yet vanilla forceSolidOn's them.
    expect(makeBlock("spruce_wall_sign").boundingBox).toBe("empty");
    expect(makeBlock("oak_wall_sign").boundingBox).toBe("empty");

    expect(blocksMotion(makeBlock("spruce_wall_sign"))).toBe(true);
    expect(blocksMotion(makeBlock("oak_wall_sign"))).toBe(true);
  });

  it("excludes cobweb and bamboo_sapling before consulting forceSolidOn", () => {
    // Ordering guard: both ARE in the forceSolidOn list, but blocksMotion() drops them first.
    expect(blocksMotion(makeBlock("cobweb"))).toBe(false);
    expect(blocksMotion(makeBlock("bamboo_sapling"))).toBe(false);
  });

  it("honours forceSolidOff even when the AABB size rule would say solid", () => {
    // ladder's shape is [0, 0, 0.8125, 1, 1, 1] -> average size 2.1875/3 = 0.7291666666666667,
    // which clears the 0.7291666666666666 threshold. Only forceSolidOff keeps it non-solid.
    const ladder = makeBlock("ladder");
    expect(ladder.shapes.length).toBe(1);
    expect((1 + 1 + (1 - 0.8125)) / 3).toBeGreaterThanOrEqual(0.7291666666666666);
    expect(blocksMotion(ladder)).toBe(false);

    expect(blocksMotion(makeBlock("snow"))).toBe(false);
  });

  it("reports non-solid blocks with no collision shape as not blocking motion", () => {
    expect(blocksMotion(makeBlock("water"))).toBe(false);
    expect(blocksMotion(makeBlock("air"))).toBe(false);
  });

  it("reports a full cube as blocking motion via the AABB size rule", () => {
    expect(blocksMotion(makeBlock("stone"))).toBe(true);
  });

  it("strips a namespace prefix off the block name before lookup", () => {
    const sign = makeBlock("spruce_wall_sign");
    (sign as any).name = "minecraft:spruce_wall_sign";
    expect(blocksMotion(sign)).toBe(true);

    const web = makeBlock("cobweb");
    (web as any).name = "minecraft:cobweb";
    expect(blocksMotion(web)).toBe(false);
  });

  it("treats a null or undefined block as not blocking motion", () => {
    expect(blocksMotion(null)).toBe(false);
    expect(blocksMotion(undefined)).toBe(false);
  });
});

class SignWorld {
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

describe("Botcraft getFlow next to a sign", () => {
  it("does not fall through to the water under a dry wall sign", () => {
    // Real farm case. Centre cell is a water SOURCE (meta 0, own height 8/9).
    //   +z neighbour: flowing water meta 1 (own height 7/9) -> legitimate +z gradient of 1/9
    //   -z neighbour: a DRY spruce_wall_sign, with flowing water meta 6 (own height 2/9) BELOW it
    //   +-x neighbours: stone
    //
    // Vanilla: the sign is forceSolidOn, so blocksMotion() is true and the -z neighbour
    // contributes NOTHING. Flow is purely +z.
    //
    // Before the fix the engine saw boundingBox === "empty" and fell through to the water
    // below the sign, adding distance = 8/9 - (2/9 - 0.8888889) = 1.5555556 in the -z
    // direction. That swamped the real +1/9 gradient and flipped the flow to (0, 0, -1).
    const world = new SignWorld();
    world.set(0, floorY, 0, blocksByName.water.id, 0);
    world.set(0, floorY, 1, blocksByName.water.id, 1);
    // offset 1, not 0: offset 0 is the waterlogged sign state.
    world.set(0, floorY, -1, blocksByName.spruce_wall_sign.id, defaultMeta("spruce_wall_sign"));
    world.set(0, floorY - 1, -1, blocksByName.water.id, 6);
    world.set(-1, floorY, 0, blocksByName.stone.id);
    world.set(1, floorY, 0, blocksByName.stone.id);

    // Guard the premise: the sign really is empty-boxed and really is dry.
    const sign = world.getBlock(new Vec3(0, floorY, -1));
    expect(sign.name).toBe("spruce_wall_sign");
    expect(sign.boundingBox).toBe("empty");
    expect(Boolean(sign.getProperties().waterlogged)).toBe(false);

    const rig = createBotcraftPlayerRig({ version, position: new Vec3(0.5, floorY, 0.5), groundLevel: floorY });
    const centre = world.getBlock(new Vec3(0, floorY, 0));
    const flow = rig.physics.getFlow(centre, world as any, true);

    // Pure +z unit flow: no spurious -z component at all.
    expect(flow.z).toBeCloseTo(1, 12);
    expect(flow.x).toBeCloseTo(0, 12);
    expect(flow.y).toBeCloseTo(0, 12);
    expect(flow.z).toBeGreaterThan(0);
  });

  it("still falls through to the water under a genuinely non-solid neighbour", () => {
    // Same geometry but the -z neighbour is air, which does NOT block motion. Vanilla takes
    // the fall-through here, so the -1.5555556 term must still be produced and must still win.
    const world = new SignWorld();
    world.set(0, floorY, 0, blocksByName.water.id, 0);
    world.set(0, floorY, 1, blocksByName.water.id, 1);
    world.set(0, floorY, -1, blocksByName.air.id);
    world.set(0, floorY - 1, -1, blocksByName.water.id, 6);
    world.set(-1, floorY, 0, blocksByName.stone.id);
    world.set(1, floorY, 0, blocksByName.stone.id);

    const rig = createBotcraftPlayerRig({ version, position: new Vec3(0.5, floorY, 0.5), groundLevel: floorY });
    const centre = world.getBlock(new Vec3(0, floorY, 0));
    const flow = rig.physics.getFlow(centre, world as any, true);

    // raw flow.z = 1 * (8/9 - 7/9) + (-1) * (8/9 - (2/9 - 0.8888889)) = -1.4444445 -> normalizes to -1
    expect(flow.z).toBeCloseTo(-1, 12);
    expect(flow.x).toBeCloseTo(0, 12);
  });
});
