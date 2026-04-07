import { Bot } from "mineflayer";
import {
  buildManagedBot,
  getBotOptionsFromArgs,
  sleep,
} from "../helpers/manual/botSetup";
import {
  EBounceBot,
  EBounceController,
  MineflayerEBouncePort,
  ensureBounceLoadout,
  registerEBounceLogging,
} from "../helpers/manual/ebounceShared";

let activeBot: Bot;

function getBotOptions() {
  return getBotOptionsFromArgs({
    defaultUsername: "testingbot",
    versionIndex: 4,
    usernameIndex: 5,
    authIndex: 6,
  });
}

async function handleChatCommand(bot: EBounceBot, username: string, message: string, controller: EBounceController) {
  if (username === bot.username) return;

  const [command, ...args] = message.split(" ");

  switch (command) {
    case "prep":
      try {
        await ensureBounceLoadout(bot);
        bot.chat("Bounce loadout equipped.");
      } catch (error) {
        bot.chat(`Prep failed: ${String(error)}`);
      }
      return;
    case "bounce":
    case "start":
      if (args[0] != null) {
        const yaw = Number(args[0]);
        if (!Number.isNaN(yaw)) controller.setTargetYawDegrees(yaw);
      }
      if (args[1] != null) {
        const pitch = Number(args[1]);
        if (!Number.isNaN(pitch)) controller.setTargetPitchDegrees(pitch);
      }
      controller.beginBounce();
      bot.chat("Bounce sequence started.");
      return;
    case "boost":
      bot.activateItem();
      return;
    case "stop":
      controller.stopFlight();
      bot.chat("Bounce sequence stopped.");
      return;
    case "status":
      bot.chat(controller.status());
      return;
    case "yaw":
      if (args[0] === "clear") {
        controller.clearTargetYaw();
        bot.chat("Target yaw cleared.");
        return;
      }

      if (args[0] != null) {
        const yaw = Number(args[0]);
        if (!Number.isNaN(yaw)) {
          controller.setTargetYawDegrees(yaw);
          bot.chat(`Target yaw set to ${yaw.toFixed(1)}.`);
        }
      }
      return;
    case "pitch":
      if (args[0] === "clear") {
        controller.clearTargetPitch();
        bot.chat("Target pitch cleared.");
        return;
      }

      if (args[0] != null) {
        const pitch = Number(args[0]);
        if (!Number.isNaN(pitch)) {
          controller.setTargetPitchDegrees(pitch);
          bot.chat(`Target pitch set to ${pitch.toFixed(1)}.`);
        }
      }
      return;
    case "lockyaw":
      controller.setLockYaw(args[0] !== "false");
      bot.chat(`lockYaw=${args[0] !== "false"}`);
      return;
    case "lockpitch":
      controller.setLockPitch(args[0] !== "false");
      bot.chat(`lockPitch=${args[0] !== "false"}`);
      return;
    case "forcefallflying":
    case "forceff":
      controller.setForceClientSideFallFlying(args[0] !== "false");
      bot.chat(`forceClientSideFallFlying=${args[0] !== "false"}`);
      return;
    case "reset":
      controller.resetState();
      bot.quit();
      await sleep(3000);
      activeBot = buildBot();
      return;
    default:
      return;
  }
}

function buildBot() {
  let controller: EBounceController;

  return buildManagedBot<EBounceBot>(getBotOptions, {
    afterCreate: (bot, helpers) => {
      controller = new EBounceController(new MineflayerEBouncePort(bot, helpers.physicsSwitcher, true));
      registerEBounceLogging(bot, controller, true);
      bot.on("physicsTickBegin", () => {
        controller.tick();
      });
    },
    onSpawn: async (bot, helpers) => {
      helpers.physicsSwitcher.enable();
      console.log("[ebounce] new engine enabled");
      console.log("[ebounce] chat commands: prep | bounce [yawDeg] [pitchDeg] | boost | stop | status | yaw <deg|clear> | pitch <deg|clear> | lockyaw <true|false> | lockpitch <true|false> | forcefallflying <true|false> | reset");
      await ensureBounceLoadout(bot).catch(() => {});
    },
    onChat: async (bot, username, message) => {
      await handleChatCommand(bot, username, message, controller);
    },
  });
}

activeBot = buildBot();
