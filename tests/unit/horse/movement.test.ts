import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import {
  createHorseRig,
  simulateHorseTick,
} from "../../helpers/unit/botcraftTestSupport";

const version = "1.17.1";
const groundY = 64;

function setupGroundHorse() {
  return createHorseRig({
    version,
    position: new Vec3(0, groundY, 0),
    floorY: groundY - 1,
  });
}

describe("HorsePhysics movement", () => {
  it("moves forward when forward control is pressed", () => {
    const rig = setupGroundHorse();
    rig.horseState.control.forward = true;
    for (let i = 0; i < 5; i++) simulateHorseTick(rig);
    expect(rig.horseState.pos.z).toBeLessThan(0);
  });

  it("moves backward slower than forward", () => {
    const forwardRig = setupGroundHorse();
    forwardRig.horseState.control.forward = true;
    for (let i = 0; i < 10; i++) simulateHorseTick(forwardRig);
    const forwardDistance = Math.hypot(forwardRig.horseState.pos.x, forwardRig.horseState.pos.z);

    const backRig = setupGroundHorse();
    backRig.horseState.control.back = true;
    for (let i = 0; i < 10; i++) simulateHorseTick(backRig);
    const backDistance = Math.hypot(backRig.horseState.pos.x, backRig.horseState.pos.z);

    expect(forwardDistance).toBeGreaterThan(backDistance * 2);
  });

  it("strafes left and right with opposite X deltas", () => {
    const leftRig = setupGroundHorse();
    leftRig.horseState.control.left = true;
    simulateHorseTick(leftRig);
    const leftX = leftRig.horseState.pos.x;

    const rightRig = setupGroundHorse();
    rightRig.horseState.control.right = true;
    simulateHorseTick(rightRig);
    const rightX = rightRig.horseState.pos.x;

    expect(leftX).toBeLessThan(0);
    expect(rightX).toBeGreaterThan(0);
  });

  it("uses rider yaw for horse rotation", () => {
    const rig = setupGroundHorse();
    rig.horseState.updateControls(rig.horseState.control, Math.PI / 2, 0);
    expect(rig.horseState.yaw).toBeCloseTo(Math.PI / 2, 5);
  });

  it("sets horse pitch to half rider pitch", () => {
    const rig = setupGroundHorse();
    rig.horseState.updateControls(rig.horseState.control, 0, Math.PI / 4);
    expect(rig.horseState.pitch).toBeCloseTo(Math.PI / 8, 5);
  });

  it("does not apply sprint speed multiplier", () => {
    const normalRig = setupGroundHorse();
    normalRig.horseState.control.forward = true;
    for (let i = 0; i < 10; i++) simulateHorseTick(normalRig);
    const normalDistance = Math.hypot(normalRig.horseState.pos.x, normalRig.horseState.pos.z);

    const sprintRig = setupGroundHorse();
    sprintRig.horseState.control.forward = true;
    sprintRig.horseState.control.sprint = true;
    for (let i = 0; i < 10; i++) simulateHorseTick(sprintRig);
    const sprintDistance = Math.hypot(sprintRig.horseState.pos.x, sprintRig.horseState.pos.z);

    expect(Math.abs(sprintDistance - normalDistance)).toBeLessThan(0.01);
  });

  it("steps up a 1-block ledge", () => {
    const rig = setupGroundHorse();
    for (let x = -2; x <= 2; x++) {
      for (let z = -2; z <= 5; z++) {
        rig.world.setStone(new Vec3(x, groundY - 1, z));
      }
    }
    rig.world.setStone(new Vec3(0, groundY, -3));
    rig.horseState.control.forward = true;
    for (let i = 0; i < 20; i++) simulateHorseTick(rig);
    expect(rig.horseState.pos.y).toBeGreaterThanOrEqual(groundY);
  });

  it("collides with a wall", () => {
    const rig = setupGroundHorse();
    for (let y = groundY - 1; y <= groundY + 2; y++) {
      rig.world.setStone(new Vec3(0, y, -3));
    }
    rig.horseState.control.forward = true;
    for (let i = 0; i < 30; i++) simulateHorseTick(rig);
    expect(rig.horseState.pos.z).toBeGreaterThan(-2.5);
  });

  it("moves faster on ice than stone", () => {
    const iceRig = setupGroundHorse();
    for (let x = -1; x <= 1; x++) {
      for (let z = -20; z <= 1; z++) {
        iceRig.world.setIce(new Vec3(x, groundY - 1, z));
      }
    }
    iceRig.horseState.control.forward = true;
    for (let i = 0; i < 20; i++) simulateHorseTick(iceRig);
    const iceSpeed = Math.hypot(iceRig.horseState.vel.x, iceRig.horseState.vel.z);

    const stoneRig = setupGroundHorse();
    stoneRig.horseState.control.forward = true;
    for (let i = 0; i < 20; i++) simulateHorseTick(stoneRig);
    const stoneSpeed = Math.hypot(stoneRig.horseState.vel.x, stoneRig.horseState.vel.z);

    expect(iceSpeed).toBeGreaterThan(stoneSpeed);
  });
});
