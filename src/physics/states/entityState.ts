import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { CheapEffects, CheapEnchantments, isEntityUsingItem, whichHandIsEntityUsingBoolean } from "../../util/physicsUtils";
import type { Entity } from "prismarine-entity";
import type { Bot, Effect } from "mineflayer";
import { Vec3 } from "vec3";


import { ControlStateHandler } from "../player/playerControls";
import { PlayerState } from "./playerState";
import { PlayerPoses } from "./poses";

import { IPhysics } from "../engines";
import nbt from "prismarine-nbt";


export interface EntityStateBuilder {
    height: number;
    halfWidth: number;
    position: Vec3;
    velocity: Vec3;
    pitch: number;
    yaw: number;
    controlState: ControlStateHandler;
    onGround: boolean;
    isUsingItem?: boolean;
    isInWater?: boolean;
    isInLava?: boolean;
    isInWeb?: boolean;
    sneakCollision?: boolean;
    isCollidedHorizontally?: boolean;
    isCollidedVertically?: boolean;

    effects?: Effect[];
    jumpBoost?: number;
    speed?: number;
    slowness?: number;
    dolphinsGrace?: number;
    slowFalling?: number;
    levitation?: number;
    depthStrider?: number;
}

const emptyVec = new Vec3(0, 0, 0);
export class EntityState implements EntityStateBuilder {
    // may keep this, may not. Who knows?
    public age: number = 0;

    public isInWater: boolean;
    public isInLava: boolean;
    public isInWeb: boolean;
    public isCollidedHorizontally: boolean;
    public isCollidedVertically: boolean;
    public jumpTicks: number;
    public jumpQueued: boolean;

    public sneakCollision: boolean;

    public attributes: any /* dunno yet */;

    public isUsingItem: boolean;
    public isUsingMainHand: boolean;
    public isUsingOffHand: boolean;

    public jumpBoost: number;
    public speed: number;
    public slowness: number;
    public dolphinsGrace: number;
    public slowFalling: number;
    public levitation: number;
    public depthStrider: number;

    public effects: Effect[];
    public pose: PlayerPoses;

    // public effects: Effect[];
    // public statusEffectNames;

    constructor(
        public ctx: IPhysics,
        public height: number,
        public halfWidth: number,
        public position: Vec3,
        public velocity: Vec3,
        public onGround: boolean,
        public controlState: ControlStateHandler,
        public yaw: number,
        public pitch: number
    ) {
        this.isInWater = false;
        this.isInLava = false;
        this.isInWeb = false;
        this.isCollidedHorizontally = false;
        this.isCollidedVertically = false;
        this.sneakCollision = false; //TODO

        //not sure what to do here, ngl.
        this.jumpTicks = 0;
        this.jumpQueued = false;

        // Input only (not modified)
        this.attributes = {}; //TODO

        this.isUsingItem = false;
        this.isUsingMainHand = false;
        this.isUsingOffHand = false;

        // effects
        this.effects = [];

        this.jumpBoost = 0;
        this.speed = 0;
        this.slowness = 0;

        this.dolphinsGrace = 0;
        this.slowFalling = 0;
        this.levitation = 0;

        this.depthStrider = 0;

        this.pose = PlayerPoses.STANDING;
    }

    public static CREATE_FROM_BOT(ctx: IPhysics, bot: Bot): EntityState {
        return new EntityState(
            ctx,
            bot.entity.height,
            bot.entity.width / 2,
            bot.entity.position.clone(),
            bot.entity.velocity.clone(),
            bot.entity.onGround,
            ControlStateHandler.COPY_BOT(bot),
            bot.entity.yaw,
            bot.entity.pitch
        ).updateFromBot(bot);
    }

    public static CREATE_FROM_ENTITY(ctx: IPhysics, entity: Entity): EntityState {
        return new EntityState(
            ctx,
            entity.height,
            entity.width / 2,
            entity.position.clone(),
            entity.velocity.clone(),
            entity.onGround,
            ControlStateHandler.DEFAULT(),
            entity.yaw,
            entity.pitch
        ).updateFromEntity(entity);
    }

    public static CREATE_FROM_PLAYER_STATE(ctx: IPhysics, state: PlayerState): EntityState {
        return new EntityState(
            ctx,
            state.height,
            state.halfWidth,
            state.position.clone(),
            state.velocity.clone(),
            state.onGround,
            state.controlState.clone(),
            state.yaw,
            state.pitch
        ).updateFromRaw(state);
    }

