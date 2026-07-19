import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

const waterByMetadata: Record<number, number[][]> = {
  0: [[-1, 0, 2], [-1, 1, 7], [2, 0, 1], [4, 0, 7]],
  1: [[-1, 0, 1], [-1, 0, 5], [-1, 1, 6], [3, 0, 1], [3, 0, 7]],
  2: [[-1, 0, 4], [0, 0, 1], [2, 0, 7], [4, 0, 1]],
  3: [[1, 0, 7], [4, 0, 2]],
  4: [[0, 0, 7], [4, 0, 3]],
  5: [[4, 0, 4]],
  6: [[4, 0, 5]],
  8: [[-1, 0, 6]],
};

const signsByMetadata: Record<number, number[][]> = {
  1: [[-1, 0, 7], [0, 1, 7]],
  3: [[1, 0, 1]],
  5: [[4, 0, 6]],
  7: [[-1, 0, 3]],
};

const packedIce = [
  [-1, -1, 1], [-1, -1, 2], [-1, -1, 3], [-1, -1, 4],
  [-1, -1, 5], [-1, -1, 6], [0, -1, 1], [0, -1, 7],
];

function vec(position: number[]) {
  return new Vec3(position[0], position[1], position[2]);
}

function createCapturedSpawnRig() {
  const rig = createBotcraftPlayerRig({
    version: "1.21.11",
    position: new Vec3(-0.25165264683975, 0, 1.3),
    groundLevel: 0,
  });
  const world = createFlatWorld("1.21.11", 0);
  const blocks = rig.mcData.blocksByName;

  const tintedGlassXZ = new Set<string>();
  for (let z = 0; z <= 8; z++) {
    tintedGlassXZ.add(`-2,${z}`);
    tintedGlassXZ.add(`5,${z}`);
  }
  for (let x = -1; x <= 4; x++) {
    tintedGlassXZ.add(`${x},0`);
    tintedGlassXZ.add(`${x},8`);
  }
  for (let z = 2; z <= 6; z++) {
    tintedGlassXZ.add(`0,${z}`);
    tintedGlassXZ.add(`3,${z}`);
  }
  for (const x of [1, 2]) {
    tintedGlassXZ.add(`${x},2`);
    tintedGlassXZ.add(`${x},6`);
  }
  for (const position of tintedGlassXZ) {
    const [x, z] = position.split(",").map(Number);
    world.setOverrideBlock(new Vec3(x, 0, z), blocks.tinted_glass.id);
    world.setOverrideBlock(new Vec3(x, 1, z), blocks.tinted_glass.id);
  }

  for (const position of packedIce) {
    world.setOverrideBlock(vec(position), blocks.packed_ice.id);
  }
  for (const [metadata, positions] of Object.entries(waterByMetadata)) {
    for (const position of positions) {
      world.setOverrideBlock(vec(position), blocks.water.id, Number(metadata));
    }
  }
  for (const [metadata, positions] of Object.entries(signsByMetadata)) {
    for (const position of positions) {
      world.setOverrideBlock(vec(position), blocks.oak_wall_sign.id, Number(metadata));
    }
  }

  rig.playerState.vel.set(0, 0, 0);
  return { ...rig, world };
}

describe("captured AFK-client spawn", () => {
  it("slides tangentially along tinted glass instead of entering its edge and stalling", () => {
    const { physics, playerCtx, playerState, world } = createCapturedSpawnRig();
    const initialZ = playerState.pos.z;
    let xAtFirstCollision: number | null = null;

    for (let tick = 0; tick < 80; tick++) {
      physics.simulate(playerCtx, world);
      if (xAtFirstCollision == null && playerState.isCollidedHorizontally) {
        xAtFirstCollision = playerState.pos.x;
      }
    }

    expect(xAtFirstCollision).not.toBeNull();
    expect(playerState.pos.z).toBeCloseTo(initialZ, 6);
    expect(playerState.pos.x - xAtFirstCollision!).toBeGreaterThan(0.25);
  });

  it("carries an idle player across the first dry-sign transfer", () => {
    const { physics, playerCtx, playerState, world } = createCapturedSpawnRig();

    for (let tick = 0; tick < 600; tick++) {
      physics.simulate(playerCtx, world);
    }

    // Reaching center x=2.3 means the AABB fully entered the source beyond the sign.
    expect(playerState.pos.x).toBeGreaterThan(2.3);
  });
});
