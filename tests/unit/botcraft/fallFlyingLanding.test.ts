import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { PlayerPoses } from "../../../src/physics/states/poses";
import { collectMovementDeltas } from "../../helpers/unit/botcraftAuditSupport";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

const version = "1.21.4";
const groundLevel = 67;

describe("Botcraft fall-flying landing", () => {
  it("clears sprinting while fall-flying before landing", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel + 1, 0),
      groundLevel,
    });
    const fakeWorld = createFlatWorld(version, groundLevel) as any;

    rig.playerState.control.forward = true;
    rig.playerState.control.sprint = true;
    rig.playerState.sprinting = true;
    rig.playerState.elytraEquipped = true;
    rig.playerState.fallFlying = true;
    rig.playerState.vel = new Vec3(0, -0.5, -1.5);

    for (let i = 0; i < 8 && !rig.playerState.onGround; i++) {
      rig.physics.simulate(rig.playerCtx, fakeWorld);
      rig.playerState.apply(rig.fakePlayer);
    }

    expect(rig.playerState.onGround).toBe(true);
    expect(rig.playerState.sprinting).toBe(false);
  });

  it("keeps fall-flying active through the initial grounded handoff", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel + 1, 0),
      groundLevel,
    });
    const fakeWorld = createFlatWorld(version, groundLevel) as any;

    rig.playerState.control.forward = true;
    rig.playerState.elytraEquipped = true;
    rig.playerState.fallFlying = true;
    rig.playerState.pose = PlayerPoses.FALL_FLYING;
    rig.playerState.vel = new Vec3(0, -1.5, -1.5);
    rig.playerState.pitch = 0.6;

    rig.physics.simulate(rig.playerCtx, fakeWorld);
    rig.playerState.apply(rig.fakePlayer);

    const firstZ = rig.playerState.pos.z;
    expect(rig.playerState.onGround).toBe(true);
    expect(rig.playerState.fallFlying).toBe(true);

    rig.physics.simulate(rig.playerCtx, fakeWorld);
    rig.playerState.apply(rig.fakePlayer);

    expect(Math.abs(rig.playerState.pos.z)).toBeGreaterThan(Math.abs(firstZ));
    expect(rig.playerState.fallFlying).toBe(true);
  });

  it("treats the post-glide fall-flying pose as slow movement", () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(0, groundLevel, 0),
      groundLevel,
    });
    const fakeWorld = createFlatWorld(version, groundLevel) as any;

    rig.playerState.control.forward = true;
    rig.playerState.control.sprint = true;
    rig.playerState.pose = PlayerPoses.FALL_FLYING;
    rig.playerState.fallFlying = false;
    rig.playerState.sprinting = true;

    rig.physics.simulate(rig.playerCtx, fakeWorld);
    rig.playerState.apply(rig.fakePlayer);

    expect(rig.playerState.sprinting).toBe(false);
  });

  it("matches Grim's unique predicted movement through the glide landing", () => {
    const grimExpectedY = [
      0.41999998688697815,
      0.33319999363422365,
      0.2481359995094576,
      0.1418793189508764,
      0.11944026489649377,
      0.09745146149523642,
      0.07590243374260109,
      0.05478438613400336,
      0.03408869947472828,
      0.013306925362007765,
      -0.0054622919370217235,
      -0.022457741925541133,
      -0.03744772910716273,
      -0.05066889805867315,
      -0.0623295930086175,
      -0.07261503433664765,
      -0.08168646187497656,
      -0.08968746111191072,
      -0.09674434258996255,
      -0.10296851216839643,
      -0.10845022984342007,
      -0.11330016092702816,
      -0.11759707422358877,
      -0.12133739876879134,
      -0.12465958314029121,
      -0.12758975922298324,
      -0.13017417016821733,
      -0.07352947506304787,
    ];

    const grimExpectedLandingZ = [
      { gl: 223, z: 0.14972322502492966 },
      { gl: 224, z: 0.15000799421971844 },
      { gl: 225, z: 0.15028991572527511 },
      { gl: 226, z: 0.15028991572527511 },
      { gl: 227, z: 0.08205829398600022 },
      { gl: 228, z: 0.04480382851635612 },
      { gl: 229, z: 0.024462890369930445 },
      { gl: 230, z: 0.013356738141982023 },
      { gl: 231, z: 0.007292779025522185 },
      { gl: 232, z: 0.003981857347935113 },
      { gl: 233, z: 0.0 },
    ];

    const grimExpectedTransitionYZ = [
      { tick: 27, y: -0.13017417016821733, z: 0.13713586688924467 },
      { tick: 28, y: -0.073529475063944787, z: 0.14943557937639876 },
    ];

    const actual = collectMovementDeltas({
      groundY: 231,
      ticks: grimExpectedY.length,
      startFallFlyingTick: 3,
      fallFlyingClearDelayTicks: 5,
      holdJump: true,
      releaseJumpTick: 1,
      holdForward: false,
      yaw: Math.PI,
      pitch: 0,
    });

    const tolerance = 1e-3;
    for (let i = 0; i < grimExpectedY.length; i++) {
      const diffY = Math.abs(actual[i].y - grimExpectedY[i]);
      if (diffY > tolerance) {
        throw new Error(
          `Grim landing sequence diverged at tick ${i + 1}: expected y=${grimExpectedY[i]}, got y=${actual[i].y}`,
        );
      }
    }

    for (const checkpoint of grimExpectedTransitionYZ) {
      const sample = actual[checkpoint.tick - 1];
      if (sample == null) {
        throw new Error(`Missing transition sample at tick ${checkpoint.tick}`);
      }

      const diffY = Math.abs(sample.y - checkpoint.y);
      if (diffY > tolerance) {
        throw new Error(
          `Grim transition sequence diverged at tick ${checkpoint.tick} y: expected ${checkpoint.y}, got ${sample.y}`,
        );
      }

      const diffZ = Math.abs(sample.z - checkpoint.z);
      if (diffZ > tolerance) {
        throw new Error(
          `Grim transition sequence diverged at tick ${checkpoint.tick} z: expected ${checkpoint.z}, got ${sample.z}`,
        );
      }
    }

    const landingActual = collectMovementDeltas({
      groundY: 231,
      ticks: grimExpectedY.length + grimExpectedLandingZ.length + 2,
      startFallFlyingTick: 3,
      fallFlyingClearDelayTicks: 5,
      holdJump: true,
      releaseJumpTick: 1,
      holdForward: false,
      yaw: Math.PI,
      pitch: 0,
    });

    const landingStart = grimExpectedY.length + 1;
    const horizontalTolerance = 5e-3;
    for (let i = 0; i < grimExpectedLandingZ.length; i++) {
      const actualZ = landingActual[landingStart + i]?.z;
      const expected = grimExpectedLandingZ[i];
      if (actualZ == null) {
        throw new Error(`Missing landing z sample at tick ${landingStart + i + 1}`);
      }

      if (expected.z == null) {
        continue;
      }

      const diffZ = Math.abs(actualZ - expected.z);
      if (diffZ > horizontalTolerance) {
        throw new Error(
          `Grim landing sequence diverged at /gl ${expected.gl}: expected z=${expected.z}, got z=${actualZ}`,
        );
      }
    }
  });
});
