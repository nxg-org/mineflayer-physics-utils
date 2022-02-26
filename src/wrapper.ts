
import { EntityPhysics, IPhysics } from "./physics/engines";
import { EPhysicsCtx, PhysicsSettings } from "./physics/settings";
import { BasicSim } from "./simulators";
import { Vec3 } from "vec3";

import registry from "prismarine-registry"
import md from "minecraft-data"

import type { Entity } from "prismarine-entity";
import type { Bot } from "mineflayer";

/**
 * Just a convenience thing.
 */
export enum SimulationTypes {
    UNTIL_GROUND,
    FOR_X_TICKS,
    TO_DESTINATION,
}

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

    public getPhysicsCtxRaw(ctx: IPhysics, entity: md.Entity, options: Partial<Entity> = {}) {
        return EPhysicsCtx.FROM_ENTITY_TYPE(ctx, entity, options);
    }

    public simulate(simulator: IPhysics, simCtx: EPhysicsCtx, world: any) {
        return simulator.simulatePlayer(simCtx, world);
    }

    public async exampleSim(entity: Entity, type: SimulationTypes, ticks: number = 10, destination?: Vec3) {
        const simulator = new BasicSim(EntityPhysics.FROM_ENTITY(this.data, entity));
        switch (type) {
            case SimulationTypes.FOR_X_TICKS:
                return await simulator.simXTicks(entity, this.bot.world, ticks);
            case SimulationTypes.UNTIL_GROUND:
                return await simulator.simUntilOnGround(entity, this.bot.world, ticks);
            case SimulationTypes.TO_DESTINATION:
                if (!destination) throw "Invalid destination for example sim.";
                return await simulator.simUntilDestination(entity, destination, this.bot.world, ticks);
        }
    }
}
