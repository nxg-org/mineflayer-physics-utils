import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

describe("Botcraft water-to-ice sliding", () => {
  it("matches Grim when 1.21.11 flowing water carries an idle player onto dry ice", () => {
    const version = "1.21.11";
    const { mcData, physics, playerCtx, playerState } = createBotcraftPlayerRig({
      version,
      position: new Vec3(0.5, 0, 0.5),
    });
    const world = createFlatWorld(version, -100);

    for (let x = -1; x <= 30; x++) {
      world.setOverrideBlock(new Vec3(x, -1, 0), mcData.blocksByName.ice.id);
    }
    for (let x = 0; x <= 7; x++) {
      world.setOverrideBlock(new Vec3(x, 0, 0), mcData.blocksByName.water.id, x);
    }

    let wasInWater = false;
    for (let tick = 0; tick < 400; tick++) {
      const positionBeforeTick = playerState.pos.x;
      const velocityBeforeTick = playerState.vel.x;
      physics.simulate(playerCtx, world);

      if (wasInWater && !playerState.isInWater) {
        expect(tick).toBe(295);
        expect(positionBeforeTick).toBe(8.30140712936965);
        expect(velocityBeforeTick).toBe(0.0061662226816454405);
        expect(playerState.pos.x).toBe(8.307573352051296);
        expect(playerState.vel.x).toBe(0.005499037670934791);
        return;
      }
      wasInWater = playerState.isInWater;
    }

    throw new Error("player never left the water");
  });
});
