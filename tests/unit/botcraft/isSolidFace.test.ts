import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import type { Block as PBlock } from "prismarine-block";
import { isFaceSturdy } from "../../../src/physics/engines/botcraft";
import { createBotcraftPlayerRig, loadMcData } from "../../helpers/unit/botcraftTestSupport";

/**
 * Parity tests for the vanilla `FlowingFluid.isSolidFace` port and the `-6.0` falling-water bias
 * it gates.
 *
 * Ground truth: decompiled 26.2 sources.
 *   FlowingFluid.java:88-96   `if (fluidState.getValue(FALLING)) { for (Direction d : HORIZONTAL) {
 *                              if (isSolidFace(level, p, d) || isSolidFace(level, p.above(), d))
 *                              { flow = flow.normalize().add(0.0, -6.0, 0.0); break; } } }`
 *   FlowingFluid.java:105-115 `isSolidFace` = same-fluid -> false, UP -> true,
 *                              IceBlock -> false, else `state.isFaceSturdy(level, pos, direction)`
 *   BlockBehaviour.java:885   `isFaceSturdy(...)` = `isFaceSturdy(..., SupportType.FULL)`
 *   SupportType.java:13-16    FULL = `Block.isFaceFull(state.getBlockSupportShape(level, pos), dir)`
 *   Block.java:345-352        `isFaceFull` = `isShapeFullBlock(shape.getFaceShape(dir))`
 *   VoxelShape.java:216-230   `calculateFace` slices at 0.9999999 (POSITIVE) / 1.0E-7 (NEGATIVE)
 *
 * The engine previously approximated the whole thing as `boundingBox !== "empty"`, which fires the
 * downward bias next to a slab, a carpet, a trapdoor, a chest and (crucially) plain ice, none of
 * which vanilla treats as a sturdy face.
 */

const version = "26.2";
const floorY = 64;

const { mcData, Block } = loadMcData(version);
const blocksByName = mcData.blocksByName;

function defaultMeta(name: string): number {
  const data = blocksByName[name] as any;
  if (data == null) throw new Error(`minecraft-data has no block named ${name}`);
  if (data.defaultState == null || data.minStateId == null) return 0;
  return data.defaultState - data.minStateId;
}

function makeBlock(name: string, meta?: number): PBlock {
  const data = blocksByName[name];
  if (data == null) throw new Error(`minecraft-data has no block named ${name}`);
  const b = new Block(data.id, 0, meta ?? defaultMeta(name));
  b.position = new Vec3(0, floorY, 0);
  return b;
}

/** State offset of the `snow` block for a given layer count (1-8). */
function snowMetaForLayers(layers: number): number {
  const data = blocksByName.snow as any;
  for (let m = 0; m <= data.maxStateId - data.minStateId; m++) {
    const b = new Block(data.id, 0, m);
    if (Number((b.getProperties() as any).layers) === layers) return m;
  }
  throw new Error(`no snow state with layers=${layers}`);
}