    /**
     * Slightly different from the other two, use a pre-built object (assuming cloned) material.
     * @param ctx Physics instance.
     * @param raw CONSUMEABLE, build this with clones.
     * @returns PhysicsState
     */
    public static CREATE_RAW(ctx: IPhysics, raw: EntityStateBuilder) {
        return new EntityState(ctx, raw.height, raw.halfWidth, raw.position, raw.velocity, raw.onGround, raw.controlState, raw.yaw, raw.pitch);
    }

    public updateFromBot(bot: Bot): EntityState {
        this.controlState = ControlStateHandler.COPY_BOT(bot);
        this.onGround = this.onGround;
        this.isUsingItem = isEntityUsingItem(bot.entity);
        this.attributes = (bot.entity as any).attributes;
        this.effects = bot.entity.effects;

        this.jumpBoost = this.ctx.getEffectLevel(CheapEffects.JUMP_BOOST, this.effects);
        this.speed = this.ctx.getEffectLevel(CheapEffects.SPEED, this.effects);
        this.slowness = this.ctx.getEffectLevel(CheapEffects.SLOWNESS, this.effects);

        this.dolphinsGrace = this.ctx.getEffectLevel(CheapEffects.DOLPHINS_GRACE, this.effects);
        this.slowFalling = this.ctx.getEffectLevel(CheapEffects.SLOW_FALLING, this.effects);
        this.levitation = this.ctx.getEffectLevel(CheapEffects.LEVITATION, this.effects);

        const boots = bot.entity.equipment[5];
        if (boots && boots.nbt) {
            const simplifiedNbt = nbt.simplify(boots.nbt);
            const enchantments = simplifiedNbt.Enchantments ?? simplifiedNbt.ench ?? [];
            this.depthStrider = this.ctx.getEnchantmentLevel(CheapEnchantments.DEPTH_STRIDER, enchantments);
        } else {
            this.depthStrider = 0;
        }
        return this;
    }

    public updateFromEntity(entity: Entity) {
        this.position = entity.position.clone();
        this.velocity = entity.velocity.clone();
        this.onGround = entity.onGround;
        this.isInWater = (entity as any).isInWater;
        this.isInLava = (entity as any).isInLava;
        this.isInWeb = (entity as any).isInWeb;
        this.isCollidedHorizontally = (entity as any).isCollidedHorizontally;
        this.isCollidedVertically = (entity as any).isCollidedVertically;
        this.sneakCollision = false; //TODO

        //not sure what to do here, ngl.
        this.jumpTicks = 0;
        this.jumpQueued = false;

        // Input only (not modified)
        this.attributes = (entity as any).attributes;
        this.yaw = entity.yaw;
        this.pitch = entity.pitch;
        this.controlState = ControlStateHandler.DEFAULT();

        this.isUsingItem = isEntityUsingItem(entity);
        this.isUsingMainHand = !whichHandIsEntityUsingBoolean(entity) && this.isUsingItem;
        this.isUsingOffHand = whichHandIsEntityUsingBoolean(entity) && this.isUsingItem;

        // effects
        this.effects = entity.effects;

        this.jumpBoost = this.ctx.getEffectLevel(CheapEffects.JUMP_BOOST, this.effects);
        this.speed = this.ctx.getEffectLevel(CheapEffects.SPEED, this.effects);
        this.slowness = this.ctx.getEffectLevel(CheapEffects.SLOWNESS, this.effects);

        this.dolphinsGrace = this.ctx.getEffectLevel(CheapEffects.DOLPHINS_GRACE, this.effects);
        this.slowFalling = this.ctx.getEffectLevel(CheapEffects.SLOW_FALLING, this.effects);
        this.levitation = this.ctx.getEffectLevel(CheapEffects.LEVITATION, this.effects);

        // armour enchantments
        //const boots = bot.inventory.slots[8];
        const boots = entity.equipment[5];
        if (boots && boots.nbt) {
            const simplifiedNbt = nbt.simplify(boots.nbt);
            const enchantments = simplifiedNbt.Enchantments ?? simplifiedNbt.ench ?? [];
            this.depthStrider = this.ctx.getEnchantmentLevel(CheapEnchantments.DEPTH_STRIDER, enchantments);
        } else {
            this.depthStrider = 0;
        }

        this.pose = PlayerPoses.STANDING;
        return this;
    }

