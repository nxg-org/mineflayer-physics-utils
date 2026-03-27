import { Bot } from "mineflayer";
import { PlayerState } from "../../src/physics/states";
import {
  buildManagedBot,
  getBotOptionsFromArgs,
  performElytraTakeoff,
  type PhysicsBot,
  type PhysicsSwitcher,
  sleep,
} from "../helpers/manual/botSetup";

type ElytraBot = PhysicsBot & {
  elytraFly: () => Promise<void>;
  fireworkRocketDuration: number;
};

type FlightSample = {
  tick: number;
  position: string;
  velocity: string;
  onGround: boolean;
  elytraFlying: boolean;
  fireworkTicks: number;
};

let activeBot: Bot;

function getBotOptions() {
  return getBotOptionsFromArgs({
    defaultUsername: "testingbot",
    usernameIndex: 4,
    versionIndex: 5,
    authIndex: 6,
  });
}

function findInventoryItem(bot: Bot, itemName: string) {
  return bot.inventory.items().find((item) => item.name === itemName) ?? null;
}

function findEquippedItem(bot: Bot, destination: "hand" | "torso" | "off-hand", itemName: string) {
  const slot = (() => {
    switch (destination) {
      case "hand":
        return 0;
      case "off-hand":
        return 1;
      case "torso":
        return 4;
    }
  })();
  const item = bot.entity.equipment[slot];
  return item?.name === itemName ? item : null;
}

function findElytra(bot: Bot) {
  return findInventoryItem(bot, "elytra") ?? findEquippedItem(bot, "torso", "elytra");
}

function findFireworkRocket(bot: Bot) {
  return (
    findInventoryItem(bot, "firework_rocket") ??
    findEquippedItem(bot, "hand", "firework_rocket") ??
    findEquippedItem(bot, "off-hand", "firework_rocket")
  );
}

async function ensureFlightLoadout(bot: Bot) {
  bot.chat(`/tp ${bot.username} 0 200 0`);
  await sleep(1000);

  const elytra = findElytra(bot);
  if (!elytra) {
    throw new Error("No elytra found in inventory after /give");
  }

  const firework = findFireworkRocket(bot);
  if (!firework) {
    throw new Error("No firework rockets found in inventory after /give");
  }

  await bot.equip(elytra, "torso");
  await bot.equip(firework, "hand");
}

function formatFlightState(bot: ElytraBot, state: PlayerState | null) {
  return [
    `pos=${bot.entity.position.toString()}`,
    `vel=${bot.entity.velocity.toString()}`,
    `onGround=${bot.entity.onGround}`,
    `elytraFlying=${bot.entity.elytraFlying}`,
    `fireworkTicks=${bot.fireworkRocketDuration}`,
    state ? `fallFlying=${state.fallFlying}` : null,
    state ? `pose=${state.pose}` : null,
  ]
    .filter((value): value is string => value != null)
    .join(" ");
}

async function collectFlightSamples(bot: ElytraBot, ticks: number): Promise<FlightSample[]> {
  const samples: FlightSample[] = [];

  for (let tick = 0; tick < ticks; tick++) {
    await bot.waitForTicks(1);
    samples.push({
      tick,
      position: bot.entity.position.toString(),
      velocity: bot.entity.velocity.toString(),
      onGround: bot.entity.onGround,
      elytraFlying: bot.entity.elytraFlying ?? false,
      fireworkTicks: bot.fireworkRocketDuration,
    });
  }

  return samples;
}

function printFlightSummary(samples: FlightSample[]) {
  if (samples.length === 0) return;

  const first = samples[0];
  const last = samples[samples.length - 1];
  const activeTicks = samples.filter((sample) => sample.elytraFlying).length;
  const boostedTicks = samples.filter((sample) => sample.fireworkTicks > 0).length;

  console.log("[elytra] start", first);
  console.log("[elytra] end", last);
  console.log("[elytra] summary", {
    sampledTicks: samples.length,
    activeTicks,
    boostedTicks,
  });
}

async function triggerElytraFlight(bot: ElytraBot, pitchDeg = 50) {
  await performElytraTakeoff(bot, Math.PI, pitchDeg * Math.PI / 180);
}

async function runElytraTest(bot: ElytraBot, dir: number, physicsSwitcher: PhysicsSwitcher) {
  await ensureFlightLoadout(bot);
  console.log("[elytra] launch state", formatFlightState(bot, physicsSwitcher.getState()));
  await triggerElytraFlight(bot, dir);
  const samples = await collectFlightSamples(bot, 80);
  printFlightSummary(samples);
  console.log("[elytra] final state", formatFlightState(bot, physicsSwitcher.getState()));
  bot.clearControlStates();
}

async function handleChatCommand(
  bot: ElytraBot,
  username: string,
  message: string,
  physicsSwitcher: PhysicsSwitcher,
) {
  if (username === bot.username) return;

  const [command, ...args] = message.split(" ");

  switch (command) {
    case "prep":
      try {
        await ensureFlightLoadout(bot);
        bot.chat("Elytra loadout equipped.");
      } catch (error) {
        bot.chat(`Prep failed: ${String(error)}`);
      }
      return;
    case "fly": {
      const deg = args.length > 0 ? parseInt(args[0]) : 50;
      try {
        await runElytraTest(bot, deg, physicsSwitcher);
        bot.chat("Elytra test completed. Check console logs.");
      } catch (error) {
        bot.chat(`Elytra test failed: ${String(error)}`);
      }
      return;
    }
    case "boost":
      bot.activateItem();
      return;
    case "status":
      bot.chat(formatFlightState(bot, physicsSwitcher.getState()));
      return;
    case "reset":
      physicsSwitcher.reset();
      bot.quit();
      await sleep(3000);
      activeBot = buildBot();
      return;
    default:
      return;
  }
}

function registerFlightLogging(bot: ElytraBot) {
  bot.on("entityElytraFlew", (entity) => {
    if (entity.id !== bot.entity.id) return;
    console.log("[elytra] entityElytraFlew", bot.entity.position.toString(), bot.entity.velocity.toString());
  });

  bot.on("usedFirework", () => {
    console.log("[elytra] usedFirework", {
      fireworkRocketDuration: bot.fireworkRocketDuration,
    });
  });
}

function buildBot() {
  return buildManagedBot<ElytraBot>(getBotOptions, {
    afterCreate: (bot) => {
      registerFlightLogging(bot);
    },
    onSpawn: async (bot, helpers) => {
      helpers.physicsSwitcher.enable();
      console.log("[elytra] new engine enabled");
      console.log("[elytra] chat commands: prep | fly | boost | status | reset");
    },
    onChat: async (bot, username, message, helpers) => {
      await handleChatCommand(bot, username, message, helpers.physicsSwitcher);
    },
  });
}

activeBot = buildBot();
