import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld, loadMcData } from "../../helpers/unit/botcraftTestSupport";

const version = "1.21.11";
const ICE_FRICTION = Math.fround(Math.fround(0.98) * Math.fround(0.91));

describe("Botcraft supporting block", () => {
  it("picks the block under the feet, not a wall the player touches", () => {
    const { mcData, physics, playerCtx, playerState } = createBotcraftPlayerRig({
      version,
      // the hitbox's +z face is flush with the wall at z = 1
      position: new Vec3(0.5, 0, 1 - playerStateHalfWidth()),
    });
    const world = createFlatWorld(version, 0);
    for (let x = -1; x <= 40; x++) {
      world.setOverrideBlock(new Vec3(x, -1, 0), mcData.blocksByName.ice.id);
      world.setOverrideBlock(new Vec3(x, 0, 1), mcData.blocksByName.stone.id);
      world.setOverrideBlock(new Vec3(x, 1, 1), mcData.blocksByName.stone.id);
    }

    let expectedVelocity = 0.2;
    playerState.vel.set(expectedVelocity, 0, 0);
    for (let tick = 0; tick < 10; tick++) {
      expectedVelocity *= ICE_FRICTION;
      physics.simulate(playerCtx, world);
      expect(playerState.supportingBlockPos).toEqual(new Vec3(Math.floor(playerState.pos.x), -1, 0));
      expect(playerState.vel.x).toBe(expectedVelocity);
    }
  });

  it("takes friction from the block below a slab (getOnPos(0.500001F))", () => {
    const { mcData, Block } = loadMcData(version);
    const slab = (Block as any).fromProperties("stone_slab", { type: "bottom", waterlogged: false });
    const slabMeta = slab.stateId - mcData.blocksByName.stone_slab.minStateId;
    const { physics, playerCtx, playerState } = createBotcraftPlayerRig({ version, position: new Vec3(0.5, 0.5, 0.5) });
    const world = createFlatWorld(version, 0);
    for (let x = -1; x <= 40; x++) {
      world.setOverrideBlock(new Vec3(x, -1, 0), mcData.blocksByName.ice.id);
      world.setOverrideBlock(new Vec3(x, 0, 0), mcData.blocksByName.stone_slab.id, slabMeta);
    }

    let expectedVelocity = 0.2;
    playerState.vel.set(expectedVelocity, 0, 0);
    for (let tick = 0; tick < 10; tick++) {
      expectedVelocity *= ICE_FRICTION;
      physics.simulate(playerCtx, world);
      expect(playerState.supportingBlockPos).toEqual(new Vec3(Math.floor(playerState.pos.x), 0, 0));
      expect(playerState.vel.x).toBe(expectedVelocity);
    }
  });

  it("breaks distance ties toward the greater BlockPos (y, then z, then x)", () => {
    // standing exactly on the shared corner of four blocks: all four are equally close
    const { physics, playerCtx, playerState } = createBotcraftPlayerRig({ version, position: new Vec3(1, 0, 1) });
    const world = createFlatWorld(version, 0);
    physics.simulate(playerCtx, world);
    expect(playerState.onGround).toBe(true);
    expect(playerState.supportingBlockPos).toEqual(new Vec3(1, -1, 1));
  });
});

function playerStateHalfWidth() {
  return Math.fround(0.6) / 2;
}