    public updateFromRaw(other: EntityStateBuilder) {
        this.onGround = other.onGround ?? this.onGround;
        this.sneakCollision = other.sneakCollision ?? this.sneakCollision;
        this.isUsingItem = other.isUsingItem ?? this.isUsingItem;
        this.jumpBoost = other.jumpBoost ?? this.jumpBoost;
        this.speed = other.speed ?? this.speed;
        this.slowness = other.slowness ?? this.slowness;
        this.dolphinsGrace = other.dolphinsGrace ?? this.dolphinsGrace;
        this.slowFalling = other.slowFalling ?? this.slowFalling;
        this.levitation = other.levitation ?? this.levitation;
        this.depthStrider = other.depthStrider ?? this.depthStrider;
        this.effects = other.effects ?? this.effects;
        return this;
    }

    public applyToBot(bot: Bot) {
        bot.entity.position.set(this.position.x, this.position.y, this.position.z);
        bot.entity.velocity.set(this.velocity.x, this.velocity.y, this.velocity.z);
        bot.entity.onGround = this.onGround;
        bot.entity.yaw = this.yaw;
        bot.entity.pitch = this.pitch;
        bot.controlState = this.controlState;
        return this;
    }

    /**
     * No idea when you'd use this.
     */
    public applyToEntity(entity: Entity) {
        entity.position = this.position
        entity.velocity = this.velocity
        // entity.position.set(this.position.x, this.position.y, this.position.z);
        // entity.velocity.set(this.velocity.x, this.velocity.y, this.velocity.z);
        entity.onGround = this.onGround;
        entity.yaw = this.yaw;
        entity.pitch = this.pitch;
        return this;
    }

    public clone(): EntityState {
        const other = new EntityState(
            this.ctx,
            this.height,
            this.halfWidth,
            this.position.clone(),
            this.velocity.clone(),
            this.onGround,
            this.controlState.clone(),
            this.yaw,
            this.pitch
        );
        other.age = this.age;
        other.isCollidedHorizontally = this.isCollidedHorizontally;
        other.isCollidedVertically = this.isCollidedVertically;
        other.isInWater = this.isInWater;
        other.isInLava = this.isInLava;
        other.isInWeb = this.isInWeb;
        other.jumpTicks = this.jumpTicks;
        other.jumpQueued = this.jumpQueued;
        other.sneakCollision = this.sneakCollision;
        other.attributes = this.attributes;
        other.isUsingItem = this.isUsingItem;
        other.isUsingMainHand = this.isUsingMainHand;
        other.isUsingOffHand = this.isUsingOffHand;
        other.jumpBoost = this.jumpBoost;
        other.speed = this.speed;
        other.slowness = this.slowness;
        other.dolphinsGrace = this.dolphinsGrace;
        other.slowFalling = this.slowFalling;
        other.levitation = this.levitation;
        other.depthStrider = this.depthStrider;
        other.effects = this.effects;
        other.pose = this.pose;
        return other;
    }

    public merge(other: EntityState) {
        this.age = other.age
        this.position = other.position.clone();
        this.velocity = other.velocity.clone();
        this.onGround = other.onGround;
        this.isCollidedHorizontally = other.isCollidedHorizontally;
        this.isCollidedVertically = other.isCollidedVertically;
        this.isInWater = other.isInWater;
        this.isInLava = other.isInLava;
        this.isInWeb = other.isInWeb;
        this.jumpTicks = other.jumpTicks;
        this.jumpQueued = other.jumpQueued;
        this.sneakCollision = other.sneakCollision;
        this.attributes = other.attributes;
        this.isUsingItem = other.isUsingItem;
        this.isUsingMainHand = other.isUsingMainHand;
        this.isUsingOffHand = other.isUsingOffHand;
        this.jumpBoost = other.jumpBoost;
        this.speed = other.speed;
        this.slowness = other.slowness;
        this.dolphinsGrace = other.dolphinsGrace;
        this.slowFalling = other.slowFalling;
        this.levitation = other.levitation;
        this.depthStrider = other.depthStrider;
        this.effects = other.effects;
        this.pose = other.pose;
        return this;
    }

    public clearControlStates(): EntityState {
        this.controlState = ControlStateHandler.DEFAULT();
        return this;
    }

    /**
     * needs to be updated.
     * @returns AABB
     */
    public getAABB(): AABB {
        const w = this.halfWidth;
        return new AABB(
            this.position.x - w,
            this.position.y,
            this.position.z - w,
            this.position.x + w,
            this.position.y + this.height,
            this.position.z + w
        );
    }

    public getUnderlyingBlockBBs(world: any /*prismarine-world*/) {
        const queryBB = this.getAABB();
        return this.ctx.getUnderlyingBlockBBs(queryBB, world);
    }

    public getSurroundingBBs(world: any /*prismarine-world*/): AABB[] {
        const queryBB = this.getAABB();
        return this.ctx.getSurroundingBBs(queryBB, world);
    }
}
