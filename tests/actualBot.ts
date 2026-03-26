import { Bot } from "mineflayer";
import { goals, pathfinder } from "mineflayer-pathfinder";
import { Entity } from "prismarine-entity";
import { PlayerState } from "../src/physics/states";
import { buildManagedBot, getBotOptionsFromArgs, type PhysicsBot, type PhysicsSwitcher, sleep } from "./util/botSetup";

type ControlName = Parameters<Bot["setControlState"]>[0];

let activeBot: Bot;

function getBotOptions() {
  return getBotOptionsFromArgs({
    defaultUsername: "testingbot",
    versionIndex: 4,
    authIndex: 5,
  });
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
  physicsSwitcher: PhysicsSwitcher,
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
      await sleep(3000);
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

function buildBot() {
  return buildManagedBot<PhysicsBot>(getBotOptions, {
    afterCreate: (bot) => {
      registerMovementLogging(bot);
    },
    onSpawn: async (bot) => {
      bot.loadPlugin(pathfinder);
      bot.physics.yawSpeed = 6000;
      bot.physics.pitchSpeed = 6000;
    },
    onChat: async (bot, username, message, helpers) => {
      await handleChatCommand(bot, username, message, helpers.physicsSwitcher);
    },
  });
}

activeBot = buildBot();
