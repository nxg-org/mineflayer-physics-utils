import type { Entity } from "prismarine-entity";

import { applyMdToNewEntity } from "../util/physicsUtils";
import { IPhysics } from "../physics/engines";
import { EPhysicsCtx } from "../physics/settings";

import { Vec3 } from "vec3";
import { BaseSimulator } from "./baseSimulator";

import md from "minecraft-data";

export class BasicSim extends BaseSimulator {
    constructor(public readonly ctx: IPhysics) {
        super(ctx);
    }

    async simXTicksRaw(mdEntity: md.Entity, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        this.simUntilOnGround(applyMdToNewEntity(EPhysicsCtx, mdEntity, options), world, ticks);
    }

    async simXTicks(entity: Entity, world: any, ticks: number) {
        return await this.simulateUntil(
            (state) => false,
            () => {},
            () => {},
            EPhysicsCtx.FROM_ENTITY(this.ctx, entity),
            world,
            ticks
        );
    }

    async simXTicksPrebuilt(ctx: EPhysicsCtx, world: any, ticks: number) {
        return await this.simulateUntil(
            (state) => false,
            () => {},
            () => {},
            ctx,
            world,
            ticks
        );
    }

    async simUntilOnGroundRaw(mdEntity: md.Entity, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        this.simUntilOnGround(applyMdToNewEntity(EPhysicsCtx, mdEntity, options), world, ticks);
    }

    async simUntilOnGround(entity: Entity, world: any, ticks: number = 5) {
        return await this.simulateUntil(
            (state) => state.onGround === true,
            () => {},
            () => {},
            EPhysicsCtx.FROM_ENTITY(this.ctx, entity),
            world,
            ticks
        );
    }

    async simUntilOnGroundPrebuilt(ctx: EPhysicsCtx, world: any, ticks: number = 5) {
        return await this.simulateUntil(
            (state) => state.onGround === true,
            () => {},
            () => {},
            ctx,
            world,
            ticks
        );
    }

    async simUntilDestinationRaw(mdEntity: md.Entity, world: any, ticks: number = 5, options: Partial<Entity> = {}) {
        this.simUntilDestination(applyMdToNewEntity(EPhysicsCtx, mdEntity, options), world, ticks);
    }

    async simUntilDestination(entity: Entity, destination: Vec3, world: any, ticks: number = 10) {
        return await this.simulateUntil(
            BasicSim.getReached(destination),
            () => {},
            () => {},
            EPhysicsCtx.FROM_ENTITY(this.ctx, entity),
            world,
            ticks
        );
    }

    async simUntilDestinationPrebuilt(ctx: EPhysicsCtx, destination: Vec3, world: any, ticks: number = 10) {
        return await this.simulateUntil(
            BasicSim.getReached(destination),
            () => {},
            () => {},
            ctx,
            world,
            ticks
        );
    }
}
