import { Bot, createBot } from "mineflayer";
import { goals, pathfinder } from "mineflayer-pathfinder";
import { Entity } from "prismarine-entity";
import loader, { BotcraftPhysics, EntityState, EPhysicsCtx } from "../src/index";
import { PlayerState } from "../src/physics/states";

type PhysicsBot = Bot & {
  physics: {
    yawSpeed: number;
    pitchSpeed: number;
    autojumpCooldown: number;
    simulatePlayer: (...args: any[]) => unknown;
  };
};

type ControlName = Parameters<Bot["setControlState"]>[0];

const rl = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

let activeBot: Bot;

function getBotOptions() {
  return {
    host: process.argv[2] ?? "localhost",
    port: Number(process.argv[3]),
    username: "testingbot",
    version: process.argv[4],
    auth: (process.argv[5] as any) ?? "offline",
  };
}

function createGroundTracker(bot: Bot) {
  const groundedPlayers: Record<string, boolean> = {};

  return (entity: Entity) => {
    if (!entity.username || entity.username === bot.username) return;

    const isOnWholeBlock = Math.floor(entity.position.y) === entity.position.y;
    if (!isOnWholeBlock) {
      groundedPlayers[entity.username] = false;
      return;
    }

    if (groundedPlayers[entity.username]) return;

    const block = bot.blockAt(entity.position);
    if (!block) return;

    const waterId = bot.registry.blocksByName.water.id;
    const lavaId = bot.registry.blocksByName.lava.id;
    if (block.type === waterId || block.type === lavaId) return;

    groundedPlayers[entity.username] = true;
  };
}

function createPhysicsSwitcher(bot: PhysicsBot) {
  let usingNewPhysics = false;
  let state: PlayerState | null = null;

  const enable = () => {
    if (usingNewPhysics) return false;

    usingNewPhysics = true;

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

    return true;
  };

  const reset = () => {
    usingNewPhysics = false;
    state = null;
  };

  return {
    enable,
    reset,
    getState: () => state,
    isEnabled: () => usingNewPhysics,
  };
}

function parseControl(name: string): ControlName {
  return name as ControlName;
}

function setControls(bot: Bot, controls: string[]) {
  bot.clearControlStates();
  for (const control of controls) {
    bot.setControlState(parseControl(control), true);
  }
}

async function printSimulation(bot: Bot, ticks: number) {
  for (let i = 0; i <= ticks; i++) {
    console.log(bot.entity.position, bot.entity.velocity, i);
    await bot.waitForTicks(1);
  }
}

function registerLifecycle(bot: PhysicsBot) {
  bot.once("spawn", async () => {
    bot.loadPlugin(loader);
    bot.loadPlugin(pathfinder);
    await bot.waitForTicks(20);
    bot.physics.yawSpeed = 6000;
    bot.physics.pitchSpeed = 6000;
  });
}

function registerMovementLogging(bot: Bot) {
  let wasOnGround = false;

  bot.on("move", () => {
    if (bot.entity.onGround && !wasOnGround) {
      // Hook for landing diagnostics.
    }
    wasOnGround = bot.entity.onGround;
  });

  bot.on("entityMoved", createGroundTracker(bot));
}

function registerConsoleRelay(bot: Bot) {
  rl.removeAllListeners("line");
  rl.on("line", (line: string) => bot.chat(line));
}

function buildStatusMessages(bot: Bot, state: PlayerState | null) {
  const position = `pos: ${bot.entity.position.toString()}, vel: ${bot.entity.velocity.toString()}, yaw: ${bot.entity.yaw}, pitch: ${bot.entity.pitch}`;
  const collision = `onGround: ${bot.entity.onGround}, hCol: ${(bot.entity as any).isCollidedHorizontally}, vCol: ${(bot.entity as any).isCollidedVertically}, inWater: ${(bot.entity as any).isInWater}, inLava: ${(bot.entity as any).isInLava}`;
  const playerState = state
    ? `crouching: ${state.crouching}, sprinting: ${state.sprinting}`
    : null;

  return [position, collision, playerState].filter((message): message is string => message != null);
}

async function handleChatCommand(
  bot: Bot,
  username: string,
  message: string,
  physicsSwitcher: ReturnType<typeof createPhysicsSwitcher>,
) {
  const [command, ...args] = message.split(" ");
  const author = bot.nearestEntity((entity) => entity.username === username);

  switch (command) {
    case "using":
      bot.chat(`Using new physics: ${physicsSwitcher.isEnabled()}`);
      return;
    case "lookatme":
      if (!author) {
        bot.chat("I can't see you!");
        return;
      }
      bot.lookAt(author.position.offset(0, author.height, 0));
      return;
    case "status":
      for (const status of buildStatusMessages(bot, physicsSwitcher.getState())) {
        bot.chat(status);
      }
      return;
    case "use":
      if (bot.usingHeldItem) bot.deactivateItem();
      else bot.activateItem();
      return;
    case "useoff":
      bot.deactivateItem();
      bot.activateItem(true);
      return;
    case "control":
      if (args[0] === "clear") {
        bot.clearControlStates();
        return;
      }

      if (args.length === 1) {
        const control = parseControl(args[0]);
        bot.setControlState(control, !bot.getControlState(control));
        return;
      }

      bot.setControlState(parseControl(args[0]), args[1] === "true");
      return;
    case "sim": {
      const [duration, ...controls] = args;
      setControls(bot, controls);
      await printSimulation(bot, Number(duration));
      bot.clearControlStates();
      return;
    }
    case "reset":
      physicsSwitcher.reset();
      bot.quit();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      activeBot = buildBot();
      return;
    case "new":
      if (physicsSwitcher.enable()) {
        bot.chat("Switched to new physics!");
      }
      return;
    case "jump":
      bot.setControlState("jump", true);
      return;
    case "come":
      if (!author) {
        bot.chat(`Cannot see ${username}!`);
        return;
      }
      bot.pathfinder.setGoal(new goals.GoalNear(author.position.x, author.position.y, author.position.z, 3));
      return;
    case "goto":
      bot.pathfinder.setGoal(new goals.GoalNear(Number(args[0]), Number(args[1]), Number(args[2]), 3));
      return;
    case "stop":
      bot.deactivateItem();
      bot.pathfinder.stop();
      bot.clearControlStates();
      bot.chat("Stopped!");
      return;
    default:
      return;
  }
}

function registerChatCommands(bot: PhysicsBot) {
  const physicsSwitcher = createPhysicsSwitcher(bot);

  bot.on("chat", (username, message) => {
    void handleChatCommand(bot, username, message, physicsSwitcher);
  });
}

function buildBot() {
  const bot = createBot(getBotOptions()) as PhysicsBot;

  registerLifecycle(bot);
  registerMovementLogging(bot);
  registerChatCommands(bot);
  registerConsoleRelay(bot);

  return bot;
}

activeBot = buildBot();
