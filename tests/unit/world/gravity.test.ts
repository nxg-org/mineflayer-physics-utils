import { afterEach, describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

const version = "1.12.2";
const groundLevel = 67;
const floatingOffset = 100 - groundLevel;

describe("World gravity simulation", () => {
  const fakeWorld = createFlatWorld(version, groundLevel);

  afterEach(() => {
    fakeWorld.clearOverrides();
  });

  it("maintains position when gravity is zero", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel + floatingOffset, 0),
      groundLevel,
    });
    rig.fakePlayer.entity.velocity = new Vec3(0, 0, 0);
    rig.playerState.vel.y = 0;
    rig.playerCtx.gravity = 0;

    for (let i = 0; i < 2; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel + floatingOffset, 0));
  });

  it("restores falling after gravity is re-enabled", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel + floatingOffset, 0),
      groundLevel,
    });
    const originalGravity = rig.playerCtx.gravity;

    rig.fakePlayer.entity.velocity = new Vec3(0, 0, 0);
    rig.playerState.vel.y = 0;
    rig.playerCtx.gravity = 0;

    for (let i = 0; i < 5; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel + floatingOffset, 0));

    rig.playerCtx.gravity = originalGravity;
    while (!rig.fakePlayer.entity.onGround && rig.playerState.age < 100) {
      rig.physics.simulate(rig.playerCtx, fakeWorld as any);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.fakePlayer.entity.position.y).toEqual(groundLevel);
  });
});
