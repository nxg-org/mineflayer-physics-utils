import { describe, it } from "mocha";
import expect from "expect";
import md from "minecraft-data";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import { initSetup } from "../src";
import { BotcraftPhysics } from "../src/physics/engines";
import { EntityState, PlayerState } from "../src/physics/states";
import { EPhysicsCtx } from "../src/physics/settings";
import { applyMdToNewEntity, applyToPlayerState, convertPlayerState } from "../src/util/physicsUtils";

const version = "1.21.4";
const mcData = md(version);

initSetup(mcData);

function createFakeBot() {
  const entityData: any = {
    position: new Vec3(0, 64, 0),
    velocity: new Vec3(0, 0, 0),
    onGround: false,
    isInWater: false,
    isUnderWater: false,
    isInLava: false,
    isUnderLava: false,
    isInWeb: false,
    isCollidedHorizontally: false,
    isCollidedHorizontallyMinor: false,
    isCollidedVertically: false,
    yaw: 0,
    pitch: 0,
    effects: [],
    attributes: {},
    metadata: [],
    equipment: [],
    elytraFlying: false,
    fallFlying: false,
  };
  const entity: any = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, entityData);

  entity.equipment[4] = { name: "elytra" };
  entity.equipment[5] = null;

  const bot: any = {
    entity,
    inventory: { slots: [] },
    jumpTicks: 0,
    jumpQueued: false,
    flyJumpTriggerTime: 0,
    sprintTriggerTime: 0,
    fireworkRocketDuration: 0,
    usingHeldItem: false,
    version,
    food: 20,
    game: { gameMode: "survival" },
    registry: mcData,
    getControlState: () => false,
    getEquipmentDestSlot: () => 6,
    setControlState: () => {},
  };

  bot.inventory.slots[6] = { name: "elytra" };
  return bot as Bot;
}

describe("fallFlying compatibility alias", () => {
  it("keeps PlayerState elytraFlying mirrored to fallFlying", () => {
    const bot = createFakeBot();
    const physics = new BotcraftPhysics(mcData);
    const state = new PlayerState(physics, bot);

    state.fallFlying = true;
    expect(state.elytraFlying).toBe(true);

    state.elytraFlying = false;
    expect(state.fallFlying).toBe(false);

    (bot.entity as any).elytraFlying = false;
    (bot.entity as any).fallFlying = true;
    state.update(bot);
    expect(state.fallFlying).toBe(true);
    expect(state.elytraFlying).toBe(true);

    state.elytraFlying = false;
    state.apply(bot);
    expect((bot.entity as any).fallFlying).toBe(false);
    expect((bot.entity as any).elytraFlying).toBe(false);
  });

  it("keeps EntityState elytraFlying mirrored to fallFlying", () => {
    const bot = createFakeBot();
    (bot.entity as any).elytraFlying = false;
    (bot.entity as any).fallFlying = true;

    const physics = new BotcraftPhysics(mcData);
    const state = EntityState.CREATE_FROM_BOT(physics, bot);

    expect(state.fallFlying).toBe(true);
    expect(state.elytraFlying).toBe(true);

    state.elytraFlying = false;
    expect(state.fallFlying).toBe(false);

    state.applyToBot(bot);
    expect((bot.entity as any).fallFlying).toBe(false);
    expect((bot.entity as any).elytraFlying).toBe(false);
  });

  it("maps legacy player states through fallFlying while preserving compatibility output", () => {
    const bot = createFakeBot();
    const physics = new BotcraftPhysics(mcData);
    const legacyState: any = {
      pos: new Vec3(1, 2, 3),
      vel: new Vec3(4, 5, 6),
      elytraFlying: true,
    };

    const state = convertPlayerState(bot, legacyState, physics);
    expect(state.fallFlying).toBe(true);
    expect(state.elytraFlying).toBe(true);

    const roundTripped: any = {
      pos: new Vec3(0, 0, 0),
      vel: new Vec3(0, 0, 0),
    };
    applyToPlayerState(state, roundTripped);

    expect(roundTripped.fallFlying).toBe(true);
    expect(roundTripped.elytraFlying).toBe(true);
  });
});
