
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