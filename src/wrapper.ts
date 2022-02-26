import { Bot } from "mineflayer";
import { Physics } from "./physics/engines/physics";
import registry from "prismarine-registry"
import { NewCheapSettings } from "./physics/settings/cheapSettings";
import { EntityPhysicsContext } from "./physics/settings/entityPhysicsCtx";

export class PhysicsUtilWrapper {

    public readonly physics: Physics

    constructor(private bot: Bot) {
        const data = registry(bot.version);
        EntityPhysicsContext.mcData = data;
        this.physics = new Physics(data);
 
        const tmp = NewCheapSettings.FROM_ENTITY(bot.entity)
    }
}