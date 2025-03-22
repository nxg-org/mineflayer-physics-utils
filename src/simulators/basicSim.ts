import { Entity } from "prismarine-entity";

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
    }

    public simXTicksRaw(mdEntity: md.Entity, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        return this.simXTicks(applyMdToNewEntity(EPhysicsCtx, mdEntity, options), world, ticks);
    }

    public simXTicks(entity: Entity, world: any, ticks: number) {
        return this.simulateUntil(
            (state) => false,
            () => {},
            () => {},
            EPhysicsCtx.FROM_ENTITY(this.ctx, entity),
            world,
            ticks
        );
    }

    public simXTicksPrebuilt(ctx: EPhysicsCtx, world: any, ticks: number) {
        return this.simulateUntil(
            (state) => false,
            () => {},
            () => {},
            ctx,
            world,
            ticks
        );
    }

    public simUntilOnGroundRaw(mdEntity: md.Entity, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        return this.simUntilOnGround(applyMdToNewEntity(EPhysicsCtx, mdEntity, options), world, ticks);
    }

    public simUntilOnGround(entity: Entity, world: any, ticks: number = 5) {
        return this.simulateUntil(
            (state) => state.onGround === true,
            () => {},
            () => {},
            EPhysicsCtx.FROM_ENTITY(this.ctx, entity),
            world,
            ticks
        );
    }

    public simUntilOnGroundPrebuilt(ctx: EPhysicsCtx, world: any, ticks: number = 5) {
        return this.simulateUntil(
            (state) => state.onGround === true,
            () => {},
            () => {},
            ctx,
            world,
            ticks
        );
    }

    public simUntilDestinationRaw(mdEntity: md.Entity, destination: Vec3, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        return this.simUntilDestination(applyMdToNewEntity(EPhysicsCtx, mdEntity, options), destination, world, ticks);
    }

    public simUntilDestination(entity: Entity, destination: Vec3, world: any, ticks: number = 10) {
        return this.simulateUntil(
            BasicSim.getReached(destination),
            () => {},
            () => {},
            EPhysicsCtx.FROM_ENTITY(this.ctx, entity),
            world,
            ticks
        );
    }

    public simUntilDestinationPrebuilt(ctx: EPhysicsCtx, destination: Vec3, world: any, ticks: number = 10) {
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
