import { afterEach, describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

const version = "1.12.2";
const groundLevel = 67;
const floatingOffset = 100 - groundLevel;

describe("World movement simulation", () => {
  const fakeWorld = createFlatWorld(version, groundLevel);

  afterEach(() => {
    fakeWorld.clearOverrides();
  });

  it("moves forward correctly with normal gravity", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });

    rig.playerState.control.forward = true;
    rig.playerState.control.sprint = true;

    for (let i = 0; i < 10; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.fakePlayer.entity.position.x).toBe(0);
    expect(rig.fakePlayer.entity.position.y).toBe(groundLevel);
    expect(rig.fakePlayer.entity.position.z).toBeCloseTo(-2.4694803842498265, 8);
  });

  it("supports sprint-jumping", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });

    rig.playerState.control.forward = true;
    rig.playerState.control.sprint = true;

    for (let i = 0; i < 4; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    rig.playerState.control.jump = true;

    for (let i = 0; i < 12; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.fakePlayer.entity.position.y).toEqual(groundLevel);
    expect(rig.fakePlayer.entity.position.z).toBeCloseTo(-4.377196061052951, 8);
  });

  it("matches walking fall-speed travel distance", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel + floatingOffset, 0),
      groundLevel,
    });

    rig.playerState.control.forward = true;

    while (!rig.fakePlayer.entity.onGround && rig.playerState.age < 100) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.fakePlayer.entity.position.z).toBeCloseTo(-5.082680484887672, 8);
    expect(rig.fakePlayer.entity.position.y).toEqual(groundLevel);
  });

  it("matches sprinting fall-speed travel distance", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel + floatingOffset, 0),
      groundLevel,
    });

    rig.playerState.control.forward = true;
    rig.playerState.control.sprint = true;

    while (!rig.fakePlayer.entity.onGround && rig.playerState.age < 100) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.fakePlayer.entity.position.z).toBeCloseTo(-6.607484441009365, 8);
    expect(rig.fakePlayer.entity.position.y).toEqual(groundLevel);
  });

  it("jumps and falls back to the ground", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });

    rig.playerState.control.jump = true;

    for (let i = 0; i < 3; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.fakePlayer.entity.position.y).toEqual(groundLevel + 1.001335979112147);

    for (let i = 0; i < 9; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.fakePlayer.entity.position.y).toEqual(groundLevel);
  });
});
