import { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import { Vec3 } from "vec3";
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
  findInventoryItem,
  registerEBounceLogging,
} from "../helpers/manual/ebounceShared";
import {
  type PlacementAssistEquipRequest,
  type PlacementAssistPlacementRequest,
  PredictiveTopPlacementAssist,
  registerPlacementAssistLogging,
} from "../helpers/manual/ebounceScaffoldPlacement";

const BLOCK_USAGE_REPORT_DISTANCE = 1000;
const REPLACEABLE_BLOCK_NAMES = new Set([
  "air",
  "cave_air",
  "void_air",
  "water",
  "lava",
  "short_grass",
  "tall_grass",
  "fern",
  "large_fern",
  "seagrass",
  "tall_seagrass",
  "snow",
  "vine",
  "weeping_vines",
  "weeping_vines_plant",
  "twisting_vines",
  "twisting_vines_plant",
]);

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

function isReplaceableForPlacement(block: Block | null) {
  if (block == null) return true;
  if (REPLACEABLE_BLOCK_NAMES.has(block.name)) return true;
  return block.boundingBox === "empty";
}

function tryEquipPlaceableToMainHandSameTick(bot: EBounceBot, placeableName: string) {
  if (bot.heldItem?.name === placeableName) {
    return true;
  }

  const placeable = findInventoryItem(bot, placeableName);
  if (placeable == null) {
    return false;
  }

  if (placeable.slot >= 36 && placeable.slot <= 44) {
    bot.setQuickBarSlot(placeable.slot - 36);
    return bot.heldItem?.name === placeableName;
  }

  return false;
}

function sendSwapItemWithOffhand(bot: EBounceBot) {
  const body: Record<string, unknown> = {
    status: 6,
    location: new Vec3(0, 0, 0),
    face: 0,
  };

  if (bot.supportFeature("useItemWithOwnPacket")) {
    body.sequence = 0;
  }

  (bot as any)._client.write("block_dig", body);
}

function mirrorSwapMainHandWithOffhand(bot: EBounceBot) {
  const heldSlot = 36 + bot.quickBarSlot;
  const inventory = bot.inventory.slots;
  const offhandItem = inventory[45] ?? null;
  inventory[45] = inventory[heldSlot] ?? null;
  inventory[heldSlot] = offhandItem;
  bot.updateHeldItem();
}

function getOffhandItem(bot: EBounceBot) {
  return bot.inventory.slots[45] ?? null;
}

function applyClientSidePlacedBlock(bot: EBounceBot, blockName: string, targetPos: Vec3) {
  const blockInfo = bot.registry.blocksByName[blockName];
  if (!blockInfo) {
    return;
  }

  const updater = (bot as any)._updateBlockState;
  if (typeof updater === "function") {
    updater(targetPos, blockInfo.defaultState);
  }
}

function getPlaceReference(bot: EBounceBot, targetPos: Vec3): Block | { position: Vec3 } {
  const referencePos = new Vec3(targetPos.x, targetPos.y - 1, targetPos.z);
  const referenceBlock = bot.blockAt(referencePos);
  if (referenceBlock != null) {
    if (referenceBlock.type === bot.registry.blocksByName.air.id) {
      return { position: targetPos.clone() };
    }
    return referenceBlock;
  }

  return { position: referencePos };
}

function failPlacementRequest(
  placementAssist: PredictiveTopPlacementAssist,
  request: PlacementAssistPlacementRequest,
  message: string,
) {
  console.log(`[ebounce-scaffold][tick=${request.tick}] ${message}`);
  placementAssist.resolvePlacementRequest({ placedCount: 0 });
}

