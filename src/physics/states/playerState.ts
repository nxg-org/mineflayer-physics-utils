import { Bot, ControlState, ControlStateStatus, Effect } from "mineflayer";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import * as nbt from "prismarine-nbt";
import { Vec3 } from "vec3";
import {
    CheapEffects,
    CheapEnchantments,
    getStatusEffectNamesForVersion,
    isEntityUsingItem,
    makeSupportFeature,
    whichHandIsEntityUsing,
    whichHandIsEntityUsingBoolean,
} from "../../util/physicsUtils";
// import { bot.entity } from "prismarine-entity";
import md from "minecraft-data";
import { ControlStateHandler } from "../player/playerControls";
import { EntityStateBuilder } from "./entityState";
import { IPhysics } from "../engines/IPhysics";



const defaultMoves: ControlStateHandler = ControlStateHandler.DEFAULT();

//Utility class that wraps PlayerPoses.
export class EntityDimensions {
    public readonly width: number;
    public readonly height: number;
    public readonly fixed: boolean;

    constructor(width: number, height: number, fixed: boolean) {
        this.width = width;
        this.height = height;
        this.fixed = fixed;
    }

    public static scalable(f: number, f2: number): EntityDimensions {
        return new EntityDimensions(f, f2, false);
    }

    public static fixed(f: number, f2: number): EntityDimensions {
        return new EntityDimensions(f, f2, true);
    }

    makeBoundingBox(vec3: Vec3): AABB {
        return this.makeBoundingBoxCoords(vec3.x, vec3.y, vec3.z);
    }

    public makeBoundingBoxCoords(d: number, d2: number, d3: number): AABB {
        const f = this.width / 2.0;
        const f2 = this.height;
        return new AABB(d - f, d2, d3 - f, d + f, d2 + f2, d3 + f);
    }

    public scale(f: number): EntityDimensions {
        return this.scaleRaw(f, f);
    }

    public scaleRaw(f: number, f2: number): EntityDimensions {
        if (this.fixed || (f == 1.0 && f2 == 1.0)) {
            return this;
        }
        return EntityDimensions.scalable(this.width * f, this.height * f2);
    }

    public toString(): String {
        return "EntityDimensions w=" + this.width + ", h=" + this.height + ", fixed=" + this.fixed;
    }
}

/**
 * Looking at this code, it's too specified towards players.
 *
 * I will eventually split this code into PlayerState and bot.entityState, where bot.entityState contains fewer controls.
 */
export class PlayerState implements EntityStateBuilder {
    public readonly bot: Bot; // needed to clone.
    public height: number = 1.62;
    public halfWidth: number = 0.3;
    public position: Vec3;
    public velocity: Vec3;
    public onGround: boolean;
    public isInWater: boolean;
    public isInLava: boolean;
    public isInWeb: boolean;
    public isCollidedHorizontally: boolean;
    public isCollidedVertically: boolean;
    public jumpTicks: number;
    public jumpQueued: boolean;

    public sneakCollision: boolean;

    public attributes: any /* dunno yet */;
    public yaw: number;
    public pitch: number;
    public controlState: ControlStateHandler;

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
    public statusEffectNames;

    public readonly ctx: IPhysics;
    private readonly supportFeature: ReturnType<typeof makeSupportFeature>;

