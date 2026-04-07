import { Bot } from "mineflayer";
import { Entity } from "prismarine-entity";
import { buildManagedBot, getBotOptionsFromArgs, type PhysicsBot } from "../helpers/manual/botSetup";

const TARGET_USERNAME = "PancakeSlam";

function getBotOptions() {
  return getBotOptionsFromArgs({
    defaultUsername: "trackingbot",
    usernameIndex: 4,
    versionIndex: 5,
    authIndex: 6,
  });
}

function getClosestTrackedEntity(bot: Bot): Entity | null {
  return bot.nearestEntity((entity) => entity.username === TARGET_USERNAME) ?? null;
}

function formatNumber(value: number) {
  return value.toFixed(6);
}

function formatTrackedEntity(entity: Entity) {
  const { position, velocity } = entity;
  return [
    `username=${entity.username}`,
    `id=${entity.id}`,
    `pos=(${formatNumber(position.x)}, ${formatNumber(position.y)}, ${formatNumber(position.z)})`,
    `vel=(${formatNumber(velocity.x)}, ${formatNumber(velocity.y)}, ${formatNumber(velocity.z)})`,
    `yaw=${formatNumber(entity.yaw)}`,
    `pitch=${formatNumber(entity.pitch)}`,
    `onGround=${String(entity.onGround)}`,
  ].join(" ");
}

function registerTracker(bot: Bot) {
  let lastSnapshot: string | null = null;

  bot.on("physicsTick", () => {
    const tracked = getClosestTrackedEntity(bot);
    if (!tracked) {
      lastSnapshot = null;
      return;
    }

    const snapshot = formatTrackedEntity(tracked);
    if (snapshot === lastSnapshot) return;

    lastSnapshot = snapshot;
    console.log(snapshot);
  });
}

buildManagedBot<PhysicsBot>(getBotOptions, {
  afterCreate: (bot) => {
    registerTracker(bot);
  },
});
