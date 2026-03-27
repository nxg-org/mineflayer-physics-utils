import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import md from "minecraft-data";
import block, { Block as PBlock } from "prismarine-block";
import { applyMdToNewEntity } from "../src/util/physicsUtils";
import { EPhysicsCtx } from "../src/physics/settings";
import { ControlStateHandler } from "../src/physics/player";
import { BotcraftPhysics } from "../src/physics/engines";
import { initSetup } from "../src/index";
import { PlayerState } from "../src/physics/states";
import { PlayerPoses } from "../src/physics/states/poses";
import { Bot, ControlState } from "mineflayer";
import { playerPoseCtx } from "../src/physics/states/poses";

const version = "1.21.4";
const mcData = md(version);
const Block = block(version) as typeof PBlock;
const groundLevel = 67;
const control: { [key: string]: boolean } = {};

class FakeWorld {
  getBlock(pos: Vec3) {
    pos = pos.floored();
    const type = pos.y < groundLevel ? mcData.blocksByName.stone.id : mcData.blocksByName.air.id;
    const b = new Block(type, 0, 0);
    b.position = pos;
    return b;
  }
}

class ConfigurableFakeWorld {
  constructor(private readonly floorY: number) {}

  getBlock(pos: Vec3) {
    pos = pos.floored();
    const type = pos.y < this.floorY ? mcData.blocksByName.stone.id : mcData.blocksByName.air.id;
    const b = new Block(type, 0, 0);
    b.position = pos;
    return b;
  }
}

function createFakePlayer(pos: Vec3) {
  const onGround = pos.y === groundLevel;
  return {
    entity: {
      position: pos,
      velocity: new Vec3(0, onGround ? -0.08 : 0, 0),
      onGround,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: false,
      yaw: 0,
      pitch: 0,
      effects: [],
      attributes: {}
    },
    jumpTicks: 0,
    jumpQueued: false,
    version,
    inventory: { slots: [] },
    equipment: [],
    food: 20,
    game: { gameMode: "survival" },
    registry: mcData,
    setControlState: (name: ControlState, value: boolean) => {
      control[name] = value;
    },
    getControlState: (name: ControlState) => {
      return control?.[name] ?? false;
    },
    getEquipmentDestSlot: () => {},
  };
}

function collectVerticalDeltas(
  options: {
    groundY?: number;
    ticks: number;
    startFallFlyingTick?: number;
    holdJump?: boolean;
    releaseJumpTick?: number;
    holdForward?: boolean;
    yaw?: number;
    pitch?: number;
  }
) {
  for (const key of Object.keys(control)) {
    delete control[key];
  }

  const baseY = options.groundY ?? groundLevel;
  const fakePlayer: ReturnType<typeof createFakePlayer> | any = createFakePlayer(new Vec3(0, groundLevel, 0));
  fakePlayer.entity.position = new Vec3(0, baseY, 0);
  fakePlayer.entity.velocity = new Vec3(0, 0, 0);
  fakePlayer.entity.onGround = true;
  fakePlayer.entity.yaw = options.yaw ?? 0;
  fakePlayer.entity.pitch = options.pitch ?? 0;
  fakePlayer.getEquipmentDestSlot = () => 6;
  fakePlayer.inventory.slots[6] = { name: "elytra" };
  fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, fakePlayer.entity);

  const physics = new BotcraftPhysics(mcData);
  const playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as Bot);
  const playerState = playerCtx.state as PlayerState;
  const fakeWorld = new ConfigurableFakeWorld(baseY) as any;

  playerState.control = ControlStateHandler.DEFAULT();
  playerState.control.jump = options.holdJump ?? true;
  playerState.control.forward = options.holdForward ?? false;
  playerState.yaw = options.yaw ?? 0;
  playerState.pitch = options.pitch ?? 0;

  const deltas: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < options.ticks; i++) {
    if (options.releaseJumpTick != null && i === options.releaseJumpTick) {
      playerState.control.jump = false;
    }

    if (options.startFallFlyingTick != null && i === options.startFallFlyingTick) {
      playerState.fallFlying = true;
      fakePlayer.entity.fallFlying = true;
    }

    const previousPos = playerState.pos.clone();
    physics.simulate(playerCtx, fakeWorld);
    playerState.apply(fakePlayer);
    deltas.push({
      x: playerState.pos.x - previousPos.x,
      y: playerState.pos.y - previousPos.y,
      z: playerState.pos.z - previousPos.z,
    });
  }

  return deltas;
}

initSetup(mcData);

