import loader, {Entity} from "prismarine-entity";

import { applyMdToNewEntity } from "../util/physicsUtils";
import { IPhysics } from "../physics/engines";
import { EPhysicsCtx } from "../physics/settings";

import { Vec3 } from "vec3";
import { BaseSimulator } from "./baseSimulator";

import md from "minecraft-data";
import { SimObjects } from ".";


export class BasicSim extends BaseSimulator {
    constructor(public readonly ctx: IPhysics) {
        super(ctx);
        console.log(Entity)
    }

    public async simXTicks(entity: SimObjects, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        if (entity instanceof EPhysicsCtx) {
            return this._simXTicksPrebuilt(entity, world, ticks);
        }

        if (entity instanceof Entity) {
            return this._simXTicks(entity, world, ticks);
        }

        return this._simXTicksRaw(entity, world, ticks, options);
    }

    private async _simXTicksRaw(mdEntity: md.Entity, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        return this._simXTicks(applyMdToNewEntity(EPhysicsCtx, mdEntity, options), world, ticks);
    }

    private async _simXTicks(entity: Entity, world: any, ticks: number) {
        return this.simulateUntil(
            (state) => false,
            () => {},
            () => {},
            EPhysicsCtx.FROM_ENTITY(this.ctx, entity),
            world,
            ticks
        );
    }

    private async _simXTicksPrebuilt(ctx: EPhysicsCtx, world: any, ticks: number) {
        return this.simulateUntil(
            (state) => false,
            () => {},
            () => {},
            ctx,
            world,
            ticks
        );
    }

    public async simUntilOnGround(entity: SimObjects, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        if (entity instanceof EPhysicsCtx) {
            return this._simUntilOnGroundPrebuilt(entity, world, ticks);
        }

        if (entity instanceof Entity) {
            return this._simUntilOnGround(entity, world, ticks);
        }

        return this._simUntilOnGroundRaw(entity, world, ticks, options);
    }

    private async _simUntilOnGroundRaw(mdEntity: md.Entity, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        return this._simUntilOnGround(applyMdToNewEntity(EPhysicsCtx, mdEntity, options), world, ticks);
    }

    private async _simUntilOnGround(entity: Entity, world: any, ticks: number = 5) {
        return this.simulateUntil(
            (state) => state.onGround === true,
            () => {},
            () => {},
            EPhysicsCtx.FROM_ENTITY(this.ctx, entity),
            world,
            ticks
        );
    }

    private async _simUntilOnGroundPrebuilt(ctx: EPhysicsCtx, world: any, ticks: number = 5) {
        return this.simulateUntil(
            (state) => state.onGround === true,
            () => {},
            () => {},
            ctx,
            world,
            ticks
        );
    }
    public async simUntilDestination(entity: SimObjects, destination: Vec3, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        if (entity instanceof EPhysicsCtx) {
            return this._simUntilDestinationPrebuilt(entity, destination, world, ticks);
        }

        if (entity instanceof Entity) {
            return this._simUntilDestination(entity, destination, world, ticks);
        }

        return this._simUntilDestinationRaw(entity, destination, world, ticks, options);
    }

    private async _simUntilDestinationRaw(
        mdEntity: md.Entity,
        destination: Vec3,
        world: any,
        ticks: number = 5,
        options: Partial<Entity> = {}
    ) {
        return this._simUntilDestination(applyMdToNewEntity(EPhysicsCtx, mdEntity, options), destination, world, ticks);
    }

    private async _simUntilDestination(entity: Entity, destination: Vec3, world: any, ticks: number = 10) {
        return this.simulateUntil(
            BasicSim.getReached(destination),
            () => {},
            () => {},
            EPhysicsCtx.FROM_ENTITY(this.ctx, entity),
            world,
            ticks
        );
    }

    private async _simUntilDestinationPrebuilt(ctx: EPhysicsCtx, destination: Vec3, world: any, ticks: number = 10) {
        return this.simulateUntil(
            BasicSim.getReached(destination),
            () => {},
            () => {},
            ctx,
            world,
            ticks
        );
    }
}
