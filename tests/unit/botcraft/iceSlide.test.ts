import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

describe("Botcraft ice sliding", () => {
  it("matches Grim's 1.21.11 ice friction each tick", () => {
    const version = "1.21.11";
    const { mcData, physics, playerCtx, playerState } = createBotcraftPlayerRig({
      version,
      position: new Vec3(0.5, 0, 0.5),
    });
    const world = createFlatWorld(version, 0);
    for (let x = -1; x <= 40; x++) {
      world.setOverrideBlock(new Vec3(x, -1, 0), mcData.blocksByName.ice.id);
    }

    const friction = Math.fround(Math.fround(0.98) * Math.fround(0.91));
    let expectedX = playerState.pos.x;
    let expectedVelocity = 0.2;
    playerState.vel.set(expectedVelocity, 0, 0);

    for (let tick = 0; tick < 20; tick++) {
      expectedX += expectedVelocity;
      expectedVelocity *= friction;
      physics.simulate(playerCtx, world);

      expect(playerState.pos.x).toBe(expectedX);
      expect(playerState.vel.x).toBe(expectedVelocity);
    }
  });
});
