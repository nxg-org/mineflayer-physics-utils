import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

const version = "1.21.4";
const groundLevel = 67;

describe("Botcraft jump cooldown", () => {
  it("keeps jumpTicks while jump is held in the air", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });
    const fakeWorld = createFlatWorld(version, groundLevel) as any;

    rig.playerState.control.jump = true;

    rig.physics.simulate(rig.playerCtx, fakeWorld);
    rig.playerState.apply(rig.fakePlayer);

    expect(rig.playerState.jumpTicks).toBe(rig.playerCtx.worldSettings.autojumpCooldown);
    expect(rig.playerState.onGround).toBe(false);

    rig.physics.simulate(rig.playerCtx, fakeWorld);
    rig.playerState.apply(rig.fakePlayer);

    expect(rig.playerState.jumpTicks).toBe(rig.playerCtx.worldSettings.autojumpCooldown - 1);
    expect(rig.playerState.onGround).toBe(false);
  });
});
