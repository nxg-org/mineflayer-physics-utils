import type { IndexedData } from "minecraft-data";
import type { Bot } from "mineflayer";

import { EPhysicsCtx } from "./physics/settings";
import { PhysicsUtilWrapper } from "./wrapper";

import registry from "prismarine-registry"

declare module "mineflayer" {
    interface Bot {
        physicsUtil: PhysicsUtilWrapper;
    }
}

export default function loader(bot: Bot): void {
    if (!bot.physicsUtil) {
        initSetup(bot.registry);
        bot.physicsUtil = new PhysicsUtilWrapper(bot);
    }
}

export function initSetup(data: IndexedData) {
    EPhysicsCtx.loadData(data);
}

export { EPhysicsCtx, PhysicsWorldSettings } from "./physics/settings";
export { BaseSimulator } from "./simulators";
export { EntityPhysics, BotcraftPhysics } from "./physics/engines";
export { EntityState, PlayerState, PlayerPoses, IEntityState } from "./physics/states";
export { ControlStateHandler } from "./physics/player";

export type { SimulationGoal, Controller, OnGoalReachFunction }from "./simulators";