    constructor(ctx: IPhysics, bot: Bot, control?: ControlStateHandler) {
        this.supportFeature = makeSupportFeature(ctx.data);
        this.ctx = ctx;
        this.bot = bot;
        this.position = bot.entity.position.clone();
        this.velocity = bot.entity.velocity.clone();
        this.onGround = bot.entity.onGround;
        this.isInWater = (bot.entity as any).isInWater;
        this.isInLava = (bot.entity as any).isInLava;
        this.isInWeb = (bot.entity as any).isInWeb;
        this.isCollidedHorizontally = (bot.entity as any).isCollidedHorizontally;
        this.isCollidedVertically = (bot.entity as any).isCollidedVertically;
        this.sneakCollision = false; //TODO

        //not sure what to do here, ngl.
        this.jumpTicks = (bot as any).jumpTicks ?? 0;
        this.jumpQueued = (bot as any).jumpQueued ?? false;

        // Input only (not modified)
        this.attributes = (bot.entity as any).attributes;
        this.yaw = bot.entity.yaw;
        this.pitch = bot.entity.pitch;
        this.controlState = control ?? ControlStateHandler.DEFAULT();

        this.isUsingItem = isEntityUsingItem(bot.entity);
        this.isUsingMainHand = !whichHandIsEntityUsingBoolean(bot.entity) && this.isUsingItem;
        this.isUsingOffHand = whichHandIsEntityUsingBoolean(bot.entity) && this.isUsingItem;

        // effects
        this.effects = bot.entity.effects;
        this.statusEffectNames = getStatusEffectNamesForVersion(this.supportFeature);

        this.jumpBoost = this.ctx.getEffectLevelCustom(CheapEffects.JUMP_BOOST, this.effects);
        this.speed = this.ctx.getEffectLevelCustom(CheapEffects.SPEED, this.effects);
        this.slowness = this.ctx.getEffectLevelCustom(CheapEffects.SLOWNESS, this.effects);

        this.dolphinsGrace = this.ctx.getEffectLevelCustom(CheapEffects.DOLPHINS_GRACE, this.effects);
        this.slowFalling = this.ctx.getEffectLevelCustom(CheapEffects.SLOW_FALLING, this.effects);
        this.levitation = this.ctx.getEffectLevelCustom(CheapEffects.LEVITATION, this.effects);

        
        // this.jumpBoost = ctx.getEffectLevel(this.statusEffectNames.jumpBoostEffectName, this.effects);
        // this.speed = ctx.getEffectLevel(this.statusEffectNames.speedEffectName, this.effects);
        // this.slowness = ctx.getEffectLevel(this.statusEffectNames.slownessEffectName, this.effects);

        // this.dolphinsGrace = ctx.getEffectLevel(this.statusEffectNames.dolphinsGraceEffectName, this.effects);
        // this.slowFalling = ctx.getEffectLevel(this.statusEffectNames.slowFallingEffectName, this.effects);
        // this.levitation = ctx.getEffectLevel(this.statusEffectNames.levitationEffectName, this.effects);

        // armour enchantments
        //const boots = bot.inventory.slots[8];
        const boots = bot.entity.equipment[5];
        if (boots && boots.nbt) {
            const simplifiedNbt = nbt.simplify(boots.nbt);
            const enchantments = simplifiedNbt.Enchantments ?? simplifiedNbt.ench ?? [];
            this.depthStrider = this.ctx.getEnchantmentLevelCustom(CheapEnchantments.DEPTH_STRIDER, enchantments);
        } else {
            this.depthStrider = 0;
        }
    }

    public update(bot: Bot, control?: ControlStateHandler): PlayerState {
        // const bot.entity = bot instanceof bot.entity ? bot : bot.entity;
        // Input / Outputs
        this.position = bot.entity.position.clone();
        this.velocity = bot.entity.velocity.clone();
        this.onGround = bot.entity.onGround;
        this.isInWater = (bot.entity as any).isInWater;
        this.isInLava = (bot.entity as any).isInLava;
        this.isInWeb = (bot.entity as any).isInWeb;
        this.isCollidedHorizontally = (bot.entity as any).isCollidedHorizontally;
        this.isCollidedVertically = (bot.entity as any).isCollidedVertically;

        // dunno what to do about these, ngl.
        this.jumpTicks = (bot as any).jumpTicks ?? 0;
        this.jumpQueued = (bot as any).jumpQueued ?? false;

        // Input only (not modified)
        this.attributes = (bot.entity as any).attributes;
        this.yaw = bot.entity.yaw;
        this.pitch = bot.entity.pitch;
        this.controlState = control ?? this.controlState;

        this.isUsingItem = isEntityUsingItem(bot.entity);
        this.isUsingMainHand = !whichHandIsEntityUsingBoolean(bot.entity) && this.isUsingItem;
        this.isUsingOffHand = whichHandIsEntityUsingBoolean(bot.entity) && this.isUsingItem;

        // effects
        this.effects = bot.entity.effects;

        this.jumpBoost = this.ctx.getEffectLevelCustom(CheapEffects.JUMP_BOOST, this.effects);
        this.speed = this.ctx.getEffectLevelCustom(CheapEffects.SPEED, this.effects);
        this.slowness = this.ctx.getEffectLevelCustom(CheapEffects.SLOWNESS, this.effects);

        this.dolphinsGrace = this.ctx.getEffectLevelCustom(CheapEffects.DOLPHINS_GRACE, this.effects);
        this.slowFalling = this.ctx.getEffectLevelCustom(CheapEffects.SLOW_FALLING, this.effects);
        this.levitation = this.ctx.getEffectLevelCustom(CheapEffects.LEVITATION, this.effects);

        
        // armour enchantments
        //const boots = bot.inventory.slots[8];
        const boots = bot.entity.equipment[5];
        if (boots && boots.nbt) {
            const simplifiedNbt = nbt.simplify(boots.nbt);
            const enchantments = simplifiedNbt.Enchantments ?? simplifiedNbt.ench ?? [];
            this.depthStrider = this.ctx.getEnchantmentLevelCustom(CheapEnchantments.DEPTH_STRIDER, enchantments);
        } else {
            this.depthStrider = 0;
        }

        return this;
    }

