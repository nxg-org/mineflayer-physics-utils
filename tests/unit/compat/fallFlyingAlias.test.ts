import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { BotcraftPhysics } from "../../../src/physics/engines";
import { EntityState, PlayerState } from "../../../src/physics/states";
import { applyToPlayerState, convertPlayerState } from "../../../src/util/physicsUtils";
import { createBotcraftPlayerRig } from "../../helpers/unit/botcraftTestSupport";

const version = "1.21.4";

function createFakeBot() {
  const rig = createBotcraftPlayerRig({
    version,
    position: new Vec3(0, 64, 0),
    groundLevel: 0,
  });

  rig.fakePlayer.entity.metadata = [];
  rig.fakePlayer.entity.equipment = [];
  rig.fakePlayer.entity.elytraFlying = false;
  rig.fakePlayer.entity.fallFlying = false;
  rig.fakePlayer.entity.equipment[4] = { name: "elytra" };
  rig.fakePlayer.entity.equipment[5] = null;
  rig.fakePlayer.inventory.slots[6] = { name: "elytra" };
  rig.fakePlayer.flyJumpTriggerTime = 0;
  rig.fakePlayer.sprintTriggerTime = 0;
  rig.fakePlayer.fireworkRocketDuration = 0;
  rig.fakePlayer.usingHeldItem = false;
  return rig.fakePlayer;
}

describe("fallFlying compatibility alias", () => {
  it("keeps PlayerState elytraFlying mirrored to fallFlying", () => {
    const bot = createFakeBot();
    const physics = new BotcraftPhysics(bot.registry);
    const state = new PlayerState(physics, bot);

    state.fallFlying = true;
    expect(state.elytraFlying).toBe(true);

    state.elytraFlying = false;
    expect(state.fallFlying).toBe(false);

    bot.entity.elytraFlying = false;
    bot.entity.fallFlying = true;
    state.update(bot);
    expect(state.fallFlying).toBe(true);
    expect(state.elytraFlying).toBe(true);

    state.elytraFlying = false;
    state.apply(bot);
    expect(bot.entity.fallFlying).toBe(false);
    expect(bot.entity.elytraFlying).toBe(false);
  });

  it("keeps EntityState elytraFlying mirrored to fallFlying", () => {
    const bot = createFakeBot();
    bot.entity.elytraFlying = false;
    bot.entity.fallFlying = true;

    const physics = new BotcraftPhysics(bot.registry);
    const state = EntityState.CREATE_FROM_BOT(physics, bot);

    expect(state.fallFlying).toBe(true);
    expect(state.elytraFlying).toBe(true);

    state.elytraFlying = false;
    expect(state.fallFlying).toBe(false);

    state.applyToBot(bot);
    expect(bot.entity.fallFlying).toBe(false);
    expect(bot.entity.elytraFlying).toBe(false);
  });

  it("maps legacy player states through fallFlying while preserving compatibility output", () => {
    const bot = createFakeBot();
    const physics = new BotcraftPhysics(bot.registry);
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
