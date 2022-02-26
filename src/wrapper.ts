import { Bot } from "mineflayer";
import registry from "prismarine-registry";
import { EntityPhysics } from "./physics/engines/entityPhysics";
import { IPhysics } from "./physics/engines/IPhysics";
import { PhysicsSettings } from "./physics/settings/physicsSettings";
import { EPhysicsCtx } from "./physics/settings/entityPhysicsCtx";
import { Entity } from "prismarine-entity";
import md from "minecraft-data";


export class PhysicsUtilWrapper {
  
    public playerPhysics!: IPhysics;
    public readonly physicsSettings = PhysicsSettings;
    public readonly ePhysicsCtx = EPhysicsCtx;
    public readonly data: md.IndexedData;
    constructor(private bot: Bot) {
        this.data = registry(bot.version);
        PhysicsSettings.loadData(this.data);
        EPhysicsCtx.loadData(this.data);
        this.playerPhysics = new EntityPhysics(this.data, this.data.entitiesByName["player"]);
    }

    public getPhysicsSim(entity: Entity) {
        return EntityPhysics.FROM_ENTITY(this.data, entity);
    }

    public getPhysicsSimRaw(entity: md.Entity) {
        return new EntityPhysics(this.data, entity);
    }


    public getPhysicsCtx(ctx: IPhysics, entity: Entity) {
        return EPhysicsCtx.FROM_ENTITY(ctx, entity);
    }

    public getPhysicsCtxRaw(ctx: IPhysics, entity: md.Entity) {
        return EPhysicsCtx.FROM_ENTITY_TYPE(ctx, entity);
    }

    public simulate(simulator: IPhysics, simCtx: EPhysicsCtx, world: any) {
        return simulator.simulatePlayer(simCtx, world);
    }
}
