import type { IndexedData } from "minecraft-data";
import type { Bot } from "mineflayer";

import { EPhysicsCtx, PhysicsSettings } from "./physics/settings";
import { PhysicsUtilWrapper } from "./wrapper";

import registry from "prismarine-registry"

declare module "mineflayer" {
    interface Bot {
        physicsUtil: PhysicsUtilWrapper;
        registry: IndexedData
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
    PhysicsSettings.loadData(data);
}

export { EPhysicsCtx, PhysicsSettings } from "./physics/settings";
export { BaseSimulator } from "./simulators";
export { EntityPhysics } from "./physics/engines";
export { EntityState } from "./physics/states";
export { ControlStateHandler } from "./physics/player";

export type { SimulationGoal, Controller, OnGoalReachFunction }from "./simulators";
