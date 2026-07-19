import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { BoatStatus } from "../../../src/physics/states/boatState";
import {
  BoatTestWorld,
  createBoatRig,
  fillWaterColumn,
  loadMcData,
  resolveBoatEntityDescriptor,
  simulateBoatTick,
} from "../../helpers/unit/botcraftTestSupport";

const waterSurfaceY = 64;
const boatY = waterSurfaceY - 0.4;

const versions = [
  { version: "1.11.2", entityNames: ["boat"] },
  { version: "1.17.1", entityNames: ["boat"] },
  { version: "1.20.4", entityNames: ["boat", "chest_boat"] },
  { version: "1.21.2", entityNames: ["boat", "chest_boat"] },
  { version: "1.21.3", entityNames: ["oak_boat", "oak_chest_boat", "bamboo_raft"] },
  { version: "1.21.11", entityNames: ["oak_boat", "oak_chest_boat", "bamboo_raft"] },
];

function expectBoatPhysicsContext(rig: ReturnType<typeof createBoatRig>) {
  expect(rig.boatCtx.stepHeight).toBe(0);
  expect(rig.boatCtx.useControls).toBe(false);
  expect(rig.boatCtx.gravity).toBe(0.04);
  expect(rig.boatCtx.airdrag).toBe(1);
  expect(rig.boatCtx.collisionBehavior).toEqual({
    blockEffects: false,
    affectedAfterCollision: true,
  });
}

function fillWaterPool(world: BoatTestWorld, fromZ: number, toZ: number) {
  for (let x = -1; x <= 1; x++) {
    for (let z = fromZ; z <= toZ; z++) {
      fillWaterColumn(world, x, z, waterSurfaceY - 1, waterSurfaceY - 1, 0);
    }
  }
}

function setupWaterBoat(version: string, entityName: string) {
  const rig = createBoatRig({
    version,
    entityName,
    position: new Vec3(0, boatY, 0),
    floorY: waterSurfaceY - 2,
  });
  fillWaterPool(rig.world, -1, 1);
  return rig;
}