function preparePlaceableInOffhand(
  bot: EBounceBot,
  request: PlacementAssistPlacementRequest,
) {
  const offhandItem = getOffhandItem(bot);
  if (offhandItem?.name === request.placeableName && bot.heldItem?.name !== request.placeableName) {
    sendSwapItemWithOffhand(bot);
    mirrorSwapMainHandWithOffhand(bot);
  }

  if (!tryEquipPlaceableToMainHandSameTick(bot, request.placeableName)) {
    return {
      ok: false as const,
      message: `Placement block ${request.placeableName} was no longer available.`,
    };
  }

  const mainHandItem = bot.heldItem;
  if (mainHandItem == null || mainHandItem.name !== request.placeableName) {
    return {
      ok: false as const,
      message: `Placement block ${request.placeableName} could not be moved to the main hand synchronously.`,
    };
  }

  sendSwapItemWithOffhand(bot);
  mirrorSwapMainHandWithOffhand(bot);

  const placeable = getOffhandItem(bot);
  if (placeable == null || placeable.name !== request.placeableName) {
    return {
      ok: false as const,
      message: `Placement block ${request.placeableName} was not available in offhand for placement.`,
    };
  }

  return { ok: true as const, placeableName: placeable.name };
}

function placeBlocksFromOffhand(
  bot: EBounceBot,
  targetPositions: Vec3[],
  placeableName: string,
) {
  const placementPromises: Promise<unknown>[] = [];
  let placedCount = 0;

  for (let i = 0; i < targetPositions.length; i++) {
    const targetPos = targetPositions[i];
    const existingBlock = bot.blockAt(targetPos);
    if (!isReplaceableForPlacement(existingBlock)) {
      continue;
    }

    const referenceBlock = getPlaceReference(bot, targetPos);
    placementPromises.push(
      (bot as any)._genericPlace(referenceBlock, new Vec3(0, 1, 0), {
        offhand: true,
        swingArm: i === 0 ? "left" : undefined,
        forceLook: "ignore",
      }),
    );
    applyClientSidePlacedBlock(bot, placeableName, targetPos);
    placedCount++;
  }

  return { placementPromises, placedCount };
}

function registerPlacementActionHandlers(
  bot: EBounceBot,
  placementAssist: PredictiveTopPlacementAssist,
) {
  placementAssist.on("equip_request", async ({ placeableName }: PlacementAssistEquipRequest) => {
    try {
      const placeable = findInventoryItem(bot, placeableName);
      if (!placeable) {
        placementAssist.resolveEquipRequest(new Error(`Placement block ${placeableName} was no longer available.`));
        return;
      }

      if (bot.heldItem?.name !== placeable.name) {
        await bot.equip(placeable, "hand");
      }
      placementAssist.resolveEquipRequest();
    } catch (error) {
      placementAssist.resolveEquipRequest(error);
    }
  });

  placementAssist.on("placement_request", async (request: PlacementAssistPlacementRequest) => {
    const placementRequestedAt = Date.now();
    try {
      const prepared = preparePlaceableInOffhand(bot, request);
      if (!prepared.ok) {
        failPlacementRequest(placementAssist, request, prepared.message);
        return;
      }

      const { placementPromises, placedCount } = placeBlocksFromOffhand(
        bot,
        request.targetPositions,
        prepared.placeableName,
      );

      sendSwapItemWithOffhand(bot);
      mirrorSwapMainHandWithOffhand(bot);

      console.log(
        `[ebounce-scaffold][tick=${request.tick}] Placed ${prepared.placeableName} at ${request.targetKey} ` +
        `botPos=${request.botPos.toString()} pitchDeg=${request.pitchDeg.toFixed(1)} ` +
        `predictedTick=${request.predictedTick} ` +
        `reach=${request.reach.toFixed(2)} ` +
        `crossing=${request.crossingPos.toString()} landing=${request.landingPos.toString()} ` +
        `requestMs=${Date.now() - placementRequestedAt}`,
      );
      await Promise.all(placementPromises);
      placementAssist.resolvePlacementRequest({ placedCount });
    } catch (error) {
      console.log(
        `[ebounce-scaffold][tick=${request.tick}] Placement failed at ${request.targetKey}: ${String(error)} ` +
        `requestMs=${Date.now() - placementRequestedAt}`,
      );
      placementAssist.resolvePlacementRequest({ placedCount: 0, error });
    }
  });
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
      registerPlacementActionHandlers(bot, placementAssist);
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
