import { Bot, ControlState, ControlStateStatus, Effect, GameMode } from "mineflayer";
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
import { IEntityState } from ".";
import { IPhysics } from "../engines/IPhysics";
import type { Entity } from "prismarine-entity";
import { PlayerPoses, getCollider, playerPoseCtx } from "./poses";
import { Heading, getPose } from ".";


export function convInpToAxes(player: PlayerState): Heading {
    return {
      forward: (player.control.forward as unknown as number) - (player.control.back as unknown as number),
      strafe: (player.control.forward as unknown as number) - (player.control.back as unknown as number),
    };
  }

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
export class PlayerState implements IEntityState {
    public readonly bot: Bot; // needed to clone.
    public age: number = 0;
    // public height: number = 1.8;
    // public eyeHeight: number = 1.62;
    // public halfWidth: number = 0.3;
    public pos: Vec3;
    public vel: Vec3;

    public onGround: boolean = false;
    public onClimbable: boolean = false;
    public isInWater: boolean = false;
    public isUnderWater: boolean = false;
    public isInLava: boolean = false;
    public isUnderLava: boolean = false;
    public isInWeb: boolean = false;
    public elytraFlying: boolean = false;
    public elytraEquipped: boolean = false;
    public fireworkRocketDuration: number = 0;
    public isCollidedHorizontally: boolean = false;
    public isCollidedVertically: boolean = false;
    public supportingBlockPos: Vec3 | null = null;

    public jumpTicks: number = 0;
    public jumpQueued: boolean = false;
    public flyJumpTriggerTime: number = 0;

    public sneakCollision: boolean = false;

    public attributes: Entity["attributes"] /* dunno yet */ = {};
    public yaw: number = 0;
    public pitch: number = 0;
    public control: ControlStateHandler = defaultMoves;
    public prevControl: ControlStateHandler = defaultMoves;
    public heading: Heading = { forward: 0, strafe: 0 };
    public prevHeading: Heading = { forward: 0, strafe: 0 };

    public isUsingItem: boolean = false;
    public isUsingMainHand: boolean = false;
    public isUsingOffHand: boolean = false;

    public jumpBoost: number = 0;
    public speed: number = 0;
    public slowness: number = 0;
    public dolphinsGrace: number = 0;
    public slowFalling: number = 0;
    public levitation: number = 0;
    public depthStrider: number = 0;
    public swiftSneak: number = 0;
    public blindness: number = 0;

    public effects: Effect[] = [];
    public statusEffectNames: ReturnType<typeof  getStatusEffectNamesForVersion>;

    public pose: PlayerPoses = PlayerPoses.STANDING;
    public gameMode: GameMode = "survival";

    public food: number = 0;

    // the below fields are abilities mineflayer is supposed to store.

    /**
     * TODO: proper impl.
     */
    public mayFly: boolean = false;

    /**
     * TODO: proper impl.
     */
    public flying: boolean = false;

 
    /**
     * TODO: proper impl.
     */
    public swimming: boolean = false;

    /**
     * TODO: proper impl.
     */
    public sprinting: boolean = false;

    /**
     * TODO: proper impl.
     */
    public crouching: boolean = false;

    /**
     * TODO: proper impl.
     */
    public fallFlying: boolean = false;

    /**
     * TODO: proper impl.
     */
    public flySpeed: number = 0;

    public get height(): number {
        return playerPoseCtx[this.pose].height;
    }

    public get eyeHeight(): number {
        switch (this.pose) {
            case PlayerPoses.STANDING:
                return 1.62;
            case PlayerPoses.SNEAKING:
                return 1.27;
            case PlayerPoses.SWIMMING:
            case PlayerPoses.FALL_FLYING:
            case PlayerPoses.SPIN_ATTACK:
                return 0.4;
            default:
                return 1.62;
        }
    }

    public get halfWidth(): number {
        return playerPoseCtx[this.pose].width / 2;
    }

    public readonly ctx: IPhysics;
    private readonly supportFeature: ReturnType<typeof makeSupportFeature>;

    constructor(ctx: IPhysics, bot: Bot, control?: ControlStateHandler) {
        this.supportFeature = makeSupportFeature(ctx.data);
        this.ctx = ctx;
        this.bot = bot;
        this.pos = bot.entity.position.clone();
        this.vel = bot.entity.velocity.clone();
        this.statusEffectNames = getStatusEffectNamesForVersion(this.supportFeature);
        this.update(bot, control ?? defaultMoves);
    }

