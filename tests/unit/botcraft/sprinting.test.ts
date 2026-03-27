import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

const version = "1.21.4";
const groundLevel = 67;

function createFallFlyingRig(sprint: boolean) {
  const rig = createBotcraftPlayerRig({
    version,
    position: new Vec3(0, groundLevel + 10, 0),
    groundLevel,
  });

  rig.playerState.control.forward = true;
  rig.playerState.control.sprint = sprint;
  rig.playerState.elytraEquipped = true;
  rig.playerState.fallFlying = true;
  rig.playerState.vel = new Vec3(0, -0.1, -0.6);

  return rig;
}

describe("Botcraft sprinting", () => {
  it("uses the vanilla player sprint off-ground speed", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel + 1, 0),
      groundLevel,
    });
    const fakeWorld = createFlatWorld(version, groundLevel) as any;

    rig.playerState.control.forward = true;
    rig.playerState.control.sprint = true;

    rig.physics.simulate(rig.playerCtx, fakeWorld);
    rig.playerState.apply(rig.fakePlayer);

    expect(rig.playerState.sprinting).toBe(true);
    expect(rig.playerState.pos.z).toBeCloseTo(-0.025479999019999998, 8);
  });

  it("does not let sprinting change fall-flying motion", () => {
    const fakeWorld = createFlatWorld(version, groundLevel) as any;
    const withoutSprint = createFallFlyingRig(false);
    const withSprint = createFallFlyingRig(true);

    withoutSprint.physics.simulate(withoutSprint.playerCtx, fakeWorld);
    withSprint.physics.simulate(withSprint.playerCtx, fakeWorld);

    expect(withSprint.playerState.pos.x).toBeCloseTo(withoutSprint.playerState.pos.x, 12);
    expect(withSprint.playerState.pos.y).toBeCloseTo(withoutSprint.playerState.pos.y, 12);
    expect(withSprint.playerState.pos.z).toBeCloseTo(withoutSprint.playerState.pos.z, 12);
    expect(withSprint.playerState.vel.x).toBeCloseTo(withoutSprint.playerState.vel.x, 12);
    expect(withSprint.playerState.vel.y).toBeCloseTo(withoutSprint.playerState.vel.y, 12);
    expect(withSprint.playerState.vel.z).toBeCloseTo(withoutSprint.playerState.vel.z, 12);
  });
});
