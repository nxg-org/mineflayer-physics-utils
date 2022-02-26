import { Bot } from "mineflayer";
import registry from "prismarine-registry"
import { EntityPhysics } from "./physics/engines/entityPhysics";
import { IPhysics } from "./physics/engines/IPhysics";
import { PhysicsSettings } from "./physics/settings/physicsSettings";
import { EPhysicsCtx } from "./physics/settings/entityPhysicsCtx";

export class PhysicsUtilWrapper {

    public playerPhysics!: IPhysics
    public readonly physicsSettings = PhysicsSettings;
    public readonly ePhysicsCtx = EPhysicsCtx;

    constructor(private bot: Bot) {
            const data = registry(bot.version);
            PhysicsSettings.loadData(data)
            EPhysicsCtx.loadData(data)
            this.playerPhysics = new EntityPhysics(data, data.entitiesByName["player"]);
        
    }
}