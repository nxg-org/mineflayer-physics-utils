import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { EPhysicsCtx } from "../../../src/physics/settings";
import { PlayerPoses } from "../../../src/physics/states/poses";
import { FlatWorld, createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

const versions = ["1.18.2", "1.21.11"];
const playerY = 67;

type BotcraftTestAccess = {
  applyMovement: () => void;
  applySwimmingVerticalSteering: (ctx: EPhysicsCtx, world: FlatWorld) => void;
  updatePoses: (ctx: EPhysicsCtx, world: FlatWorld) => void;
  worldIsFree: (world: FlatWorld, box: AABB, ignoreLiquid: boolean) => boolean;
};

function createWaterRig(version: string) {
  const rig = createBotcraftPlayerRig({
    version,
    position: new Vec3(0.5, playerY, 0.5),
    groundLevel: playerY,
  });
  const world = createFlatWorld(version, 0);
  return { ...rig, world };
}

describe("Botcraft water physics", () => {
  for (const version of versions) {
    describe(version, () => {
      it("applies full water-movement efficiency on ground and half in air", () => {
        const run = (onGround: boolean) => {
          const { physics, playerCtx, playerState, world } = createWaterRig(version);
          const testPhysics = physics as unknown as BotcraftTestAccess;
          testPhysics.applyMovement = () => {};

          playerState.isInWater = true;
          playerState.onGround = onGround;
          playerState.heading.forward = 1;
          playerState.heading.strafe = 0;
          playerState.vel.set(0, 0, 0);

          if (version === "1.18.2") {
            playerState.depthStrider = 3;
          } else {
            const playerAttributes = playerState.attributes as Record<string, { value: number }>;
            playerAttributes[physics.waterMovementEfficiencyAttribute] = { value: 1 };
          }

          physics.movePlayer(playerCtx, world);
          return playerState.vel.z;
        };

        expect(run(true)).toBeCloseTo(-0.0546, 6);
        expect(run(false)).toBeCloseTo(-0.04038, 6);
      });

      it("uses look-vector Y for swimming steering", () => {
        const { physics, playerCtx, playerState, world } = createWaterRig(version);
        playerState.swimming = true;
        playerState.pitch = Math.PI / 4;
        playerState.vel.y = 0;
        playerState.control.jump = true;

        const testPhysics = physics as unknown as BotcraftTestAccess;
        testPhysics.applySwimmingVerticalSteering(playerCtx, world);

        expect(playerState.vel.y).toBeCloseTo(Math.sin(playerState.pitch) * 0.06, 12);
      });

      it("applies all bubble-column surface and interior branches", () => {
        const run = (metadata: number, interior: boolean, initialY: number) => {
          const { mcData, physics, playerCtx, playerState, world } = createWaterRig(version);
          world.setOverrideBlock(new Vec3(0, playerY, 0), mcData.blocksByName.bubble_column.id, metadata);
          if (interior) {
            world.setOverrideBlock(new Vec3(0, playerY + 1, 0), mcData.blocksByName.stone.id);
          }

          playerState.vel.y = initialY;
          physics.checkInsideBlocks(playerState, world, playerCtx.worldSettings);
          return playerState.vel.y;
        };

        expect(run(0, false, -0.5)).toBeCloseTo(-0.53, 12);
        expect(run(0, true, -0.5)).toBeCloseTo(-0.3, 12);
        expect(run(1, false, 1)).toBeCloseTo(1.1, 12);
        expect(run(1, true, 1)).toBeCloseTo(0.7, 12);
      });

      it("ignores liquid while fitting player poses", () => {
        const { mcData, physics, playerCtx, playerState, world } = createWaterRig(version);
        world.setOverrideBlock(new Vec3(0, playerY, 0), mcData.blocksByName.water.id);
        playerState.pose = PlayerPoses.SWIMMING;
        playerState.swimming = false;

        const testPhysics = physics as unknown as BotcraftTestAccess;
        expect(testPhysics.worldIsFree(world, playerState.getBB(), true)).toBe(true);
        expect(testPhysics.worldIsFree(world, playerState.getBB(), false)).toBe(false);

        testPhysics.updatePoses(playerCtx, world);

        expect(playerState.pose).toBe(PlayerPoses.STANDING);
      });

      it("follows water into an open lower neighboring block", () => {
        const { mcData, physics, world } = createWaterRig(version);
        world.setOverrideBlock(new Vec3(0, playerY, 0), mcData.blocksByName.water.id);
        world.setOverrideBlock(new Vec3(1, playerY - 1, 0), mcData.blocksByName.water.id);

        const flow = physics.getFlow(world.getBlock(new Vec3(0, playerY, 0))!, world);

        expect(flow.x).toBeCloseTo(1, 12);
        expect(flow.y).toBeCloseTo(0, 12);
        expect(flow.z).toBeCloseTo(0, 12);
      });

      it("uses effective slow-falling gravity in water", () => {
        const { physics, playerCtx, playerState, world } = createWaterRig(version);
        const testPhysics = physics as unknown as BotcraftTestAccess;
        testPhysics.applyMovement = () => {};
        playerState.isInWater = true;
        playerState.onGround = false;
        playerState.slowFalling = 1;
        playerState.vel.set(0, -0.1, 0);

        physics.movePlayer(playerCtx, world);

        expect(playerState.vel.y).toBeCloseTo(-0.08 - 0.01 / 16, 8);
      });
    });
  }
});
