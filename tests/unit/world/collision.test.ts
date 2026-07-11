import { afterEach, describe, it } from "mocha";
import expect from "expect";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld, loadMcData } from "../../helpers/unit/botcraftTestSupport";

const version = "1.12.2";
const groundLevel = 67;
const CONTACT_EPSILON = 1e-7;
const PLAYER_HALF_WIDTH = 0.3;

function simulateTicks(
  rig: ReturnType<typeof createBotcraftPlayerRig>,
  fakeWorld: ReturnType<typeof createFlatWorld>,
  ticks: number,
) {
  for (let i = 0; i < ticks; i++) {
    rig.physics.simulate(rig.playerCtx, fakeWorld);
    rig.playerState.apply(rig.fakePlayer);
  }
}

function assertContactPosition(actual: number, expected: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(CONTACT_EPSILON);
}

describe("World collision simulation", () => {
  const { mcData } = loadMcData(version);
  const fakeWorld = createFlatWorld(version, groundLevel);

  afterEach(() => {
    fakeWorld.clearOverrides();
  });

  it("collides horizontally moving toward negative z", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });

    fakeWorld.setOverrideBlock(new Vec3(0, groundLevel + 1, -2), mcData.blocksByName.dirt.id);
    rig.playerState.look(0, 0);
    rig.playerState.control.forward = true;

    for (let i = 0; i < 10; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.playerState.pos.z).toEqual(-0.7);
    expect(rig.playerState.isCollidedHorizontally).toEqual(true);
  });

  it("collides horizontally moving toward positive z", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });

    fakeWorld.setOverrideBlock(new Vec3(0, groundLevel + 1, 1), mcData.blocksByName.dirt.id);
    rig.playerState.look(-359.9999 * (Math.PI / 360), 0);
    rig.playerState.control.forward = true;

    for (let i = 0; i < 10; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.playerState.pos.z).toEqual(0.7);
    expect(rig.playerState.isCollidedHorizontally).toEqual(true);
  });

  it("collides horizontally moving toward negative x", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });

    fakeWorld.setOverrideBlock(new Vec3(-2, groundLevel + 1, 0), mcData.blocksByName.dirt.id);
    rig.playerState.look(180 * (Math.PI / 360), 0);
    rig.playerState.control.forward = true;

    for (let i = 0; i < 10; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.playerState.pos.x).toEqual(-0.7);
    expect(rig.playerState.isCollidedHorizontally).toEqual(true);
  });

  it("collides horizontally moving toward positive x", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });

    fakeWorld.setOverrideBlock(new Vec3(1, groundLevel + 1, 0), mcData.blocksByName.dirt.id);
    rig.playerState.look(-180 * (Math.PI / 360), 0);
    rig.playerState.control.forward = true;

    for (let i = 0; i < 10; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.playerState.pos.x).toEqual(0.7);
    expect(rig.playerState.isCollidedHorizontally).toEqual(true);
  });

  it("does not push through a block while jumping into it", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });

    fakeWorld.setOverrideBlock(new Vec3(0, groundLevel + 1, 1), mcData.blocksByName.dirt.id);
    rig.fakePlayer.entity.position = new Vec3(0.5, groundLevel, 0.7);
    rig.playerState.pos = rig.fakePlayer.entity.position.clone();
    rig.playerState.look(-359.9999 * (Math.PI / 360), 0);
    rig.playerState.control.jump = true;
    rig.playerState.control.forward = true;
    rig.playerState.control.sprint = true;

    for (let i = 0; i < 12; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.playerState.pos.z).toEqual(0.7);
    expect(rig.playerState.isCollidedHorizontally).toEqual(true);
  });

  it("walks up stairs", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });

    const stairPos = new Vec3(0, groundLevel, -1);
    fakeWorld.setOverrideBlock(stairPos, mcData.blocksByName.stone_stairs.id);

    const shapes = fakeWorld.getBlock(stairPos).shapes;
    shapes.map((shape) => AABB.fromShape(shape, stairPos));

    rig.fakePlayer.entity.position = new Vec3(-0.3, groundLevel, -0.5);
    rig.playerState.pos = rig.fakePlayer.entity.position.clone();
    rig.playerState.look(-180 * (Math.PI / 360), 0);
    rig.playerState.control.forward = true;
    rig.playerState.control.sprint = true;

    for (let i = 0; i < 4; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.playerState.pos.y).toEqual(groundLevel + 1);
  });

  it("does not pass through a block at coordinate boundary z=32 when moving toward negative z", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0.5, groundLevel, 32.51),
      groundLevel,
    });

    fakeWorld.setOverrideBlock(new Vec3(0, groundLevel, 31), mcData.blocksByName.dirt.id);
    rig.fakePlayer.entity.position = new Vec3(0.5, groundLevel, 32.51);
    rig.playerState.pos = rig.fakePlayer.entity.position.clone();
    rig.playerState.look(0, 0);
    rig.playerState.control.forward = true;

    simulateTicks(rig, fakeWorld, 12);

    const expectedContactZ = 32 + PLAYER_HALF_WIDTH;
    assertContactPosition(rig.playerState.pos.z, expectedContactZ);
    expect(rig.playerState.pos.z).toBeGreaterThan(32);
    expect(rig.playerState.isCollidedHorizontally).toEqual(true);
  });

  const boundaryCases = [
    { boundary: 2, axis: "z" as const },
    { boundary: 32, axis: "z" as const },
    { boundary: -2, axis: "z" as const },
    { boundary: -32, axis: "z" as const },
    { boundary: 2, axis: "x" as const },
    { boundary: 32, axis: "x" as const },
    { boundary: -2, axis: "x" as const },
    { boundary: -32, axis: "x" as const },
  ];

  for (const { boundary, axis } of boundaryCases) {
    const positiveBoundary = boundary > 0;

    it(`holds contact at boundary ${boundary} on ${axis} when moving toward block from the ${positiveBoundary ? "positive" : "negative"} side`, () => {
      const rig = createBotcraftPlayerRig({
        version,
        position: new Vec3(0.5, groundLevel, 0.5),
        groundLevel,
      });

      let playerPos: Vec3;
      let blockPos: Vec3;
      let expectedContact: number;

      if (axis === "z") {
        if (positiveBoundary) {
          blockPos = new Vec3(0, groundLevel, boundary - 1);
          playerPos = new Vec3(0.5, groundLevel, boundary + 0.51);
          expectedContact = boundary + PLAYER_HALF_WIDTH;
          rig.playerState.look(0, 0);
        } else {
          blockPos = new Vec3(0, groundLevel, boundary);
          playerPos = new Vec3(0.5, groundLevel, boundary - 0.51);
          expectedContact = boundary - PLAYER_HALF_WIDTH;
          rig.playerState.look(-359.9999 * (Math.PI / 360), 0);
        }
      } else if (positiveBoundary) {
        blockPos = new Vec3(boundary - 1, groundLevel, 0);
        playerPos = new Vec3(boundary + 0.51, groundLevel, 0.5);
        expectedContact = boundary + PLAYER_HALF_WIDTH;
        rig.playerState.look(180 * (Math.PI / 360), 0);
      } else {
        blockPos = new Vec3(boundary, groundLevel, 0);
        playerPos = new Vec3(boundary - 0.51, groundLevel, 0.5);
        expectedContact = boundary - PLAYER_HALF_WIDTH;
        rig.playerState.look(-180 * (Math.PI / 360), 0);
      }

      fakeWorld.setOverrideBlock(blockPos, mcData.blocksByName.dirt.id);
      rig.fakePlayer.entity.position = playerPos.clone();
      rig.playerState.pos = playerPos.clone();
      rig.playerState.control.forward = true;

      simulateTicks(rig, fakeWorld, 12);

      const actualContact = axis === "z" ? rig.playerState.pos.z : rig.playerState.pos.x;
      assertContactPosition(actualContact, expectedContact);
      expect(rig.playerState.isCollidedHorizontally).toEqual(true);

      const beforeSecondPass = actualContact;
      simulateTicks(rig, fakeWorld, 6);
      const afterSecondPass = axis === "z" ? rig.playerState.pos.z : rig.playerState.pos.x;
      assertContactPosition(afterSecondPass, expectedContact);
      expect(Math.abs(afterSecondPass - beforeSecondPass)).toBeLessThanOrEqual(CONTACT_EPSILON);
    });
  }

  it("slides along a wall without penetrating it on coordinate boundary z=32", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0.5, groundLevel, 32.51),
      groundLevel,
    });

    for (let x = -3; x <= 3; x++) {
      fakeWorld.setOverrideBlock(new Vec3(x, groundLevel, 31), mcData.blocksByName.dirt.id);
    }
    rig.fakePlayer.entity.position = new Vec3(0.5, groundLevel, 32.51);
    rig.playerState.pos = rig.fakePlayer.entity.position.clone();
    rig.playerState.look(0, 0);
    rig.playerState.control.forward = true;

    simulateTicks(rig, fakeWorld, 8);

    const expectedContactZ = 32 + PLAYER_HALF_WIDTH;
    assertContactPosition(rig.playerState.pos.z, expectedContactZ);

    const settledZ = rig.playerState.pos.z;
    const startX = rig.playerState.pos.x;
    rig.playerState.control.left = true;

    simulateTicks(rig, fakeWorld, 8);

    assertContactPosition(rig.playerState.pos.z, settledZ);
    expect(Math.abs(rig.playerState.pos.x - startX)).toBeGreaterThan(0.01);
    expect(rig.playerState.isCollidedHorizontally).toEqual(true);
  });
});
