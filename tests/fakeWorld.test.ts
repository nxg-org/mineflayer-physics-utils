import { describe, it, beforeEach } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import md from "minecraft-data";
import block from "prismarine-block";
import { applyMdToNewEntity } from "../src/util/physicsUtils";
import { EPhysicsCtx, PhysicsWorldSettings } from "../src/physics/settings";
import { ControlStateHandler } from "../src/physics/player";
import { BotcraftPhysics, EntityPhysics, IPhysics } from "../src/physics/engines";
import { initSetup } from "../src/index";
import { PlayerState } from "../src/physics/states";
import { Bot, ControlState } from "mineflayer";

const version = "1.12.2";
const mcData = md(version);
const Block = (block as any)(version);

const groundLevel = 4;
const floatingOffset = 5;
const control: {[key: string]: boolean} = {};

const fakeWorld = {
  getBlock: (pos: Vec3) => {
    const type = pos.y < groundLevel ? mcData.blocksByName.stone.id : mcData.blocksByName.air.id;
    const b = new Block(type, 0, 0);
    b.position = pos;
    return b;
  },
};

function createFakePlayer(pos: Vec3, groundLevel: number) {
  return {
    entity: {
      position: pos,
      velocity: new Vec3(0, -0.08, 0),
      onGround: pos.y === groundLevel,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: false,
      yaw: 0,
      effects: [],
    },
    jumpTicks: 0,
    jumpQueued: false,
    version: version,
    inventory: { slots: [] },
    equipment: [],
    game: { gameMode: "survival" },
    registry: mcData,
    setControlState: (name: ControlState, value:boolean) => {
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
  let fakePlayer: ReturnType<typeof createFakePlayer>;
  let physics: IPhysics;
  let playerCtx: EPhysicsCtx;
  let playerState: PlayerState;

  const setupEntity = (yOffset: number) => {
    fakePlayer = createFakePlayer(new Vec3(0, groundLevel + yOffset, 0), groundLevel);
    fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, playerType, fakePlayer.entity) as any;
    physics = new BotcraftPhysics(mcData);
    playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as any);
    playerState = playerCtx.state as PlayerState;
    playerState.control = ControlStateHandler.DEFAULT();
  }



  it("should maintain position when gravity is zero", () => {
    setupEntity(floatingOffset);
    fakePlayer.entity.velocity = new Vec3(0, 0, 0);
    playerState.vel.y = 0
    playerCtx.gravity = 0;

    for (let i = 0; i < floatingOffset; i++) {
      console.log(playerState.pos, playerState.vel, playerState.onGround);
      // playerState.update(fakePlayer);
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer as any);
     
    }

    expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel + floatingOffset, 0));
  });

  it("should move forward correctly given proper gravity", () => {
    setupEntity(0);
    playerState.control.forward = true;
    playerState.control.sprint = true;

    for (let i = 0; i < 10; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer as any);
      console.log(playerState.pos, playerState.vel);
    }

    if (playerState.control.forward) {
      expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel, -2.4694812397932626));
    } else {
      expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel, 0));
    }
  });

  it("should restore position after gravity toggle", () => {
    setupEntity(floatingOffset);
    const orgGravity = playerCtx.gravity;
    fakePlayer.entity.velocity = new Vec3(0, 0, 0);
    playerState.vel.y = 0
    playerCtx.gravity = 0;

    for (let i = 0; i < 5; i++) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer as any);
    }
    expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel + floatingOffset, 0));
    playerCtx.gravity = orgGravity;

    while (!fakePlayer.entity.onGround) {
      physics.simulate(playerCtx, fakeWorld);
      playerState.apply(fakePlayer as any);
      
    }

    expect(fakePlayer.entity.position.y).toEqual(groundLevel); // Verify movement in Z direction
  });
});