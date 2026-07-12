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

function fillWaterPool(world: ReturnType<typeof createBoatRig>["world"], fromZ: number, toZ: number) {
  for (let x = -1; x <= 1; x++) {
    for (let z = fromZ; z <= toZ; z++) {
      fillWaterColumn(world, x, z, waterSurfaceY - 1, waterSurfaceY - 1, 0);
    }
  }
}

function setupWaterBoat() {
  const rig = createBoatRig({ version, position: new Vec3(0, boatY, 0), floorY: waterSurfaceY - 2 });
  fillWaterPool(rig.world, -1, 1);
  return rig;
}

describe("BoatPhysics movement", () => {
  it("keeps a stationary boat stable on calm water", () => {
    const rig = setupWaterBoat();
    for (let i = 0; i < 20; i++) {
      simulateBoatTick(rig);
    }
    expect(Math.abs(rig.boatState.vel.x)).toBeLessThan(0.01);
    expect(Math.abs(rig.boatState.vel.z)).toBeLessThan(0.01);
    expect(rig.boatState.pos.y).toBeCloseTo(boatY, 0);
  });

  it("accelerates forward over the first three ticks", () => {
    const rig = setupWaterBoat();
    rig.boatState.control.forward = true;

    const positions: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 3; i++) {
      simulateBoatTick(rig);
      positions.push({ x: rig.boatState.pos.x, z: rig.boatState.pos.z });
    }

    expect(positions[2].z).toBeLessThan(positions[1].z);
    expect(positions[1].z).toBeLessThan(positions[0].z);
    expect(positions[0].z).toBeLessThan(0);
  });

  it("moves backward slower than forward", () => {
    const forwardRig = setupWaterBoat();
    forwardRig.boatState.control.forward = true;
    for (let i = 0; i < 10; i++) simulateBoatTick(forwardRig);
    const forwardDistance = Math.hypot(forwardRig.boatState.pos.x, forwardRig.boatState.pos.z);

    const backRig = setupWaterBoat();
    backRig.boatState.control.back = true;
    for (let i = 0; i < 10; i++) simulateBoatTick(backRig);
    const backDistance = Math.hypot(backRig.boatState.pos.x, backRig.boatState.pos.z);

    expect(forwardDistance).toBeGreaterThan(backDistance * 2);
  });

  it("turns left and right with opposite yaw deltas", () => {
    const leftRig = setupWaterBoat();
    leftRig.boatState.control.left = true;
    simulateBoatTick(leftRig);
    const leftYaw = leftRig.boatState.yaw;

    const rightRig = setupWaterBoat();
    rightRig.boatState.control.right = true;
    simulateBoatTick(rightRig);
    const rightYaw = rightRig.boatState.yaw;

    expect(leftYaw).toBeGreaterThan(0);
    expect(rightYaw).toBeLessThan(0);
    expect(leftYaw).toBeCloseTo(-rightYaw, 5);
  });

  it("forward + left follows an arc", () => {
    const rig = setupWaterBoat();
    rig.boatState.control.forward = true;
    rig.boatState.control.left = true;
    const startYaw = rig.boatState.yaw;
    simulateBoatTick(rig);
    expect(rig.boatState.yaw).toBeGreaterThan(startYaw);
    expect(rig.boatState.pos.z).toBeLessThan(0);
    expect(Math.abs(rig.boatState.pos.x)).toBeGreaterThan(0);
  });

  it("coasts after controls are released", () => {
    const rig = setupWaterBoat();
    rig.boatState.control.forward = true;
    for (let i = 0; i < 5; i++) simulateBoatTick(rig);
    const speedAfterInput = Math.hypot(rig.boatState.vel.x, rig.boatState.vel.z);
    rig.boatState.control.forward = false;
    rig.boatState.control.back = false;
    rig.boatState.control.left = false;
    rig.boatState.control.right = false;
    simulateBoatTick(rig);
    const speedAfterRelease = Math.hypot(rig.boatState.vel.x, rig.boatState.vel.z);
    expect(speedAfterRelease).toBeGreaterThan(0);
    expect(speedAfterRelease).toBeLessThan(speedAfterInput);
  });
});

