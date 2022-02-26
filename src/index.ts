import { Physics } from "./physics/engines/physics";
import { PlayerState } from "./physics/states/playerState";
import { EntityState } from "./physics/states/entityState";

import { PhysicsSettings } from "./physics/extras/physicsSettings";
import { Bot } from "mineflayer";
import { PhysicsUtilWrapper } from "./wrapper";



declare module "mineflayer" {


    interface Bot {
        physicsUtil: PhysicsUtilWrapper
    }
}

export default function loader(bot: Bot): void {
    if (!bot.physicsUtil) bot.physicsUtil = new PhysicsUtilWrapper(bot)
}