describe("Botcraft jump cooldown", () => {
  it("uses vanilla player pose dimensions for fall-flying and crouching", () => {
    expect(playerPoseCtx[PlayerPoses.FALL_FLYING]).toEqual({ width: 0.6, height: 0.6 });
    expect(playerPoseCtx[PlayerPoses.SNEAKING]).toEqual({ width: 0.6, height: 1.5 });
  });

  it("keeps jumpTicks while jump is held in the air", () => {
    const fakePlayer: ReturnType<typeof createFakePlayer> | any = createFakePlayer(new Vec3(0, groundLevel, 0));
    fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, fakePlayer.entity);

    const physics = new BotcraftPhysics(mcData);
    const playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as Bot);
    const playerState = playerCtx.state as PlayerState;
    const fakeWorld = new FakeWorld() as any;

    playerState.control = ControlStateHandler.DEFAULT();
    playerState.control.jump = true;

    physics.simulate(playerCtx, fakeWorld);
    playerState.apply(fakePlayer);

    expect(playerState.jumpTicks).toBe(playerCtx.worldSettings.autojumpCooldown);
    expect(playerState.onGround).toBe(false);

    physics.simulate(playerCtx, fakeWorld);
    playerState.apply(fakePlayer);

    expect(playerState.jumpTicks).toBe(playerCtx.worldSettings.autojumpCooldown - 1);
    expect(playerState.onGround).toBe(false);
  });

  it("uses the vanilla player sprint off-ground speed", () => {
    const fakePlayer: ReturnType<typeof createFakePlayer> | any = createFakePlayer(new Vec3(0, groundLevel + 1, 0));
    fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, fakePlayer.entity);

    const physics = new BotcraftPhysics(mcData);
    const playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as Bot);
    const playerState = playerCtx.state as PlayerState;
    const fakeWorld = new FakeWorld() as any;

    playerState.control = ControlStateHandler.DEFAULT();
    playerState.control.forward = true;
    playerState.control.sprint = true;

    physics.simulate(playerCtx, fakeWorld);
    playerState.apply(fakePlayer);

    expect(playerState.sprinting).toBe(true);
    expect(playerState.pos.z).toBeCloseTo(-0.025479999019999998, 8);
  });

  it("does not let sprinting change fall-flying motion", () => {
    const makeState = (sprint: boolean) => {
      const fakePlayer: ReturnType<typeof createFakePlayer> | any = createFakePlayer(new Vec3(0, groundLevel + 10, 0));
      fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, fakePlayer.entity);

      const physics = new BotcraftPhysics(mcData);
      const playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as Bot);
      const playerState = playerCtx.state as PlayerState;

      playerState.control = ControlStateHandler.DEFAULT();
      playerState.control.forward = true;
      playerState.control.sprint = sprint;
      playerState.elytraEquipped = true;
      playerState.fallFlying = true;
      playerState.vel = new Vec3(0, -0.1, -0.6);

      return { physics, playerCtx, playerState };
    };

    const fakeWorld = new FakeWorld() as any;
    const withoutSprint = makeState(false);
    const withSprint = makeState(true);

    withoutSprint.physics.simulate(withoutSprint.playerCtx, fakeWorld);
    withSprint.physics.simulate(withSprint.playerCtx, fakeWorld);

    expect(withSprint.playerState.pos.x).toBeCloseTo(withoutSprint.playerState.pos.x, 12);
    expect(withSprint.playerState.pos.y).toBeCloseTo(withoutSprint.playerState.pos.y, 12);
    expect(withSprint.playerState.pos.z).toBeCloseTo(withoutSprint.playerState.pos.z, 12);
    expect(withSprint.playerState.vel.x).toBeCloseTo(withoutSprint.playerState.vel.x, 12);
    expect(withSprint.playerState.vel.y).toBeCloseTo(withoutSprint.playerState.vel.y, 12);
    expect(withSprint.playerState.vel.z).toBeCloseTo(withoutSprint.playerState.vel.z, 12);
  });

  it("clears sprinting while fall-flying before landing", () => {
    const fakePlayer: ReturnType<typeof createFakePlayer> | any = createFakePlayer(new Vec3(0, groundLevel + 1, 0));
    fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, fakePlayer.entity);

    const physics = new BotcraftPhysics(mcData);
    const playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as Bot);
    const playerState = playerCtx.state as PlayerState;
    const fakeWorld = new FakeWorld() as any;

    playerState.control = ControlStateHandler.DEFAULT();
    playerState.control.forward = true;
    playerState.control.sprint = true;
    playerState.sprinting = true;
    playerState.elytraEquipped = true;
    playerState.fallFlying = true;
    playerState.vel = new Vec3(0, -0.5, -1.5);

    for (let i = 0; i < 8 && !playerState.onGround; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
    }

    expect(playerState.onGround).toBe(true);
    expect(playerState.fallFlying).toBe(false);
    expect(playerState.sprinting).toBe(false);
  });

  it("stays grounded on the tick after a fall-flying landing", () => {
    const fakePlayer: ReturnType<typeof createFakePlayer> | any = createFakePlayer(new Vec3(0, groundLevel + 1, 0));
    fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, fakePlayer.entity);

    const physics = new BotcraftPhysics(mcData);
    const playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as Bot);
    const playerState = playerCtx.state as PlayerState;
    const fakeWorld = new FakeWorld() as any;

    playerState.control = ControlStateHandler.DEFAULT();
    playerState.control.forward = true;
    playerState.elytraEquipped = true;
    playerState.fallFlying = true;
    playerState.pose = PlayerPoses.FALL_FLYING;
    playerState.vel = new Vec3(0, -1.5, -1.5);
    playerState.pitch = 0.6;

    physics.simulate(playerCtx, fakeWorld);
    playerState.apply(fakePlayer);

    expect(playerState.onGround).toBe(true);
    expect(playerState.fallFlying).toBe(false);

    physics.simulate(playerCtx, fakeWorld);
    playerState.apply(fakePlayer);

    expect(playerState.pos.y).toBe(groundLevel);
    expect(playerState.onGround).toBe(true);
    expect(playerState.vel.y).toBeCloseTo(-0.0784000015258789, 8);
  });
  it("treats the post-glide fall-flying pose as slow movement", () => {
    const fakePlayer: ReturnType<typeof createFakePlayer> | any = createFakePlayer(new Vec3(0, groundLevel, 0));
    fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, fakePlayer.entity);

    const physics = new BotcraftPhysics(mcData);
    const playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as Bot);
    const playerState = playerCtx.state as PlayerState;
    const fakeWorld = new FakeWorld() as any;

    playerState.control = ControlStateHandler.DEFAULT();
    playerState.control.forward = true;
    playerState.control.sprint = true;
    playerState.pose = PlayerPoses.FALL_FLYING;
    playerState.fallFlying = false;
    playerState.sprinting = true;

    physics.simulate(playerCtx, fakeWorld);
    playerState.apply(fakePlayer);

    expect(playerState.sprinting).toBe(false);
  });

  it("matches Grim's unique predicted movement through the glide landing", () => {
    // Unique `P:` values extracted from the Grim debug log provided by the user.
    // Overlapping duplicate rows across screenshots were discarded.
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

    // Post-landing `P:` z-values extracted from the higher-quality screenshots.
    // Entries are keyed by the visible `/gl` value so the sequence can keep its
    // original alignment. Any obscured tick is marked with `z: null` and skipped.
    const grimExpectedLandingZ = [
      { gl: 223, z: 0.14972322502492966 },
      { gl: 224, z: null },
      { gl: 225, z: 0.15000799421971844 },
      { gl: 226, z: 0.08190437435737456 },
      { gl: 227, z: 0.0819000095129013 },
      { gl: 228, z: 0.044717410380638824 },
      { gl: 229, z: 0.02441576890784524 },
      { gl: 230, z: 0.013330978612111697 },
      { gl: 231, z: 0.0072787151676543785 },
      { gl: 232, z: 0.003974178943150891 },
      { gl: 233, z: 0.0 },
    ];

    const grimExpectedTransitionYZ = [
      {
        tick: 27,
        y: -0.13017417016821733,
        z: 0.13713586688924467,
      },
      {
        tick: 28,
        y: -0.073529475063944787,
        z: 0.14943557937639876,
      },
    ];

    // The early part of the log lines up when fall-flying starts on the fourth
    // movement tick of the sequence (0-based tick index 3), and the jump key is
    // released immediately after the player becomes airborne.
    const actual = collectVerticalDeltas({
      groundY: 231,
      ticks: grimExpectedY.length,
      startFallFlyingTick: 3,
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
          `Grim landing sequence diverged at tick ${i + 1}: expected y=${grimExpectedY[i]}, got y=${actual[i].y}`
        );
      }
    }

    const transitionTolerance = 1e-3;
    for (const checkpoint of grimExpectedTransitionYZ) {
      const sample = actual[checkpoint.tick - 1];
      if (sample == null) {
        throw new Error(`Missing transition sample at tick ${checkpoint.tick}`);
      }

      const diffY = Math.abs(sample.y - checkpoint.y);
      if (diffY > transitionTolerance) {
        throw new Error(
          `Grim transition sequence diverged at tick ${checkpoint.tick} y: expected ${checkpoint.y}, got ${sample.y}`
        );
      }

      const diffZ = Math.abs(sample.z - checkpoint.z);
      if (diffZ > transitionTolerance) {
        throw new Error(
          `Grim transition sequence diverged at tick ${checkpoint.tick} z: expected ${checkpoint.z}, got ${sample.z}`
        );
      }
    }

    const landingActual = collectVerticalDeltas({
      groundY: 231,
      ticks: grimExpectedY.length + grimExpectedLandingZ.length + 2,
      startFallFlyingTick: 3,
      holdJump: true,
      releaseJumpTick: 1,
      holdForward: false,
      yaw: Math.PI,
      pitch: 0,
    });

    const horizontalTolerance = 5e-3;
    // The first visible post-landing failure line in the screenshots is one tick
    // after the final visible Y sample, so preserve that offset here.
    const landingStart = grimExpectedY.length + 1;
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
          `Grim landing sequence diverged at /gl ${expected.gl}: expected z=${expected.z}, got z=${actualZ}`
        );
      }
    }
  });
});
