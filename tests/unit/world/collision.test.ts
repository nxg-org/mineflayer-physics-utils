import { afterEach, describe, it } from "mocha";
import expect from "expect";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld, loadMcData } from "../../helpers/unit/botcraftTestSupport";

const version = "1.12.2";
const groundLevel = 67;

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
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
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
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
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
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
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
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
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
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
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
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.playerState.pos.y).toEqual(groundLevel + 1);
  });
});