describe("BoatPhysics collisions and world readiness", () => {
  it("settles into water when falling from air", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY + 3, 0), floorY: waterSurfaceY - 2 });
    fillWaterPool(rig.world, -1, 1);

    for (let i = 0; i < 40; i++) {
      simulateBoatTick(rig);
    }

    expect(rig.boatState.status).toBe(BoatStatus.IN_WATER);
    expect(rig.boatState.pos.y).toBeLessThan(waterSurfaceY);
    expect(rig.boatState.pos.y).toBeGreaterThan(waterSurfaceY - 1);
    expect(Math.abs(rig.boatState.vel.y)).toBeLessThan(0.05);
  });

  it("stops at a shore collision", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, boatY, 0), floorY: waterSurfaceY - 2 });
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

  it("slides faster on ice than on stone", () => {
    const stoneRig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY, 0), floorY: waterSurfaceY - 1 });
    stoneRig.world.setStone(new Vec3(0, waterSurfaceY - 1, 0));
    stoneRig.boatState.control.forward = true;
    for (let i = 0; i < 5; i++) simulateBoatTick(stoneRig);
    const stoneDistance = Math.hypot(stoneRig.boatState.pos.x, stoneRig.boatState.pos.z);

    const iceRig = createBoatRig({ version, position: new Vec3(0, waterSurfaceY, 0), floorY: waterSurfaceY - 1 });
    iceRig.world.setIce(new Vec3(0, waterSurfaceY - 1, 0));
    iceRig.boatState.control.forward = true;
    for (let i = 0; i < 5; i++) simulateBoatTick(iceRig);
    const iceDistance = Math.hypot(iceRig.boatState.pos.x, iceRig.boatState.pos.z);

    expect(iceDistance).toBeGreaterThan(stoneDistance);
  });

  it("does not mutate state when a required block is unloaded", () => {
    const rig = setupWaterBoat();
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

  it("clone does not share mutable Vec3 or controls", () => {
    const rig = createBoatRig({ version, position: new Vec3(1, 2, 3), floorY: 0 });
    const clone = rig.boatState.clone();
    clone.pos.x = 99;
    clone.vel.z = 88;
    clone.control.forward = true;
    expect(rig.boatState.pos.x).toBe(1);
    expect(rig.boatState.vel.z).toBe(0);
    expect(rig.boatState.control.forward).toBe(false);
  });
});

describe("BoatPhysics paddles", () => {
  it("maps forward to both paddles", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, 64, 0) });
    rig.boatState.control.forward = true;
    const paddles = rig.physics.getPaddleState(rig.boatState);
    expect(paddles.leftPaddle).toBe(true);
    expect(paddles.rightPaddle).toBe(true);
  });

  it("does not activate paddles when moving backward", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, 64, 0) });
    rig.boatState.control.back = true;
    const paddles = rig.physics.getPaddleState(rig.boatState);
    expect(paddles.leftPaddle).toBe(false);
    expect(paddles.rightPaddle).toBe(false);
  });

  it("maps right-only input to left paddle", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, 64, 0) });
    rig.boatState.control.right = true;
    const paddles = rig.physics.getPaddleState(rig.boatState);
    expect(paddles.leftPaddle).toBe(true);
    expect(paddles.rightPaddle).toBe(false);
  });

  it("maps left-only input to right paddle", () => {
    const rig = createBoatRig({ version, position: new Vec3(0, 64, 0) });
    rig.boatState.control.left = true;
    const paddles = rig.physics.getPaddleState(rig.boatState);
    expect(paddles.leftPaddle).toBe(false);
    expect(paddles.rightPaddle).toBe(true);
  });
});
