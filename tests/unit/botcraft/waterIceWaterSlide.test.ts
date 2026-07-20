import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

describe("Botcraft water-ice-water sliding", () => {
  for (const version of ["1.8.9", "1.18.2", "1.21.3", "1.21.4", "1.21.5", "1.21.11"]) {
    it(`${version} applies post-move water current before friction except for 1.21.4`, () => {
      const { mcData, physics, playerCtx, playerState } = createBotcraftPlayerRig({
        version,
        position: new Vec3(0.65, 0, 0.5),
      });
      const world = createFlatWorld(version, -100);

      for (let x = -2; x <= 3; x++) {
        world.setOverrideBlock(new Vec3(x, -1, 0), mcData.blocksByName.ice.id);
      }
      world.setOverrideBlock(new Vec3(-2, 0, 0), mcData.blocksByName.water.id, 0);
      world.setOverrideBlock(new Vec3(-1, 0, 0), mcData.blocksByName.water.id, 1);
      world.setOverrideBlock(new Vec3(1, 0, 0), mcData.blocksByName.water.id, 0);
      world.setOverrideBlock(new Vec3(2, 0, 0), mcData.blocksByName.water.id, 1);

      playerState.vel.x = 0.1;
      physics.simulate(playerCtx, world);

      expect(playerState.pos.x).toBe(0.75);
      expect(playerState.isInWater).toBe(version !== "1.21.4");
      expect(playerState.vel.x).toBe(version === "1.21.4" ? 0.08918000459671022 : 0.10166520524024963);
    });
  }
});