    public apply(bot: Bot): void {
        // const bot.entity = bot instanceof bot.entity ? bot : bot.entity;
        bot.entity.position = this.position;
        bot.entity.velocity = this.velocity;
        bot.entity.onGround = this.onGround;
        (bot.entity as any).isInWater = this.isInWater;
        (bot.entity as any).isInLava = this.isInLava;
        (bot.entity as any).isInWeb = this.isInWeb;
        (bot.entity as any).isCollidedHorizontally = this.isCollidedHorizontally;
        (bot.entity as any).isCollidedVertically = this.isCollidedVertically;

        // dunno what to do about these, ngl.
        (bot as any).jumpTicks = this.jumpTicks;
        (bot as any).jumpQueued = this.jumpQueued;
        bot.entity.yaw = this.yaw;
        bot.entity.pitch = this.pitch;
        bot.controlState = this.controlState;
    }

    public clone() {
        const tmp = new PlayerState(this.ctx, this.bot, this.controlState);
        tmp.position = this.position.clone();
        tmp.velocity = this.velocity.clone();
        tmp.onGround = this.onGround;
        tmp.isInWater = this.isInWater;
        tmp.isInLava = this.isInLava;
        tmp.isInWeb = this.isInWeb;
        tmp.isCollidedHorizontally = this.isCollidedHorizontally;
        tmp.isCollidedVertically = this.isCollidedVertically;
        tmp.sneakCollision = false; //TODO

        //not sure what to do here, ngl.
        tmp.jumpTicks = this.jumpTicks ?? 0;
        tmp.jumpQueued = this.jumpQueued ?? false;

        // Input only (not modified)
        tmp.attributes = this.attributes;
        tmp.yaw = this.yaw;
        tmp.pitch = this.pitch;
        tmp.controlState = this.controlState;

        tmp.isUsingItem = this.isUsingItem;
        tmp.isUsingMainHand = this.isUsingMainHand;
        tmp.isUsingOffHand = this.isUsingOffHand;

        // effects
        tmp.effects = this.effects;
        tmp.statusEffectNames = this.statusEffectNames;

        tmp.jumpBoost = this.jumpBoost;
        tmp.speed = this.speed;
        tmp.slowness = this.slowness;

        tmp.dolphinsGrace = this.dolphinsGrace;
        tmp.slowFalling = this.slowFalling;
        tmp.levitation = this.levitation;
        tmp.depthStrider = this.depthStrider;
        return tmp;
    }


    public merge(other: PlayerState) {
        this.position = other.position.clone();
        this.velocity = other.velocity.clone();
        this.onGround = other.onGround;
        this.isInWater = other.isInWater;
        this.isInLava = other.isInLava;
        this.isInWeb = other.isInWeb;
        this.isCollidedHorizontally = other.isCollidedHorizontally;
        this.isCollidedVertically = other.isCollidedVertically;
        this.sneakCollision = false; //TODO

        //not sure what to do here, ngl.
        this.jumpTicks = other.jumpTicks ?? 0;
        this.jumpQueued = other.jumpQueued ?? false;

        // Input only (not modified)
        this.attributes = other.attributes;
        this.yaw = other.yaw;
        this.pitch = other.pitch;
        this.controlState = other.controlState.clone();

        this.isUsingItem = other.isUsingItem;
        this.isUsingMainHand = other.isUsingMainHand;
        this.isUsingOffHand = other.isUsingOffHand;

        // effects
        this.effects = other.effects;
        this.statusEffectNames = other.statusEffectNames;

        this.jumpBoost = other.jumpBoost;
        this.speed = other.speed;
        this.slowness = other.slowness;

        this.dolphinsGrace = other.dolphinsGrace;
        this.slowFalling = other.slowFalling;
        this.levitation = other.levitation;
        this.depthStrider = other.depthStrider;
        return this;

    }

    public clearControlStates(): PlayerState {
        this.controlState = defaultMoves
        return this
    }

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

    
    public getUnderlyingBlockBBs(world:any /*prismarine-world*/) {
        const queryBB = this.getAABB();
        return this.ctx.getUnderlyingBlockBBs(queryBB, world)
    }

    public getSurroundingBBs(world:any /*prismarine-world*/): AABB[] {
        const queryBB = this.getAABB(); 
        return this.ctx.getSurroundingBBs(queryBB, world);
    }
}
