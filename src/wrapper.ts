
import { EntityPhysics, IPhysics } from "./physics/engines";
import { EPhysicsCtx } from "./physics/settings";
import md from "minecraft-data"

import type { Entity } from "prismarine-entity";
import type { Bot } from "mineflayer";

// /**
//  * Just a convenience thing.
//  */
// export enum SimulationTypes {
//     UNTIL_GROUND,
//     FOR_X_TICKS,
//     TO_DESTINATION,
// }

export class PhysicsUtilWrapper {
    public engine!: IPhysics;
    public readonly ePhysicsCtx = EPhysicsCtx;
    public readonly data: md.IndexedData;

    constructor(private bot: Bot) {
        this.data = bot.registry;
        EPhysicsCtx.loadData(this.data);
        this.engine = new EntityPhysics(this.data);
    }

    public getPhysicsSim() {
        return new EntityPhysics(this.data);
    }

    public getPhysicsCtx(ctx: IPhysics, entity: Entity) {
        return EPhysicsCtx.FROM_ENTITY(ctx, entity);
    }

    public getPhysicsCtxRaw(ctx: IPhysics, entity: md.Entity, options: Partial<Entity> = {}) {
        return EPhysicsCtx.FROM_ENTITY_TYPE(ctx, entity, options);
    }

    // public simulate(simulator: IPhysics, simCtx: EPhysicsCtx, world: any) {
    //     return simulator.simulate(simCtx, world);
    // }

    // public exampleSim(entity: Entity, type: SimulationTypes, ticks: number = 10, destination?: Vec3) {
    //     const simulator = new BasicSim(new EntityPhysics(this.data));
      
    //     switch (type) {
    //         case SimulationTypes.FOR_X_TICKS:
    //             return simulator.simXTicks(entity, this.bot.world, ticks);
    //         case SimulationTypes.UNTIL_GROUND:
    //             return simulator.simUntilOnGround(entity, this.bot.world, ticks);
    //         case SimulationTypes.TO_DESTINATION:
    //             if (!destination) throw "Invalid destination for example sim.";
    //             return simulator.simUntilDestination(entity, destination, this.bot.world, ticks);
    //     }
    // }

    // public advancedExample(simCtx: EPhysicsCtx, type: SimulationTypes, ticks: number = 10, destination?: Vec3) {
    //     const simulator = new BasicSim(new EntityPhysics(this.data));
      
    //     switch (type) {
    //         case SimulationTypes.FOR_X_TICKS:
    //             return simulator.simXTicksPrebuilt(simCtx, this.bot.world, ticks);
    //         case SimulationTypes.UNTIL_GROUND:
    //             return simulator.simUntilOnGroundPrebuilt(simCtx, this.bot.world, ticks);
    //         case SimulationTypes.TO_DESTINATION:
    //             if (!destination) throw "Invalid destination for example sim.";
    //             return simulator.simUntilDestinationPrebuilt(simCtx, destination, this.bot.world, ticks);
    //     }
    // }
}