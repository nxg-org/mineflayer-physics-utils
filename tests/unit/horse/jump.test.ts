import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { HorseState } from "../../../src/physics/states/horseState";
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
    attributes: {
      "generic.movement_speed": { value: 0.225, modifiers: [] },
      "horse.jump_strength": { value: 0.7, modifiers: [] },
    },
  });
}

describe("HorsePhysics jump", () => {
  it("starts at zero and charges linearly through the tenth held tick", () => {
    const rig = setupGroundHorse();
    for (let tick = 0; tick <= 10; tick++) {
      rig.horseState.updateJumpCharge(true);
      expect(rig.horseState.jumpChargeScale).toBeCloseTo(Math.min(tick * 0.1, 1), 5);
    }
  });

  it("falls from 1.0 toward the vanilla 0.8 long-hold limit", () => {
    const rig = setupGroundHorse();
    for (let tick = 0; tick < 20; tick++) {
      rig.horseState.updateJumpCharge(true);
    }
    expect(rig.horseState.jumpChargeScale).toBeGreaterThan(0.8);
    expect(rig.horseState.jumpChargeScale).toBeLessThan(0.9);
  });

  it("sets pending scale on release with minimum 0.4 for quick tap", () => {
    const rig = setupGroundHorse();
    rig.horseState.updateJumpCharge(true);
    const release = rig.horseState.updateJumpCharge(false);
    expect(release.released).toBe(true);
    expect(release.jumpBoost).toBe(0);
    expect(rig.horseState.jumpPendingScale).toBeCloseTo(0.4, 5);
  });

  it("applies charge-dependent vertical jump on ground", () => {
    const rig = setupGroundHorse();
    rig.horseState.jumpPendingScale = 1.0;
    rig.horseState.onGround = true;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBeGreaterThan(0.5);
  });

  it("adds forward horizontal impulse when jumping forward", () => {
    const rig = setupGroundHorse();
    rig.horseState.control.forward = true;
    rig.horseState.jumpPendingScale = 1.0;
    rig.horseState.onGround = true;
    const beforeZ = rig.horseState.pos.z;
    simulateHorseTick(rig);
    expect(rig.horseState.pos.z).toBeLessThan(beforeZ);
  });

  it("lands and allows repeated jumps", () => {
    const rig = setupGroundHorse();
    rig.horseState.jumpPendingScale = 1.0;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBeGreaterThan(0);

    for (let i = 0; i < 30; i++) simulateHorseTick(rig);
    expect(rig.horseState.onGround).toBe(true);

    rig.horseState.jumpPendingScale = 0.5;
    simulateHorseTick(rig);
    expect(rig.horseState.vel.y).toBeGreaterThan(0);
  });

  it("uses honey block jump factor", () => {
    const rig = setupGroundHorse();
    const honeyId = rig.mcData.blocksByName.honey_block?.id;
    if (honeyId != null) {
      rig.world.setBlock(new Vec3(0, groundY, 0), honeyId);
    }
    rig.horseState.jumpPendingScale = 1.0;
    simulateHorseTick(rig);
    const honeyJump = rig.horseState.vel.y;

    const normalRig = setupGroundHorse();
    normalRig.horseState.jumpPendingScale = 1.0;
    simulateHorseTick(normalRig);
    if (honeyId != null) {
      expect(honeyJump).toBeLessThan(normalRig.horseState.vel.y);
    }
  });

  it("reads jump strength from entity attributes", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
      attributes: {
        "horse.jump_strength": { value: 1.0, modifiers: [] },
      },
    });
    expect(rig.horseState.jumpStrength).toBeCloseTo(1.0, 5);
  });

  it("clone preserves jump state independently", () => {
    const rig = setupGroundHorse();
    rig.horseState.jumpChargeScale = 0.5;
    rig.horseState.jumpPendingScale = 0.8;
    const clone = rig.horseState.clone();
    clone.jumpChargeScale = 0.1;
    expect(rig.horseState.jumpChargeScale).toBeCloseTo(0.5, 5);
  });
});

describe("HorseState attributes", () => {
  it("uses vanilla defaults before attributes arrive", () => {
    const state = HorseState.CREATE_FROM_ENTITY({} as any, {
      position: new Vec3(0, 64, 0),
      velocity: new Vec3(0, 0, 0),
      height: 1.6,
      width: 1.3964844,
      yaw: 0,
      pitch: 0,
    } as any);
    expect(state.movementSpeed).toBeCloseTo(0.225, 5);
    expect(state.jumpStrength).toBeCloseTo(0.7, 5);
  });

  it("applies attribute modifiers without mutating source", () => {
    const attr = {
      value: 0.225,
      modifiers: [{ uuid: "test", operation: 1, amount: 0.5 }],
    };
    const speed = HorseState.getMovementSpeedFromAttributes({
      "generic.movement_speed": attr,
    });
    expect(speed).toBeCloseTo(0.3375, 4);
    expect(attr.modifiers.length).toBe(1);
  });
});
