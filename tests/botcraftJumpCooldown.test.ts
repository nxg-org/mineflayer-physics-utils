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
import { Bot, ControlState } from "mineflayer";

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

initSetup(mcData);

describe("Botcraft jump cooldown", () => {
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
});