describe("Botcraft isFaceSturdy (vanilla SupportType.FULL parity)", () => {
  it("reports every face of a full cube as sturdy", () => {
    const stone = makeBlock("stone");
    expect(stone.shapes).toEqual([[0, 0, 0, 1, 1, 1]]);
    for (const axis of [0, 1, 2] as const) {
      expect(isFaceSturdy(stone, axis, true)).toBe(true);
      expect(isFaceSturdy(stone, axis, false)).toBe(true);
    }
  });

  it("reports a bottom slab as sturdy only on its DOWN face", () => {
    // Collision shape [0,0,0,1,0.5,1]. The slice at 0.9999999 along X/Y/Z is empty or partial;
    // only the slice at 1.0E-7 along Y covers the whole unit face.
    const slab = makeBlock("oak_slab");
    expect(slab.shapes).toEqual([[0, 0, 0, 1, 0.5, 1]]);
    expect(isFaceSturdy(slab, 1, false)).toBe(true); // DOWN
    expect(isFaceSturdy(slab, 1, true)).toBe(false); // UP
    expect(isFaceSturdy(slab, 0, true)).toBe(false); // EAST
    expect(isFaceSturdy(slab, 0, false)).toBe(false); // WEST
    expect(isFaceSturdy(slab, 2, true)).toBe(false); // SOUTH
    expect(isFaceSturdy(slab, 2, false)).toBe(false); // NORTH
  });

  it("reports a carpet as sturdy only on its DOWN face despite a non-empty boundingBox", () => {
    // This is the exact case the old `boundingBox !== "empty"` test got wrong.
    const carpet = makeBlock("white_carpet");
    expect(carpet.boundingBox).toBe("block");
    expect(carpet.shapes).toEqual([[0, 0, 0, 1, 0.0625, 1]]);
    expect(isFaceSturdy(carpet, 1, false)).toBe(true);
    expect(isFaceSturdy(carpet, 0, true)).toBe(false);
    expect(isFaceSturdy(carpet, 2, true)).toBe(false);
  });

  it("unions multiple collision boxes when deciding a face (north-facing stair)", () => {
    // [[0,0,0,1,0.5,1], [0,0.5,0,1,1,0.5]]. The NORTH face is covered by both halves stacked;
    // the SOUTH face only by the lower one; the EAST face has a missing top-south quadrant.
    // A per-box test would get NORTH wrong - only the union sweep gets it right.
    const stairs = makeBlock("oak_stairs");
    expect((stairs.getProperties() as any).facing).toBe("north");
    expect(stairs.shapes.length).toBe(2);
    expect(isFaceSturdy(stairs, 2, false)).toBe(true); // NORTH: full
    expect(isFaceSturdy(stairs, 2, true)).toBe(false); // SOUTH: bottom half only
    expect(isFaceSturdy(stairs, 0, true)).toBe(false); // EAST: L-shaped
    expect(isFaceSturdy(stairs, 0, false)).toBe(false); // WEST: L-shaped
    expect(isFaceSturdy(stairs, 1, false)).toBe(true); // DOWN: full
    expect(isFaceSturdy(stairs, 1, true)).toBe(false); // UP: back half only
  });

  it("honours the getBlockSupportShape overrides that contradict the collision shape", () => {
    // soul_sand/mud collide as a 14/16 column (SoulSandBlock.java:15) but support as a FULL cube
    // (SoulSandBlock.java:32-34), so every face is sturdy.
    const soulSand = makeBlock("soul_sand");
    expect(soulSand.shapes).toEqual([[0, 0, 0, 1, 0.875, 1]]);
    expect(isFaceSturdy(soulSand, 0, true)).toBe(true);
    expect(isFaceSturdy(makeBlock("mud"), 2, false)).toBe(true);

    // leaves collide as a full cube but support as Shapes.empty() (LeavesBlock.java:57-59).
    const leaves = makeBlock("oak_leaves");
    expect(leaves.shapes).toEqual([[0, 0, 0, 1, 1, 1]]);
    expect(isFaceSturdy(leaves, 0, true)).toBe(false);
    expect(isFaceSturdy(makeBlock("flowering_azalea_leaves"), 1, false)).toBe(false);

    // snow supports on SHAPES[layers] while it collides on SHAPES[layers - 1]
    // (SnowLayerBlock.java:52-58), so only layers == 8 gives a sturdy horizontal face.
    expect(isFaceSturdy(makeBlock("snow", snowMetaForLayers(8)), 0, true)).toBe(true);
    expect(isFaceSturdy(makeBlock("snow", snowMetaForLayers(7)), 0, true)).toBe(false);
    expect(isFaceSturdy(makeBlock("snow", snowMetaForLayers(1)), 0, true)).toBe(false);
  });

  it("reports blocks with no collision shape as never sturdy", () => {
    expect(isFaceSturdy(makeBlock("air"), 0, true)).toBe(false);
    expect(isFaceSturdy(makeBlock("water"), 1, true)).toBe(false);
    expect(isFaceSturdy(makeBlock("spruce_wall_sign"), 0, true)).toBe(false);
    expect(isFaceSturdy(null, 0, true)).toBe(false);
    expect(isFaceSturdy(undefined, 0, true)).toBe(false);
  });
});