    public update(bot: Bot, control?: ControlStateHandler): PlayerState {
        // const bot.entity = bot instanceof bot.entity ? bot : bot.entity;
        // Input / Outputs
        this.pos.set(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
        this.vel.set(bot.entity.velocity.x, bot.entity.velocity.y, bot.entity.velocity.z);
        this.supportingBlockPos = (bot.entity as any).supportingBlockPos ?? null;
        this.onGround = bot.entity.onGround;
        this.onClimbable = (bot.entity as any).onClimbable;
        this.isInWater = (bot.entity as any).isInWater;
        this.isUnderWater = (bot.entity as any).isUnderWater;
        this.isInLava = (bot.entity as any).isInLava;
        this.isUnderLava = (bot.entity as any).isUnderLava;
        this.isInWeb = (bot.entity as any).isInWeb;
        this.elytraFlying = (bot.entity as any).elytraFlying;
        this.elytraEquipped = bot.inventory.slots[bot.getEquipmentDestSlot('torso')]?.name === 'elytra';
        this.fireworkRocketDuration = bot.fireworkRocketDuration;
        this.isCollidedHorizontally = (bot.entity as any).isCollidedHorizontally;
        this.isCollidedVertically = (bot.entity as any).isCollidedVertically;

        // dunno what to do about these, ngl.
        this.jumpTicks = (bot as any).jumpTicks ?? 0;
        this.jumpQueued = (bot as any).jumpQueued ?? false;
        this.flyJumpTriggerTime = (bot as any).flyJumpTriggerTime ?? 0;

        // Input only (not modified)
        this.attributes = bot.entity.attributes;
        this.yaw = bot.entity.yaw;
        this.pitch = bot.entity.pitch;
        this.control = control ?? this.control; // prevControl only updated internally.

        this.isUsingItem = isEntityUsingItem(bot.entity, this.ctx.supportFeature);
        this.isUsingMainHand = !whichHandIsEntityUsingBoolean(bot.entity, this.ctx.supportFeature) && this.isUsingItem;
        this.isUsingOffHand = whichHandIsEntityUsingBoolean(bot.entity, this.ctx.supportFeature) && this.isUsingItem;

        // effects
        this.effects = bot.entity.effects;

        this.jumpBoost = this.ctx.getEffectLevel(CheapEffects.JUMP_BOOST, this.effects);
        this.speed = this.ctx.getEffectLevel(CheapEffects.SPEED, this.effects);
        this.slowness = this.ctx.getEffectLevel(CheapEffects.SLOWNESS, this.effects);

        this.dolphinsGrace = this.ctx.getEffectLevel(CheapEffects.DOLPHINS_GRACE, this.effects);
        this.slowFalling = this.ctx.getEffectLevel(CheapEffects.SLOW_FALLING, this.effects);
        this.levitation = this.ctx.getEffectLevel(CheapEffects.LEVITATION, this.effects);

        
        // armour enchantments
        //const boots = bot.inventory.slots[8];
        const boots = bot.entity.equipment[5];
        if (boots && boots.nbt) {
            const simplifiedNbt = nbt.simplify(boots.nbt);
            const enchantments = simplifiedNbt.Enchantments ?? simplifiedNbt.ench ?? [];
            this.depthStrider = this.ctx.getEnchantmentLevel(CheapEnchantments.DEPTH_STRIDER, enchantments);
        } else {
            this.depthStrider = 0;
        }

        const leggings = bot.entity.equipment[3];
        if (leggings && leggings.nbt) {
            const simplifiedNbt = nbt.simplify(leggings.nbt);
            const enchantments = simplifiedNbt.Enchantments ?? simplifiedNbt.ench ?? [];
            this.swiftSneak = this.ctx.getEnchantmentLevel(CheapEnchantments.SWIFT_SNEAK, enchantments);
        } else {
            this.swiftSneak = 0;
        }

        this.pose = getPose(bot.entity);
        this.gameMode = bot.game.gameMode;
        this.food = bot.food;

        // TODO:
        this.flying = false;
        this.swimming = false;
        this.sprinting = false;
        this.crouching = false;
        this.fallFlying = false;

        switch (bot.game.gameMode) {
            case "creative":
                this.flySpeed = 0.05;
                this.mayFly = true;
                break;
            case "spectator":
                this.flySpeed = 0.1;
                this.mayFly = true;
                break;
            case "survival":
            case "adventure":
                this.flySpeed = 0;
                this.mayFly = false;
                break;
            default:
                throw new Error("Unknown game mode: " + bot.game.gameMode);
        }


        return this;
    }

    public apply(bot: Bot): void {
        // const bot.entity = bot instanceof bot.entity ? bot : bot.entity;
        bot.entity.position.set(this.pos.x, this.pos.y, this.pos.z);
        bot.entity.velocity.set(this.vel.x, this.vel.y, this.vel.z);
        bot.entity.onGround = this.onGround;
        (bot.entity as any).onClimbable = this.onClimbable;
        (bot.entity as any).isInWater = this.isInWater;
        (bot.entity as any).isUnderWater = this.isUnderWater;
        (bot.entity as any).isInLava = this.isInLava;
        (bot.entity as any).isUnderLava = this.isUnderLava;
        (bot.entity as any).isInWeb = this.isInWeb;
        (bot.entity as any).elytraFlying = this.elytraFlying;
        (bot.entity as any).elytraEquipped = this.elytraEquipped;
        bot.fireworkRocketDuration = this.fireworkRocketDuration;
        (bot.entity as any).isCollidedHorizontally = this.isCollidedHorizontally;
        (bot.entity as any).isCollidedVertically = this.isCollidedVertically;
        (bot.entity as any).supportingBlockPos = this.supportingBlockPos;

        // dunno what to do about these, ngl.
        (bot as any).jumpTicks = this.jumpTicks;
        (bot as any).jumpQueued = this.jumpQueued;
        (bot as any).flyJumpTriggerTime = this.flyJumpTriggerTime;

        bot.entity.yaw = this.yaw;
        bot.entity.pitch = this.pitch;

        Object.assign(bot.entity, this.pose)
        bot.game.gameMode = this.gameMode; // this should never actually be in charge.
        bot.food = this.food; // this should also never actually be in charge.

        this.control.applyControls(bot);
    }

    public clone() {
        const tmp = new PlayerState(this.ctx, this.bot, this.control);
        tmp.pos.set(this.pos.x, this.pos.y, this.pos.z);
        tmp.vel.set(this.vel.x, this.vel.y, this.vel.z);
        tmp.onGround = this.onGround;
        tmp.onClimbable = this.onClimbable;
        tmp.isInWater = this.isInWater;
        tmp.isUnderWater = this.isUnderWater;
        tmp.isInLava = this.isInLava;
        tmp.isUnderLava = this.isUnderLava;
        tmp.isInWeb = this.isInWeb;
        tmp.elytraFlying = this.elytraFlying;
        tmp.elytraEquipped = this.elytraEquipped;
        tmp.fireworkRocketDuration = this.fireworkRocketDuration;
        tmp.isCollidedHorizontally = this.isCollidedHorizontally;
        tmp.isCollidedVertically = this.isCollidedVertically;
        tmp.supportingBlockPos = this.supportingBlockPos;

        tmp.sneakCollision = false; //TODO

        //not sure what to do here, ngl.
        tmp.jumpTicks = this.jumpTicks ?? 0;
        tmp.jumpQueued = this.jumpQueued ?? false;
        tmp.flyJumpTriggerTime = this.flyJumpTriggerTime ?? 0;

        // Input only (not modified)
        tmp.attributes = this.attributes;
        tmp.yaw = this.yaw;
        tmp.pitch = this.pitch;
        tmp.control = this.control.clone();
        tmp.prevControl = this.prevControl.clone();

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

        tmp.pose = this.pose;
        tmp.gameMode = this.gameMode;

        tmp.flying = this.flying;
        tmp.swimming = this.swimming;
        tmp.sprinting = this.sprinting;
        tmp.crouching = this.crouching;
        tmp.fallFlying = this.fallFlying;

        tmp.food = this.food;


        return tmp;
    }


    public merge(other: PlayerState) {
        this.pos.set(other.pos.x, other.pos.y, other.pos.z);
        this.vel.set(other.vel.x, other.vel.y, other.vel.z);
        this.onGround = other.onGround;
        this.onClimbable = other.onClimbable;
        this.isInWater = other.isInWater;
        this.isUnderWater = other.isUnderWater;
        this.isInLava = other.isInLava;
        this.isUnderLava = other.isUnderLava;
        this.isInWeb = other.isInWeb;
        this.elytraFlying = other.elytraFlying;
        this.elytraEquipped = other.elytraEquipped;
        this.fireworkRocketDuration = other.fireworkRocketDuration;
        this.isCollidedHorizontally = other.isCollidedHorizontally;
        this.isCollidedVertically = other.isCollidedVertically;
        this.supportingBlockPos = other.supportingBlockPos;

        this.sneakCollision = false; //TODO

        //not sure what to do here, ngl.
        this.jumpTicks = other.jumpTicks ?? 0;
        this.jumpQueued = other.jumpQueued ?? false;
        this.flyJumpTriggerTime = other.flyJumpTriggerTime ?? 0;

        // Input only (not modified)
        this.attributes = other.attributes;
        this.yaw = other.yaw;
        this.pitch = other.pitch;
        this.control = other.control.clone();

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

        this.pose = other.pose;
        this.gameMode = other.gameMode;

        this.flying = other.flying;
        this.swimming = other.swimming;
        this.sprinting = other.sprinting;
        this.crouching = other.crouching;

        this.food = other.food;

        return this;

    }

    public getBB(): AABB {
        const w = this.halfWidth;
        return new AABB(
            this.pos.x - w,
            this.pos.y,
            this.pos.z - w,
            this.pos.x + w,
            this.pos.y + this.height,
            this.pos.z + w
        );
    }

    
    public getUnderlyingBlockBBs(world:any /*prismarine-world*/): AABB[] {
        const queryBB = this.getBB();
        return this.ctx.getUnderlyingBlockBBs(queryBB, world)
    }

    public getSurroundingBBs(world:any /*prismarine-world*/): AABB[] {
        const queryBB = this.getBB(); 
        return this.ctx.getSurroundingBBs(queryBB, world);
    }
}
export { ControlStateHandler };

