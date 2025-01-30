import { describe, it, beforeEach } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import md from "minecraft-data";
import block, { Block as PBlock } from "prismarine-block";
import { applyMdToNewEntity } from "../src/util/physicsUtils";
import { EPhysicsCtx, PhysicsWorldSettings } from "../src/physics/settings";
import { ControlStateHandler } from "../src/physics/player";
import { BotcraftPhysics, EntityPhysics, IPhysics } from "../src/physics/engines";
import { initSetup } from "../src/index";
import { PlayerState } from "../src/physics/states";
import { Bot, ControlState } from "mineflayer";

const version = "1.12.2";
const mcData = md(version);
const Engine = BotcraftPhysics;
const Block = block(version) as typeof PBlock;

const groundLevel = 67;
const floatingOffset = 100 - groundLevel;
const control: { [key: string]: boolean } = {};

class FakeWorld {
  overrideBlocks: { [key: string]: PBlock } = {};

  setOverrideBlock(pos: Vec3, type: number) {
    pos = pos.floored();
    const block = new Block(type, 0, 0);
    block.position = pos;
    this.overrideBlocks[`${pos.x},${pos.y},${pos.z}`] = block;
  }

  clearOverrides() {
    this.overrideBlocks = {};
  }

  getBlock(pos: Vec3) {
    pos = pos.floored();
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (this.overrideBlocks[key]) {
      return this.overrideBlocks[key];
    }

    const type = pos.y < groundLevel ? mcData.blocksByName.stone.id : mcData.blocksByName.air.id;
    const b = new Block(type, 0, 0);
    b.position = pos;
    return b;
  }
}

function createFakePlayer(pos: Vec3, tmpGroundLevel: number = groundLevel) {
  const onGround = pos.y === tmpGroundLevel
  return {
    entity: {
      position: pos,
      velocity: new Vec3(0, onGround ? -0.08 : 0, 0),
      onGround: onGround,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: false,
      yaw: 0,
      effects: [],
      attributes: {}
    },
    jumpTicks: 0,
    jumpQueued: false,
    version: version,
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

initSetup(mcData);

const playerType = mcData.entitiesByName["player"];

describe("Physics Simulation Tests", () => {
  let fakePlayer: ReturnType<typeof createFakePlayer> | any;
  let physics: IPhysics;
  let playerCtx: EPhysicsCtx;
  let playerState: PlayerState;
  const fakeWorld = new FakeWorld();

  const setupEntity = (yOffset: number) => {
    fakePlayer = createFakePlayer(new Vec3(0, groundLevel + yOffset, 0), groundLevel);
    fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, playerType, fakePlayer.entity);
    physics = new Engine(mcData);
    playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer);
    playerState = playerCtx.state as PlayerState;
    playerState.control = ControlStateHandler.DEFAULT();
  };

  afterEach(() => {
    fakeWorld.clearOverrides();
  });

  it("should maintain position when gravity is zero", () => {
    setupEntity(floatingOffset);
    fakePlayer.entity.velocity = new Vec3(0, 0, 0);
    playerState.vel.y = 0;
    playerCtx.gravity = 0;

    for (let i = 0; i < 2; i++) {
      // playerState.update(fakePlayer);
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
    }

    expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel + floatingOffset, 0));
  });

  it("should move forward correctly given proper gravity", () => {
    setupEntity(0);
    playerState.control.forward = true;
    playerState.control.sprint = true;

    for (let i = 0; i < 10; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
      // console.log(fakePlayer.entity.position, playerState.pos, playerState.vel, playerState.age)
    }

    if (playerState.control.forward) {
      expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel, -2.4694812397932626));
    } else {
      expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel, 0));
    }
  });

  it("sprint-jumping", () => {
    setupEntity(0);
    playerState.control.forward = true;
    playerState.control.sprint = true;

    for (let i = 0; i < 4; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
      // console.log(playerState.sprinting, playerState.onGround, playerState.pos)
    }

    playerState.control.jump = true;

    for (let i = 0; i < 12; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
      // console.log(playerState.sprinting, playerState.onGround, playerState.pos)
    }

    expect(fakePlayer.entity.position.y).toEqual(groundLevel);
    expect(fakePlayer.entity.position.z).toEqual(-4.085029471928113);
  });

  it("walk_fallspeed", () => {
    setupEntity(floatingOffset);
    playerState.control.forward = true;

    while (!fakePlayer.entity.onGround && playerState.age < 100) {
      physics.simulate(playerCtx, fakeWorld);
      // console.log(fakePlayer.entity.position, playerState.pos, playerState.vel, playerState.age)
      playerState.apply(fakePlayer);
    }

    expect(fakePlayer.entity.position.z).toEqual(-5.082680598494437);
    expect(fakePlayer.entity.position.y).toEqual(groundLevel);
  });

  it ("sprint_fallspeed", () => {
    setupEntity(floatingOffset);
    playerState.control.forward = true;
    playerState.control.sprint = true;

    // console.log(playerState.vel)
    while (!fakePlayer.entity.onGround && playerState.age < 100) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
    }

    // console.log(fakePlayer.entity.position, landingPos, playerState.pos, playerState.control)

    expect(fakePlayer.entity.position.z).toEqual(-7.624010798740387);
    expect(fakePlayer.entity.position.y).toEqual(groundLevel);
  })

  it("should restore position after gravity toggle", () => {
    setupEntity(floatingOffset);
    const orgGravity = playerCtx.gravity;
    fakePlayer.entity.velocity = new Vec3(0, 0, 0);
    playerState.vel.y = 0;
    playerCtx.gravity = 0;

    for (let i = 0; i < 5; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
    }
    expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel + floatingOffset, 0));
    playerCtx.gravity = orgGravity;

    while (!fakePlayer.entity.onGround && playerState.age < 100) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
    }

    expect(fakePlayer.entity.position.y).toEqual(groundLevel); // Verify movement in Z direction
  });

  it("should jump and fall correctly", () => {
    setupEntity(0);
    playerState.control.jump = true;

    for (let i = 0; i < 3; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
    }

    expect(fakePlayer.entity.position.y).toEqual(groundLevel + 1.001335979112147);

    for (let i = 0; i < 9; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
    }

    expect(fakePlayer.entity.position.y).toEqual(groundLevel);
  });

  it("horizonal collision detection", () => {
    setupEntity(0);
    fakeWorld.setOverrideBlock(new Vec3(0, groundLevel + 1, -2), mcData.blocksByName.dirt.id);
    playerState.control.forward = true;

    for (let i = 0; i < 10; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer);
      // console.log(fakePlayer.entity.position, playerState.isCollidedHorizontally);
    }

    expect(playerState.pos.z).toEqual(-0.7);
    expect(playerState.isCollidedHorizontally).toEqual(true);
  });
});
