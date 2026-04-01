import { Bot } from "mineflayer";
import { buildManagedBot, getBotOptionsFromArgs, sleep } from "../helpers/manual/botSetup";
import {
  ensurePitch40Loadout,
  MineflayerPitch40Port,
  Pitch40Bot,
  Pitch40Controller,
  registerPitch40Logging,
} from "../helpers/manual/pitch40Shared";

let activeBot: Bot;

function parseOptionalBoolean(value: string | undefined) {
  if (value == null) return false;
  const normalized = value.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "rocket";
}

function enableGroundMomentum(bot: Pitch40Bot) {
  bot.setControlState("forward", true);
  bot.setControlState("sprint", true);
}

function disableGroundMomentum(bot: Pitch40Bot) {
  bot.setControlState("forward", false);
  bot.setControlState("sprint", false);
}

function getBotOptions() {
  return getBotOptionsFromArgs({
    defaultUsername: "testingbot",
    versionIndex: 4,
    usernameIndex: 5,
    authIndex: 6,
  });
}

async function handleChatCommand(bot: Pitch40Bot, username: string, message: string, controller: Pitch40Controller) {
  if (username === bot.username) return;

  const [command, ...args] = message.split(" ");

  switch (command) {
    case "prep":
      try {
        await ensurePitch40Loadout(bot);
        bot.chat("Pitch40 loadout equipped.");
      } catch (error) {
        bot.chat(`Prep failed: ${String(error)}`);
      }
      return;
    case "launch": {
      const yawDeg = args[0] == null ? null : Number(args[0]);
      const takeoffPitchDeg = args[1] == null ? 50 : Number(args[1]);
      const useInitialFirework = parseOptionalBoolean(args[2]);
      enableGroundMomentum(bot);
      console.log(
        `[pitch40] Launching with yaw: ${yawDeg}, takeoff pitch: ${takeoffPitchDeg}, ` +
        `initial firework: ${useInitialFirework}`,
      );
      const started = await controller.launchAndBegin(
        bot,
        yawDeg != null && !Number.isNaN(yawDeg) ? yawDeg : null,
        Number.isNaN(takeoffPitchDeg) ? 50 : takeoffPitchDeg,
        useInitialFirework,
      );
      bot.chat(started ? "Pitch40 launch started." : "Pitch40 launch failed. Check console logs.");
      return;
    }
    case "pitch40":
    case "start": {
      enableGroundMomentum(bot);
      const started = controller.begin();
      bot.chat(started ? "Pitch40 started." : "Pitch40 start failed. Check console logs.");
      return;
    }
    case "stop":
      controller.stop();
      disableGroundMomentum(bot);
      bot.chat("Pitch40 stopped.");
      return;
    case "boost":
      bot.activateItem();
      return;
    case "status":
      bot.chat(controller.status());
      return;
    case "set": {
      if (args.length < 2) {
        bot.chat(
          "Usage: set <up|down|min|max|steps|fireworks|extra|maintain|cooldown|emergency|emergencypitch> <value>",
        );
        return;
      }

      const result = controller.configure(args[0].toLowerCase(), args[1]);
      bot.chat(result == null ? `Unknown setting: ${args[0]}` : result);
      return;
    }
    case "reset":
      controller.stop();
      bot.quit();
      await sleep(3000);
      activeBot = buildBot();
      return;
    default:
      return;
  }
}

function buildBot() {
  let controller: Pitch40Controller;

  return buildManagedBot<Pitch40Bot>(getBotOptions, {
    afterCreate: (bot, helpers) => {
 
      controller = new Pitch40Controller(new MineflayerPitch40Port(bot, true));
      registerPitch40Logging(bot, controller, true);

      bot.on("physicsTickBegin", () => {
        controller.tick();
      });

      controller.on("mode_change", (payload: unknown) => {
        console.log("[pitch40:event] mode_change", payload);
      });
    },
    onSpawn: async (bot, helpers) => {
      bot.physics.yawSpeed = 6000;
      bot.physics.pitchSpeed = 6000;

      helpers.physicsSwitcher.enable();
      console.log("[pitch40] new engine enabled");
      console.log(
        "[pitch40] chat commands: prep | launch [yawDeg] [takeoffPitchDeg] [useInitialFirework] | start | stop | boost | status | " +
        "set <up|down|min|max|steps|fireworks|extra|maintain|cooldown|emergency|emergencypitch> <value> | reset",
      );
      await ensurePitch40Loadout(bot).catch(() => {});
    },
    onChat: async (bot, username, message) => {
      await handleChatCommand(bot, username, message, controller);
    },
  });
}

activeBot = buildBot();
