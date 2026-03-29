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
import {
  PredictiveTopPlacementAssist,
  registerPlacementAssistLogging,
} from "../helpers/manual/ebounceScaffoldPlacement";

const BLOCK_USAGE_REPORT_DISTANCE = 1000;

let activeBot: Bot;

function getBotOptions() {
  return getBotOptionsFromArgs({
    defaultUsername: "testingbot",
    versionIndex: 4,
    usernameIndex: 5,
    authIndex: 6,
  });
}

function createRealBotActivityLogger(
  bot: EBounceBot,
  controller: EBounceController,
  placementAssist: PredictiveTopPlacementAssist,
) {
  let tickNumber = 0;
  let lastRealHorizontalCollision = false;
  let lastRealBelowTrackedY = false;
  let previousTravelPos = bot.entity.position.clone();
  let totalHorizontalTravel = 0;
  let nextBlockUsageReportDistance = BLOCK_USAGE_REPORT_DISTANCE;
  let lastBlockUsageReportPlacedBlocks = placementAssist.getPlacedBlockCount();
  let lastTrackedYLevel = placementAssist.getTrackedYLevel();

  return () => {
    tickNumber++;

    if (!controller.isBouncing()) {
      lastRealHorizontalCollision = false;
      lastRealBelowTrackedY = false;
      previousTravelPos = bot.entity.position.clone();
      totalHorizontalTravel = 0;
      nextBlockUsageReportDistance = BLOCK_USAGE_REPORT_DISTANCE;
      lastBlockUsageReportPlacedBlocks = placementAssist.getPlacedBlockCount();
      lastTrackedYLevel = placementAssist.getActiveTrackedYLevel();
      return;
    }

    const trackedYLevel = placementAssist.getActiveTrackedYLevel();
    if (trackedYLevel !== lastTrackedYLevel) {
      previousTravelPos = bot.entity.position.clone();
      totalHorizontalTravel = 0;
      nextBlockUsageReportDistance = BLOCK_USAGE_REPORT_DISTANCE;
      lastBlockUsageReportPlacedBlocks = placementAssist.getPlacedBlockCount();
      lastTrackedYLevel = trackedYLevel;
    }

    const currentPos = bot.entity.position.clone();
    const dx = currentPos.x - previousTravelPos.x;
    const dz = currentPos.z - previousTravelPos.z;
    totalHorizontalTravel += Math.sqrt((dx * dx) + (dz * dz));
    previousTravelPos = currentPos;

    while (totalHorizontalTravel >= nextBlockUsageReportDistance) {
      const placedBlockCount = placementAssist.getPlacedBlockCount();
      const blocksUsedThisSegment = placedBlockCount - lastBlockUsageReportPlacedBlocks;
      console.log(
        `[ebounce-scaffold][tick=${tickNumber}] Block usage over last ${BLOCK_USAGE_REPORT_DISTANCE} traveled: ` +
        `${blocksUsedThisSegment} blocks used ` +
        `totalTravel=${nextBlockUsageReportDistance.toFixed(0)} totalPlaced=${placedBlockCount}`,
      );
      lastBlockUsageReportPlacedBlocks = placedBlockCount;
      nextBlockUsageReportDistance += BLOCK_USAGE_REPORT_DISTANCE;
    }

    const collidedHorizontally = !!(bot.entity as any).isCollidedHorizontally;
    if (!collidedHorizontally) {
      lastRealHorizontalCollision = false;
    } else if (!lastRealHorizontalCollision) {
      lastRealHorizontalCollision = true;
      console.log(
        `[ebounce-scaffold][tick=${tickNumber}] REAL horizontal collision ` +
        `pos=${bot.entity.position.toString()} vel=${bot.entity.velocity.toString()} ` +
        `onGround=${bot.entity.onGround} ` +
        `support=${(bot.entity as any).supportingBlockPos?.toString() ?? "null"}`,
      );
    }

    if (trackedYLevel == null) {
      lastRealBelowTrackedY = false;
      return;
    }

    const belowTrackedY = bot.entity.position.y + 1e-6 < trackedYLevel;
    if (!belowTrackedY) {
      lastRealBelowTrackedY = false;
      return;
    }

    if (lastRealBelowTrackedY) {
      return;
    }

    lastRealBelowTrackedY = true;
    console.log(
      `[ebounce-scaffold][tick=${tickNumber}] REAL below trackedY ` +
      `pos=${bot.entity.position.toString()} vel=${bot.entity.velocity.toString()} ` +
      `onGround=${bot.entity.onGround} trackedY=${trackedYLevel.toFixed(3)} ` +
      `support=${(bot.entity as any).supportingBlockPos?.toString() ?? "null"}`,
    );
  };
}

