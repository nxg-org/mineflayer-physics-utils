import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import {
  createHorseRig,
  simulateHorseTick,
} from "../../helpers/unit/botcraftTestSupport";

const version = "1.17.1";
const groundY = 64;

describe("HorsePhysics world readiness", () => {
  it("pauses simulation when required blocks are missing", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
    });
    const loadedWorld = rig.world;
    const worldWithHoles = {
      getBlock(pos: Vec3) {
        if (Math.abs(pos.x) > 1 || Math.abs(pos.z) > 1) return null;
        return loadedWorld.getBlock(pos);
      },
    };
    const before = rig.horseState.pos.clone();
    rig.horseState.control.forward = true;
    rig.physics.simulate(rig.horseCtx, worldWithHoles);
    expect(rig.horseState.worldReady).toBe(false);
    expect(rig.horseState.pos.equals(before)).toBe(true);
  });

  it("rebaseFromEntity updates position without mutating jump charge", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
    });
    rig.horseState.jumpChargeScale = 0.5;
    rig.horseState.rebaseFromEntity({
      position: new Vec3(5, groundY, 5),
      velocity: new Vec3(0, 0, 0),
      yaw: 1,
      pitch: 0.5,
      onGround: true,
      height: 1.6,
      width: 1.3964844,
    } as any);
    expect(rig.horseState.pos.x).toBe(5);
    expect(rig.horseState.jumpChargeScale).toBeCloseTo(0.5, 5);
  });

  it("keeps finite state after simulation", () => {
    const rig = createHorseRig({
      version,
      position: new Vec3(0, groundY, 0),
      floorY: groundY - 1,
    });
    rig.horseState.control.forward = true;
    for (let i = 0; i < 10; i++) simulateHorseTick(rig);
    expect([rig.horseState.pos.x, rig.horseState.pos.y, rig.horseState.pos.z,
      rig.horseState.vel.x, rig.horseState.vel.y, rig.horseState.vel.z,
      rig.horseState.yaw, rig.horseState.pitch].every(Number.isFinite)).toBe(true);
  });
});
