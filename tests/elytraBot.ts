import { Bot, createBot } from "mineflayer";
import loader, { BotcraftPhysics, EntityState, EPhysicsCtx } from "../src/index";
import { PlayerState } from "../src/physics/states";

type PhysicsBot = Bot & {
  physics: {
    yawSpeed: number;
    pitchSpeed: number;
    autojumpCooldown: number;
    simulatePlayer: (...args: any[]) => unknown;
  };
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

const rl = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

let activeBot: Bot;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBotOptions() {
  return {
    host: process.argv[2] ?? "localhost",
    port: Number(process.argv[3]),
    username: process.argv[4] ?? "testingbot",
    version: process.argv[5],
    auth: (process.argv[6] as any) ?? "offline",
  };
}

function createPhysicsSwitcher(bot: PhysicsBot) {
  let state: PlayerState | null = null;

  const enable = () => {
    const physics = new BotcraftPhysics(bot.registry);
    const ctx = EPhysicsCtx.FROM_BOT(physics, bot);
    state = ctx.state as PlayerState;

    (EntityState.prototype as any).apply = function applyState(this: EntityState, currentBot: Bot) {
      this.applyToBot(currentBot);
    };

    bot.physics.autojumpCooldown = 0;
    bot.physics.simulatePlayer = () => {
      state!.update(bot);
      ctx.state.jumpTicks = 0;
      return physics.simulate(ctx, bot.world);
    };
  };

  return {
    enable,
    getState: () => state,
  };
}

function findInventoryItem(bot: Bot, itemName: string) {
  return bot.inventory.items().find((item) => item.name === itemName) ?? null;
}

function findEquippedItem(bot: Bot, destination: "hand" | "torso" | "off-hand", itemName: string) {
  // const slot = bot.getEquipmentDestSlot(destination);
  // slot for dest is 0 for hjand, 1 for offhand, 4 for torso.
  const slot = (() => {
    switch (destination) {
      case "hand": return 0;
      case "off-hand": return 1;
      case "torso": return 4;
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
  // console.log(`/give ${bot.username} minecraft:elytra`);

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

function formatFlightState(bot: PhysicsBot, state: PlayerState | null) {
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

async function collectFlightSamples(bot: PhysicsBot, ticks: number): Promise<FlightSample[]> {
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

async function triggerElytraFlight(bot: PhysicsBot, pitchDeg = 50) {
  await bot.look(0, pitchDeg * Math.PI / 180);
  bot.setControlState("jump", true);
  await sleep(100);
  bot.setControlState("jump", false);
  await sleep(50);
  await bot.elytraFly();
  await sleep(50);
  bot.activateItem();
}

async function runElytraTest(bot: PhysicsBot, dir: number, physicsSwitcher: ReturnType<typeof createPhysicsSwitcher>) {
  await ensureFlightLoadout(bot);
  console.log("[elytra] launch state", formatFlightState(bot, physicsSwitcher.getState()));
  await triggerElytraFlight(bot, dir);
  const samples = await collectFlightSamples(bot, 80);
  printFlightSummary(samples);
  console.log("[elytra] final state", formatFlightState(bot, physicsSwitcher.getState()));
}

async function handleChatCommand(
  bot: PhysicsBot,
  username: string,
  message: string,
  physicsSwitcher: ReturnType<typeof createPhysicsSwitcher>,
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
      bot.quit();
      await sleep(3000);
      activeBot = buildBot();
      return;
    default:
      return;
  }
}

function registerConsoleRelay(bot: Bot) {
  rl.removeAllListeners("line");
  rl.on("line", (line: string) => bot.chat(line));
}

function registerFlightLogging(bot: PhysicsBot) {
  bot.on("entityElytraFlew", (entity) => {
    if (entity.id !== bot.entity.id) return;
    console.log("[elytra] entityElytraFlew", bot.entity.position.toString(), bot.entity.velocity.toString());
  });

  bot.on("usedFirework", () => {
    console.log("[elytra] usedFirework", {
      // fireworkEntityId: bot.fireworkEntityId,
      fireworkRocketDuration: bot.fireworkRocketDuration,
    });
  });
}

function registerLifecycle(bot: PhysicsBot) {
  const physicsSwitcher = createPhysicsSwitcher(bot);

  bot.once("spawn", async () => {
    bot.loadPlugin(loader);
    await bot.waitForTicks(20);
    // bot.physics.yawSpeed = 6000;
    // bot.physics.pitchSpeed = 6000;
    physicsSwitcher.enable();
    console.log("[elytra] new engine enabled");
    console.log("[elytra] chat commands: prep | fly | boost | status | reset");
  });

  bot.on("chat", (username, message) => {
    void handleChatCommand(bot, username, message, physicsSwitcher);
  });
}

function buildBot() {
  const bot = createBot(getBotOptions()) as PhysicsBot;

  registerLifecycle(bot);
  registerFlightLogging(bot);
  registerConsoleRelay(bot);

  bot.on("kicked", console.log);
  bot.on("error", console.log);

  return bot;
}

activeBot = buildBot();