async function handleChatCommand(
  bot: EBounceBot,
  username: string,
  message: string,
  controller: EBounceController,
  placementAssist: PredictiveTopPlacementAssist,
) {
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
      if (args[2] != null) {
        const trackedY = Number(args[2]);
        if (!Number.isNaN(trackedY)) placementAssist.armFromYLevel(trackedY);
        else placementAssist.armFromCurrentYLevel();
      } else {
        placementAssist.armFromCurrentYLevel();
      }
      controller.beginBounce();
      bot.chat("Scaffold bounce sequence started.");
      return;
    case "boost":
      bot.activateItem();
      return;
    case "stop":
      controller.stopFlight();
      placementAssist.clear();
      bot.chat("Scaffold bounce sequence stopped.");
      return;
    case "status":
      bot.chat(controller.status());
      bot.chat(placementAssist.status());
      return;
    case "blocks":
      bot.chat(placementAssist.status());
      return;
    case "placelasttick":
    case "lasttickplace":
      placementAssist.setPlaceOnLastValidTickOnly(args[0] !== "false");
      bot.chat(`placeOnLastValidTickOnly=${args[0] !== "false"}`);
      return;
    case "descendstep":
    case "maxdescend":
      if (args[0] != null) {
        const maxDescendStep = Number(args[0]);
        if (!Number.isNaN(maxDescendStep) && maxDescendStep > 0) {
          placementAssist.setMaxDescendStep(maxDescendStep);
          bot.chat(`maxDescendStep=${Math.max(1, Math.floor(maxDescendStep))}`);
        }
      }
      return;
    case "ascendstep":
    case "maxascend":
      if (args[0] != null) {
        const maxAscendStep = Number(args[0]);
        if (!Number.isNaN(maxAscendStep) && maxAscendStep > 0) {
          placementAssist.setMaxAscendStep(maxAscendStep);
          bot.chat(`maxAscendStep=${Math.max(1, Math.floor(maxAscendStep))}`);
        }
      }
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
      placementAssist.clear();
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
  let placementAssist: PredictiveTopPlacementAssist;

  return buildManagedBot<EBounceBot>(getBotOptions, {
    onSpawn: async (bot, helpers) => {
      helpers.physicsSwitcher.enable();
      console.log("[ebounce-scaffold] new engine enabled");
      console.log("[ebounce-scaffold] chat commands: prep | bounce [yawDeg] [pitchDeg] [trackedY] | boost | stop | status | blocks | placelasttick <true|false> | ascendstep <blocks> | descendstep <blocks> | yaw <deg|clear> | pitch <deg|clear> | lockyaw <true|false> | lockpitch <true|false> | forcefallflying <true|false> | reset");
      
      
      controller = new EBounceController(new MineflayerEBouncePort(bot, helpers.physicsSwitcher, false));
      placementAssist = new PredictiveTopPlacementAssist(bot, controller);
      const logRealBotActivity = createRealBotActivityLogger(bot, controller, placementAssist);
      registerEBounceLogging(bot, controller, false);
      registerPlacementAssistLogging(placementAssist);
      bot.on("physicsTickBegin", () => {
        controller.tick();
        placementAssist.tick();
        logRealBotActivity();
      });
      bot.on("end", () => {
        placementAssist.clear();
      });
      
      await ensureBounceLoadout(bot).catch(() => {});
    },
    onChat: async (bot, username, message) => {
      await handleChatCommand(bot, username, message, controller, placementAssist);
    },
  });
}

activeBot = buildBot();
