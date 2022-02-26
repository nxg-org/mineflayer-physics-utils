import type { Bot } from "mineflayer";
import { PhysicsUtilWrapper } from "./wrapper";

declare module "mineflayer" {
    interface Bot {
        physicsUtil: PhysicsUtilWrapper;
    }
}

export default function loader(bot: Bot): void {
    if (!bot.physicsUtil) bot.physicsUtil = new PhysicsUtilWrapper(bot);
}

export { BaseSimulator } from "./simulators";
export { IPhysics } from "./physics/engines";
export { EPhysicsCtx } from "./physics/settings";
export { EntityState } from "./physics/states";
