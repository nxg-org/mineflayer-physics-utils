import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { BoatStatus } from "../../../src/physics/states/boatState";
import {
  createBoatRig,
  fillWaterColumn,
  simulateBoatTick,
} from "../../helpers/unit/botcraftTestSupport";

const version = "1.17.1";
const waterSurfaceY = 64;
const boatY = waterSurfaceY - 0.4;

describe("BoatPhysics status detection", () => {
  it("detects IN_WATER on source water", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, boatY, 0), floorY: waterSurfaceY - 2 });
    fillWaterColumn(rig.world, 0, 0, waterSurfaceY - 1, waterSurfaceY - 1, 0);
    simulateBoatTick(rig);
    expect(rig.boatState.status).toBe(BoatStatus.IN_WATER);
  });

  it("detects UNDER_WATER when top is submerged in source water", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY - 0.55, 0), floorY: waterSurfaceY - 2 });
    fillWaterColumn(rig.world, 0, 0, waterSurfaceY - 1, waterSurfaceY, 0);
    rig.boatState.previousStatus = BoatStatus.IN_WATER;
    rig.boatState.status = BoatStatus.IN_WATER;
    simulateBoatTick(rig);
    expect(rig.boatState.status).toBe(BoatStatus.UNDER_WATER);
  });

  it("detects UNDER_FLOWING_WATER for falling water above the boat top", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY - 0.55, 0), floorY: waterSurfaceY - 2 });
    fillWaterColumn(rig.world, 0, 0, waterSurfaceY - 1, waterSurfaceY - 1, 0);
    rig.world.setWater(new Vec3(0, waterSurfaceY, 0), 8);
    rig.boatState.previousStatus = BoatStatus.IN_WATER;
    rig.boatState.status = BoatStatus.IN_WATER;
    simulateBoatTick(rig);
    expect(rig.boatState.status).toBe(BoatStatus.UNDER_FLOWING_WATER);
  });

  it("normalizes UNDER_WATER to IN_WATER on first tick from air", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY - 0.55, 0), floorY: waterSurfaceY - 2 });
    fillWaterColumn(rig.world, 0, 0, waterSurfaceY - 1, waterSurfaceY, 0);
    simulateBoatTick(rig);
    expect(rig.boatState.status).toBe(BoatStatus.IN_WATER);
  });

  it("detects ON_LAND when resting on solid ground", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY, 0), floorY: waterSurfaceY - 1 });
    rig.world.setStone(new Vec3(0, waterSurfaceY - 1, 0));
    simulateBoatTick(rig);
    expect(rig.boatState.status).toBe(BoatStatus.ON_LAND);
  });

  it("detects IN_AIR when no water or ground contact", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY + 5, 0), floorY: waterSurfaceY - 1 });
    simulateBoatTick(rig);
    expect(rig.boatState.status).toBe(BoatStatus.IN_AIR);
  });
});

describe("BoatPhysics fluid height", () => {
  it("treats water level 8 as flowing, not source", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, boatY, 0), floorY: waterSurfaceY - 2 });
    rig.world.setWater(new Vec3(0, waterSurfaceY - 1, 0), 8);
    simulateBoatTick(rig);
    expect(Number(rig.world.getBlock(new Vec3(0, waterSurfaceY - 1, 0))!.getProperties().level)).toBe(8);
    expect(rig.boatState.status).toBe(BoatStatus.IN_WATER);
  });

  it("treats steady-state submerged boat in level 1 water as UNDER_FLOWING_WATER", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY - 0.9, 0), floorY: waterSurfaceY - 2 });
    rig.world.setWater(new Vec3(0, waterSurfaceY - 1, 0), 1);
    rig.boatState.previousStatus = BoatStatus.IN_WATER;
    rig.boatState.status = BoatStatus.IN_WATER;
    for (let i = 0; i < 5; i++) {
      simulateBoatTick(rig);
    }
    expect(Number(rig.world.getBlock(new Vec3(0, waterSurfaceY - 1, 0))!.getProperties().level)).toBe(1);
    expect(rig.boatState.status).toBe(BoatStatus.UNDER_FLOWING_WATER);
  });

  it("raises fluid height to 1 when the block above is also water", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY - 0.55, 0), floorY: waterSurfaceY - 2 });
    fillWaterColumn(rig.world, 0, 0, waterSurfaceY - 1, waterSurfaceY, 0);
    rig.boatState.previousStatus = BoatStatus.IN_WATER;
    rig.boatState.status = BoatStatus.IN_WATER;
    simulateBoatTick(rig);
    expect(rig.boatState.status).toBe(BoatStatus.UNDER_WATER);
  });
});