class TestWorld {
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

function rigPhysics() {
  return createBotcraftPlayerRig({ version, position: new Vec3(0.5, floorY, 0.5), groundLevel: floorY }).physics;
}

describe("Botcraft isSolidFace (vanilla FlowingFluid parity)", () => {
  it("returns false for a position holding the SAME fluid, before the UP arm can fire", () => {
    // Ordering guard. Vanilla checks `fluidState.getType().isSame(this)` FIRST, so a water cell
    // probed with direction UP is NOT a solid face even though `direction == UP` returns true for
    // everything else.
    const world = new TestWorld();
    world.set(0, floorY, 0, blocksByName.water.id, 0);
    world.set(0, floorY, 1, blocksByName.kelp_plant.id);

    const physics = rigPhysics();
    expect(physics.isSolidFace(world as any, new Vec3(0, floorY, 0), 1, true, true)).toBe(false);
    expect(physics.isSolidFace(world as any, new Vec3(0, floorY, 0), 0, true, true)).toBe(false);
    // kelp_plant carries a water FluidState in vanilla, so it is "the same fluid" too.
    expect(physics.isSolidFace(world as any, new Vec3(0, floorY, 1), 0, true, true)).toBe(false);
    // ...but it is NOT the same fluid when the flow being solved is LAVA.
    expect(physics.isSolidFace(world as any, new Vec3(0, floorY, 0), 1, true, false)).toBe(true);
  });

  it("returns true for direction UP regardless of the block's shape", () => {
    const world = new TestWorld();
    world.set(0, floorY, 0, blocksByName.air.id);
    world.set(0, floorY, 1, blocksByName.white_carpet.id);

    const physics = rigPhysics();
    expect(physics.isSolidFace(world as any, new Vec3(0, floorY, 0), 1, true, true)).toBe(true);
    expect(physics.isSolidFace(world as any, new Vec3(0, floorY, 1), 1, true, true)).toBe(true);
    // DOWN is not short-circuited: air has no shape.
    expect(physics.isSolidFace(world as any, new Vec3(0, floorY, 0), 1, false, true)).toBe(false);
  });

  it("returns false for IceBlock instances but true for packed/blue ice", () => {
    // 26.2: ICE -> IceBlock (Blocks.java:1945), FROSTED_ICE -> FrostedIceBlock extends IceBlock
    // (Blocks.java:3727 + FrostedIceBlock.java:22). PACKED_ICE registers a plain Block
    // (Blocks.java:3019) and BLUE_ICE a HalfTransparentBlock (Blocks.java:4224), so neither is an
    // IceBlock and both DO give a sturdy face.
    const world = new TestWorld();
    world.set(0, floorY, 0, blocksByName.ice.id);
    world.set(1, floorY, 0, blocksByName.frosted_ice.id);
    world.set(2, floorY, 0, blocksByName.packed_ice.id);
    world.set(3, floorY, 0, blocksByName.blue_ice.id);

    const physics = rigPhysics();
    expect(physics.isSolidFace(world as any, new Vec3(0, floorY, 0), 0, true, true)).toBe(false);
    expect(physics.isSolidFace(world as any, new Vec3(1, floorY, 0), 0, true, true)).toBe(false);
    expect(physics.isSolidFace(world as any, new Vec3(2, floorY, 0), 0, true, true)).toBe(true);
    expect(physics.isSolidFace(world as any, new Vec3(3, floorY, 0), 0, true, true)).toBe(true);
    // The IceBlock arm runs AFTER the UP arm, so ice probed with UP is still a solid face.
    expect(physics.isSolidFace(world as any, new Vec3(0, floorY, 0), 1, true, true)).toBe(true);
  });

  it("treats an unloaded (null) neighbour as not solid", () => {
    const nullWorld = { getBlock: () => null };
    const physics = rigPhysics();
    expect(physics.isSolidFace(nullWorld as any, new Vec3(0, floorY, 0), 0, true, true)).toBe(false);
  });
});

describe("Botcraft getFlow falling-water bias", () => {
  /**
   * Centre cell is FALLING water (level 8). All four horizontal neighbours are also falling water
   * except -z, which is the block under test, so the horizontal gradient is exactly zero and
   * `flow.y` isolates the `-6.0` bias:
   *   bias fires  -> normalize(0,0,0) = (0,0,0), +(0,-6,0), normalize -> (0,-1,0)
   *   no bias     -> (0,0,0)
   */
  function flowYWith(neighbour: { name: string; meta?: number } | null, above?: { name: string; meta?: number }) {
    const world = new TestWorld();
    world.set(0, floorY, 0, blocksByName.water.id, 8);
    world.set(0, floorY, 1, blocksByName.water.id, 8);
    world.set(1, floorY, 0, blocksByName.water.id, 8);
    world.set(-1, floorY, 0, blocksByName.water.id, 8);
    if (neighbour == null) {
      world.set(0, floorY, -1, blocksByName.water.id, 8);
    } else {
      const data = blocksByName[neighbour.name] as any;
      world.set(0, floorY, -1, data.id, neighbour.meta ?? (data.defaultState - data.minStateId || 0));
    }
    if (above != null) {
      const data = blocksByName[above.name] as any;
      world.set(0, floorY + 1, -1, data.id, above.meta ?? (data.defaultState - data.minStateId || 0));
    }

    const physics = rigPhysics();
    const centre = world.getBlock(new Vec3(0, floorY, 0));
    expect(centre.metadata).toBeGreaterThanOrEqual(8); // premise: the FALLING branch is reachable
    const flow = physics.getFlow(centre, world as any, true);
    expect(flow.x).toBeCloseTo(0, 12);
    expect(flow.z).toBeCloseTo(0, 12);
    return flow.y;
  }

  it("fires the -6.0 bias next to a genuinely sturdy face", () => {
    expect(flowYWith({ name: "stone" })).toBeCloseTo(-1, 12);
  });

  it("does NOT fire next to a slab, a carpet or a trapdoor", () => {
    // All three report `boundingBox === "block"`, so the old code fired the bias on every one.
    expect(makeBlock("oak_slab").boundingBox).toBe("block");
    expect(makeBlock("white_carpet").boundingBox).toBe("block");
    expect(makeBlock("oak_trapdoor").boundingBox).toBe("block");
    expect(flowYWith({ name: "oak_slab" })).toBe(0);
    expect(flowYWith({ name: "white_carpet" })).toBe(0);
    expect(flowYWith({ name: "oak_trapdoor" })).toBe(0);
  });

  it("does NOT fire next to ice, but DOES fire next to blue ice", () => {
    // The operator's farms use blue_ice floors: it must keep behaving like a solid face.
    expect(flowYWith({ name: "ice" })).toBe(0);
    expect(flowYWith({ name: "frosted_ice" })).toBe(0);
    expect(flowYWith({ name: "blue_ice" })).toBeCloseTo(-1, 12);
    expect(flowYWith({ name: "packed_ice" })).toBeCloseTo(-1, 12);
  });

  it("does NOT fire when every neighbour is the same fluid", () => {
    expect(flowYWith(null)).toBe(0);
  });

  it("still probes the block ABOVE the neighbour with the SAME horizontal direction", () => {
    // Vanilla's second call is `isSolidFace(level, blockPos.above(), direction)` - `direction` is
    // the horizontal one, NOT UP. A sturdy block one cell up from an air neighbour must fire the
    // bias; a slab up there must not (it would if the call had been collapsed to UP, since
    // `direction == UP` returns true for everything).
    expect(flowYWith({ name: "air" }, { name: "stone" })).toBeCloseTo(-1, 12);
    expect(flowYWith({ name: "air" }, { name: "oak_slab" })).toBe(0);
    expect(flowYWith({ name: "air" }, { name: "white_carpet" })).toBe(0);
  });

  it("does not fire the bias at all for a non-falling (source) water cell", () => {
    // `fluidState.getValue(FALLING)` gate: level 0 is a source, so the whole branch is skipped.
    const world = new TestWorld();
    world.set(0, floorY, 0, blocksByName.water.id, 0);
    world.set(0, floorY, 1, blocksByName.water.id, 0);
    world.set(1, floorY, 0, blocksByName.water.id, 0);
    world.set(-1, floorY, 0, blocksByName.water.id, 0);
    world.set(0, floorY, -1, blocksByName.stone.id);

    const physics = rigPhysics();
    const flow = physics.getFlow(world.getBlock(new Vec3(0, floorY, 0)), world as any, true);
    expect(flow.y).toBe(0);
  });
});