describe("BoatPhysics multiversion compatibility", () => {
  for (const { version, entityNames } of versions) {
    describe(version, () => {
      for (const entityName of entityNames) {
        describe(entityName, () => {
          it("resolves the requested entity descriptor and uses its dimensions", () => {
            const rig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, boatY, 0),
            });

            expect(rig.entityName).toBe(entityName);
            expect(rig.entityDescriptor).toBe(rig.mcData.entitiesByName[entityName]);
            expect(rig.boatState.height).toBe(rig.entityDescriptor.height);
            expect(rig.boatState.halfWidth * 2).toBe(rig.entityDescriptor.width);
          });

          it("uses boat vehicle physics context instead of living-entity defaults", () => {
            const rig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, boatY, 0),
            });
            expectBoatPhysicsContext(rig);
          });

          it("does not step up or blow through a single-block land wall immediately", () => {
            const rig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, waterSurfaceY, 0),
              floorY: waterSurfaceY - 1,
            });
            rig.world.setStone(new Vec3(0, waterSurfaceY - 1, 0));
            rig.world.setStone(new Vec3(0, waterSurfaceY, -1));
            rig.boatState.control.forward = true;

            for (let i = 0; i < 8; i++) simulateBoatTick(rig);

            expect(rig.boatCtx.stepHeight).toBe(0);
            expect(rig.boatState.pos.z).toBeGreaterThan(-1);
            expect(rig.boatState.pos.y).toBeLessThan(waterSurfaceY + 0.5);
          });

          it("detects water, land, and air status", () => {
            const waterRig = setupWaterBoat(version, entityName);
            simulateBoatTick(waterRig);
            expect(waterRig.boatState.status).toBe(BoatStatus.IN_WATER);

            const landRig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, waterSurfaceY, 0),
              floorY: waterSurfaceY - 1,
            });
            landRig.world.setStone(new Vec3(0, waterSurfaceY - 1, 0));
            simulateBoatTick(landRig);
            expect(landRig.boatState.status).toBe(BoatStatus.ON_LAND);

            const airRig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, waterSurfaceY + 5, 0),
              floorY: waterSurfaceY - 1,
            });
            simulateBoatTick(airRig);
            expect(airRig.boatState.status).toBe(BoatStatus.IN_AIR);
          });

          it("keeps position, velocity, yaw, and status finite after repeated ticks", () => {
            const rig = setupWaterBoat(version, entityName);
            for (let i = 0; i < 20; i++) {
              simulateBoatTick(rig);
              expect(Number.isFinite(rig.boatState.pos.x)).toBe(true);
              expect(Number.isFinite(rig.boatState.pos.y)).toBe(true);
              expect(Number.isFinite(rig.boatState.pos.z)).toBe(true);
              expect(Number.isFinite(rig.boatState.vel.x)).toBe(true);
              expect(Number.isFinite(rig.boatState.vel.y)).toBe(true);
              expect(Number.isFinite(rig.boatState.vel.z)).toBe(true);
              expect(Number.isFinite(rig.boatState.yaw)).toBe(true);
              expect(Object.values(BoatStatus)).toContain(rig.boatState.status);
            }
          });

          it("moves forward under forward input", () => {
            const rig = setupWaterBoat(version, entityName);
            rig.boatState.control.forward = true;
            simulateBoatTick(rig);
            expect(rig.boatState.pos.z).toBeLessThan(0);
          });

          it("turns left and right with opposite yaw deltas", () => {
            const leftRig = setupWaterBoat(version, entityName);
            leftRig.boatState.control.left = true;
            simulateBoatTick(leftRig);

            const rightRig = setupWaterBoat(version, entityName);
            rightRig.boatState.control.right = true;
            simulateBoatTick(rightRig);

            expect(leftRig.boatState.yaw).toBeGreaterThan(0);
            expect(rightRig.boatState.yaw).toBeLessThan(0);
            expect(leftRig.boatState.yaw).toBeCloseTo(-rightRig.boatState.yaw, 5);
          });

          it("slides faster on ice than on stone", () => {
            const stoneRig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, waterSurfaceY, 0),
              floorY: waterSurfaceY - 1,
            });
            stoneRig.world.setStone(new Vec3(0, waterSurfaceY - 1, 0));
            stoneRig.boatState.control.forward = true;
            for (let i = 0; i < 5; i++) simulateBoatTick(stoneRig);
            const stoneDistance = Math.hypot(stoneRig.boatState.pos.x, stoneRig.boatState.pos.z);

            const iceRig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, waterSurfaceY, 0),
              floorY: waterSurfaceY - 1,
            });
            iceRig.world.setIce(new Vec3(0, waterSurfaceY - 1, 0));
            iceRig.boatState.control.forward = true;
            for (let i = 0; i < 5; i++) simulateBoatTick(iceRig);
            const iceDistance = Math.hypot(iceRig.boatState.pos.x, iceRig.boatState.pos.z);

            expect(iceDistance).toBeGreaterThan(stoneDistance);
          });

          it("stops at a shore collision", () => {
            const rig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, boatY, 0),
              floorY: waterSurfaceY - 2,
            });
            fillWaterPool(rig.world, -2, 0);
            for (let x = -2; x <= 2; x++) {
              rig.world.setStone(new Vec3(x, waterSurfaceY - 1, -2));
              rig.world.setStone(new Vec3(x, waterSurfaceY, -2));
              rig.world.setStone(new Vec3(x, waterSurfaceY + 1, -2));
            }

            rig.boatState.control.forward = true;
            for (let i = 0; i < 30; i++) simulateBoatTick(rig);

            expect(rig.boatState.pos.z).toBeGreaterThan(-2);
            expect(rig.boatState.isCollidedHorizontally).toBe(true);
            expect(Math.abs(rig.boatState.vel.z)).toBeLessThan(0.001);
          });

          it("leaves simulation state unchanged when a required block is unloaded", () => {
            const rig = setupWaterBoat(version, entityName);
            const before = rig.boatState.clone();
            const originalGetBlock = rig.world.getBlock.bind(rig.world);
            rig.world.getBlock = (pos: Vec3) => {
              if (pos.x === 0 && pos.z === 0 && pos.y === waterSurfaceY - 1) return null;
              return originalGetBlock(pos);
            };

            simulateBoatTick(rig);
            expect(rig.boatState.worldReady).toBe(false);
            expect(rig.boatState.pos.x).toBe(before.pos.x);
            expect(rig.boatState.pos.y).toBe(before.pos.y);
            expect(rig.boatState.pos.z).toBe(before.pos.z);
            expect(rig.boatState.vel.x).toBe(before.vel.x);
            expect(rig.boatState.vel.y).toBe(before.vel.y);
            expect(rig.boatState.vel.z).toBe(before.vel.z);
            expect(rig.boatState.yaw).toBe(before.yaw);
            expect(rig.boatState.status).toBe(before.status);
            expect(rig.boatState.age).toBe(before.age);
          });

          it("maps paddle state from forward and turn controls", () => {
            const forwardRig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, waterSurfaceY, 0),
            });
            forwardRig.boatState.control.forward = true;
            const forwardPaddles = forwardRig.physics.getPaddleState(forwardRig.boatState);
            expect(forwardPaddles.leftPaddle).toBe(true);
            expect(forwardPaddles.rightPaddle).toBe(true);

            const rightRig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, waterSurfaceY, 0),
            });
            rightRig.boatState.control.right = true;
            const rightPaddles = rightRig.physics.getPaddleState(rightRig.boatState);
            expect(rightPaddles.leftPaddle).toBe(true);
            expect(rightPaddles.rightPaddle).toBe(false);

            const leftRig = createBoatRig({
              version,
              entityName,
              position: new Vec3(0, waterSurfaceY, 0),
            });
            leftRig.boatState.control.left = true;
            const leftPaddles = leftRig.physics.getPaddleState(leftRig.boatState);
            expect(leftPaddles.leftPaddle).toBe(false);
            expect(leftPaddles.rightPaddle).toBe(true);
          });
        });
      }
    });
  }
});

describe("BoatPhysics entity descriptor resolution", () => {
  it("throws a descriptive error when the requested entity name is missing", () => {
    const { mcData } = loadMcData("1.21.3");
    expect(() => resolveBoatEntityDescriptor(mcData, "boat", "1.21.3")).toThrow(
      'Boat entity descriptor "boat" not found for Minecraft 1.21.3',
    );
  });

  it("applies boat vehicle context for 1.11.2 even when boat id overlaps mobData", () => {
    const { mcData } = loadMcData("1.11.2");
    const boat = mcData.entitiesByName.boat;
    expect(mcData.mobs[boat.id]).toBeTruthy();
    const rig = createBoatRig({
      version: "1.11.2",
      entityName: "boat",
      position: new Vec3(0, boatY, 0),
    });
    expectBoatPhysicsContext(rig);
  });
});
