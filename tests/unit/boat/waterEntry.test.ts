import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { BoatStatus } from "../../../src/physics/states/boatState";
import {
  createBoatRig,
  fillWaterColumn,
  simulateBoatTick,
} from "../../helpers/unit/botcraftTestSupport";

const waterSurfaceY = 64;
const waterEntryStartY = 63.885;
const expectedSnapY = 63.5385;

function setupWaterEntryRig(version: string, options?: { obstacleAtCenter?: boolean; edgeObstacle?: boolean }) {
  const rig = createBoatRig({
    version,
    entityName: "boat",
    position: new Vec3(0, waterEntryStartY, 0),
    floorY: waterSurfaceY - 2,
  });

  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      fillWaterColumn(rig.world, x, z, waterSurfaceY - 1, waterSurfaceY - 1, 0);
    }
  }

  if (options?.obstacleAtCenter) {
    rig.world.setStone(new Vec3(0, waterSurfaceY, 0));
  }
  if (options?.edgeObstacle) {
    rig.world.setStone(new Vec3(3, waterSurfaceY, 0));
  }

  rig.boatState.status = BoatStatus.IN_AIR;
  rig.boatState.previousStatus = BoatStatus.IN_AIR;
  rig.boatState.vel.y = -0.5;

  return rig;
}

function simulateWaterEntryTick(rig: ReturnType<typeof createBoatRig>) {
  simulateBoatTick(rig);
  expect(rig.boatState.status).toBe(BoatStatus.IN_WATER);
}

describe("BoatPhysics water-entry reposition", () => {
  it("repositions unconditionally on 1.20.4 when a solid intersects the target snap position", () => {
    const rig = setupWaterEntryRig("1.20.4", { obstacleAtCenter: true });
    simulateWaterEntryTick(rig);

    expect(rig.physics.supportFeature("boatWaterEntryCollisionGuard")).toBe(false);
    expect(rig.boatState.pos.y).toBeCloseTo(expectedSnapY, 3);
    expect(rig.boatState.vel.y).toBe(0);
  });

  it("blocks reposition on 1.21.1 when a solid intersects the target snap position", () => {
    const rig = setupWaterEntryRig("1.21.1", { obstacleAtCenter: true });
    simulateWaterEntryTick(rig);

    expect(rig.physics.supportFeature("boatWaterEntryCollisionGuard")).toBe(true);
    expect(rig.boatState.pos.y).not.toBeCloseTo(expectedSnapY, 3);
    expect(rig.boatState.pos.y).toBeLessThan(waterEntryStartY);
    expect(rig.boatState.vel.y).toBe(-0.5);
  });

  it("still repositions on 1.21.1 when a solid only edge-touches the target snap AABB", () => {
    const rig = setupWaterEntryRig("1.21.1", { edgeObstacle: true });
    simulateWaterEntryTick(rig);

    expect(rig.boatState.pos.y).toBeCloseTo(expectedSnapY, 3);
    expect(rig.boatState.vel.y).toBe(0);
  });
});
