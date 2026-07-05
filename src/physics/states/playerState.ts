import { Bot, ControlState, ControlStateStatus, Effect, GameMode } from "mineflayer";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import * as nbt from "prismarine-nbt";
import { Vec3 } from "vec3";
import {
    CheapEffects,
    CheapEnchantments,
    getStatusEffectNamesForVersion,
    isEntityUsingItem,
    isUsableElytraItem,
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
import type { PistonMoveEvent } from "../../subsystems/piston-push";
import { PlayerPoses, getCollider, playerPoseCtx } from "./poses";
import { Heading, getPose } from ".";
import { getAttributeValue } from "../info/attributes";


export function convInpToAxes(player: PlayerState): Heading {
    return {
      forward: (player.control.forward as unknown as number) - (player.control.back as unknown as number),
      strafe: (player.control.left as unknown as number) - (player.control.right as unknown as number),
    };
  }

/**
 * Normalize an item's enchantments into the array shape getEnchantmentLevel() consumes:
 * `[{ id, lvl, level, name }]`. Handles both the 26.2 components era and legacy NBT.
 *
 * We surface BOTH `lvl` and `level` so the consumer works regardless of which key it reads.
 */
function getItemEnchantments(item: any, registry?: any): any[] {
    if (!item) return [];

    // Resolve a runtime-synced enchantment registry index -> namespaced name (e.g. 36 -> "soul_speed").
    // The 26.2 component carries the RUNTIME registry id, which is connection/datapack-specific and does
    // NOT necessarily equal minecraft-data's static enchantmentsByName[name].id -- so resolve it via the
    // bot's synced registry and attach the NAME, making the engine's string-name match path the reliable one.
    const idToName = (id: any): string | undefined => {
        if (typeof id === "string") return id.replace(/^minecraft:/, "");
        if (registry?.enchantmentsByName && typeof id === "number") {
            for (const k of Object.keys(registry.enchantmentsByName)) {
                if (registry.enchantmentsByName[k]?.id === id) return k;
            }
        }
        return undefined;
    };
    const norm = (e: any) => {
        const name = idToName(e.id);
        return {
            // Prefer the resolved name as `id` so getEnchantmentLevel's string match fires; keep numeric too.
            id: name ?? e.id,
            numericId: typeof e.id === "number" ? e.id : undefined,
            name,
            lvl: e.lvl ?? e.level,
            level: e.level ?? e.lvl,
        };
    };

    // 26.2 components path (preferred). `item.enchants` getter returns the component data unchanged.
    try {
        if (item.componentMap?.has?.("enchantments")) {
            const data = item.componentMap.get("enchantments")?.data;
            const list = Array.isArray(data) ? data : data?.enchantments;
            if (Array.isArray(list)) return list.map(norm);
        }
    } catch (_e) { /* fall through to legacy */ }

    // Legacy NBT path (pre-1.20.5 / other-entity items).
    if (item.nbt) {
        try {
            const simplified: any = nbt.simplify(item.nbt);
            const list = simplified.Enchantments ?? simplified.ench ?? [];
            if (Array.isArray(list)) return list.map(norm);
        } catch (_e) { /* ignore */ }
    }
    return [];
}

function getItemUseEffects(item: any): { canSprint: boolean; speedMultiplier: number } {
    if (item) {
        try {
            const data = item.componentMap?.get?.("use_effects")?.data;
            if (data) {
                return {
                    canSprint: data.can_sprint ?? false,
                    speedMultiplier: typeof data.speed_multiplier === "number" ? data.speed_multiplier : 0.2,
                };
            }
        } catch (_e) { /* fall through to defaults */ }
        const name: string | undefined = item.name;
        if (typeof name === "string" && name.endsWith("_spear")) {
            return { canSprint: true, speedMultiplier: 1.0 };
        }
    }
    return { canSprint: false, speedMultiplier: 0.2 };
}

const PUSHABLE_LIVING_CATEGORIES = new Set([
    "mob", "animal", "hostile", "passive", "ambient", "living",
    "water_creature", "water_ambient", "underground_water_creature", "creature",
]);

function isPushableEntityType(e: any): boolean {
    if (!e) return false;
    if (e.type === "player") return true;
    return typeof e.type === "string" && PUSHABLE_LIVING_CATEGORIES.has(e.type);
}

function collectPushableEntityBoxes(bot: any, px: number, pz: number): AABB[] {
    const out: AABB[] = [];
    const entities = bot?.entities;
    if (!entities) return out;
    const selfId = bot.entity?.id;
    for (const id in entities) {
        const e = entities[id];
        if (!e || e === bot.entity || (selfId != null && e.id === selfId)) continue;
        const pos = e.position;
        if (!pos) continue;
        if (!isPushableEntityType(e)) continue;
        const ddx = pos.x - px;
        const ddz = pos.z - pz;
        if (ddx * ddx + ddz * ddz > 16) continue;
        const hw = (typeof e.width === "number" ? e.width : 0.6) / 2;
        const h = typeof e.height === "number" ? e.height : 1.8;
        out.push(new AABB(pos.x - hw, pos.y, pos.z - hw, pos.x + hw, pos.y + h, pos.z + hw));
    }
    return out;
}

function collectPistonMoveEvents(bot: any): PistonMoveEvent[] {
    const evs = bot?.pistonEvents ?? bot?._activePistons;
    return Array.isArray(evs) ? evs : [];
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

    public toString(): string {
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
    public lastOnGround: boolean = false;
    public fallDistance: number = 0;
    public onClimbable: boolean = false;
    public isInPowderSnow: boolean = false;
    public wasInPowderSnow: boolean = false;
    public canWalkOnPowderSnow: boolean = false;
    public isInWater: boolean = false;
    public isUnderWater: boolean = false;
    public wasEyeInWater: boolean = false;
    public isInLava: boolean = false;
    public isUnderLava: boolean = false;
    public waterHeight: number = 0;
    public lavaHeight: number = 0;
    public isInWeb: boolean = false;
    public validElytraEquipped: boolean = false;
    public fireworkRocketDuration: number = 0;
    public isCollidedHorizontally: boolean = false;
    public isCollidedHorizontallyMinor: boolean = false;
    public isCollidedVertically: boolean = false;
    public supportingBlockPos: Vec3 | null = null;
    public stuckSpeedMultiplier: Vec3 = new Vec3(0, 0, 0);

    public pushableEntities: AABB[] = [];

    public pistonEvents: PistonMoveEvent[] = [];

    public jumpTicks: number = 0;
    public jumpQueued: boolean = false;

    public autoSpinAttackTicks: number = 0;
    public riptideQueued: boolean = false;
    public riptideLevel: number = 0;

    public sprintTriggerTime: number = 0;
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

    public itemUseSpeedMultiplier: number = 0.2;
    public itemUseCanSprint: boolean = false;

    public isPassenger: boolean = false;

    public get isSlowDueToUsingItem(): boolean {
        return this.isUsingItem && !this.itemUseCanSprint;
    }

    public jumpBoost: number = 0;
    public speed: number = 0;
    public slowness: number = 0;
    public dolphinsGrace: number = 0;
    public slowFalling: number = 0;
    public levitation: number = 0;
    public blindness: number = 0;
    public weaving: number = 0;

    public depthStrider: number = 0;
    public swiftSneak: number = 0;
    public soulSpeed: number = 0;

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
    public _sprinting: boolean = false;

    public get sprinting(): boolean {
        return this._sprinting;
    }

    public set sprinting(value: boolean) {
        // console.trace('set sprinting', value)
        this._sprinting = value;
    }

    /**
     * TODO: proper impl.
     */
    public crouching: boolean = false;

    /**
     * TODO: proper impl.
     */
    public fallFlying: boolean = false;

    /**
     * Deprecated compatibility alias for fallFlying.
     */
    public get elytraFlying(): boolean {
        return this.fallFlying;
    }

    public set elytraFlying(value: boolean) {
        this.fallFlying = value;
    }

    /**
     * TODO: proper impl.
     */
    public flySpeed: number = 0;

    public get onGroundWithoutSupportingBlock(): boolean {
        return this.onGround && !this.supportingBlockPos;
    }

    public get scale(): number {
        const attrName = this.ctx.scaleAttribute;
        if (!attrName) return 1.0;
        const attr = (this.attributes as any)?.[attrName];
        if (!attr) return 1.0;
        return Math.fround(getAttributeValue(attr, attrName));
    }

    private get appliedScale(): number {
        if (this.pose === PlayerPoses.SLEEPING || this.pose === PlayerPoses.DYING) return 1.0;
        return this.scale;
    }

    public get height(): number {
        return playerPoseCtx[this.pose].height * this.appliedScale;
    }

    private get baseEyeHeight(): number {
        switch (this.pose) {
            case PlayerPoses.STANDING:
                return 1.62;
            case PlayerPoses.SNEAKING:
                return 1.27;
            case PlayerPoses.DYING:
            case PlayerPoses.SLEEPING:
            case PlayerPoses.SWIMMING:
            case PlayerPoses.FALL_FLYING:
            case PlayerPoses.SPIN_ATTACK:
                return 0.4;
            default:
                return 1.62;
        }
    }

    public get eyeHeight(): number {
        return this.baseEyeHeight * this.appliedScale;
    }

    public get halfWidth(): number {
        return (playerPoseCtx[this.pose].width * this.appliedScale) / 2;
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
        this.update(bot, ControlStateHandler.COPY_BOT(bot));
    }

    public update(bot: Bot, control?: ControlStateHandler): PlayerState {
        // const bot.entity = bot instanceof bot.entity ? bot : bot.entity;
        // Input / Outputs
        this.pos.set(bot.entity.position.x, bot.entity.position.y, bot.entity.position.z);
        this.vel.set(bot.entity.velocity.x, bot.entity.velocity.y, bot.entity.velocity.z);
        this.supportingBlockPos = (bot.entity as any).supportingBlockPos ?? null;
        this.onGround = bot.entity.onGround;
        this.lastOnGround = (bot.entity as any).lastOnGround ?? bot.entity.onGround;
        this.fallDistance = (bot.entity as any).fallDistance ?? 0;
        this.wasInPowderSnow = (bot.entity as any).isInPowderSnow ?? false;
        this.isInPowderSnow = false;
        this.onClimbable = (bot.entity as any).onClimbable;
        this.isInWater = (bot.entity as any).isInWater;
        this.isUnderWater = (bot.entity as any).isUnderWater;
        this.wasEyeInWater = (bot.entity as any).wasEyeInWater ?? (bot.entity as any).isUnderWater ?? false;
        this.isInLava = (bot.entity as any).isInLava;
        this.isUnderLava = (bot.entity as any).isUnderLava;
        this.isInWeb = (bot.entity as any).isInWeb;
        this.validElytraEquipped = isUsableElytraItem(bot.inventory.slots[bot.getEquipmentDestSlot('torso')]);
        this.fireworkRocketDuration = bot.fireworkRocketDuration;
        this.isCollidedHorizontally = (bot.entity as any).isCollidedHorizontally;
        this.isCollidedHorizontallyMinor = (bot.entity as any).isCollidedHorizontallyMinor;
        this.isCollidedVertically = (bot.entity as any).isCollidedVertically;

        this.pushableEntities = collectPushableEntityBoxes(bot, this.pos.x, this.pos.z);

        this.pistonEvents = collectPistonMoveEvents(bot);

        // dunno what to do about these, ngl.
        this.jumpTicks = (bot as any).jumpTicks ?? 0;
        this.jumpQueued = (bot as any).jumpQueued ?? false;
        this.autoSpinAttackTicks = (bot.entity as any).autoSpinAttackTicks ?? 0;
        this.riptideQueued = (bot as any).riptideQueued ?? false;
        this.riptideLevel = (bot as any).riptideLevel ?? 0;
        this.flyJumpTriggerTime = (bot as any).flyJumpTriggerTime ?? 0;
        this.sprintTriggerTime = (bot as any).sprintTriggerTime ?? 0;

        // Input only (not modified)
        this.attributes = bot.entity.attributes;
        this.yaw = bot.entity.yaw;
        this.pitch = bot.entity.pitch;
        this.control = control ?? ControlStateHandler.COPY_BOT(bot); // prevControl only updated internally.


        this.isUsingItem = bot.usingHeldItem/*  || isEntityUsingItem(bot.entity, this.ctx.supportFeature); */
        this.isUsingMainHand = !whichHandIsEntityUsingBoolean(bot.entity, this.ctx.supportFeature) && this.isUsingItem;
        this.isUsingOffHand = whichHandIsEntityUsingBoolean(bot.entity, this.ctx.supportFeature) && this.isUsingItem;

        this.isPassenger = !!(bot as any).vehicle;
        const usedItem = this.isUsingOffHand ? bot.inventory?.slots?.[45] : bot.heldItem;
        const useEffects = getItemUseEffects(usedItem);
        this.itemUseSpeedMultiplier = useEffects.speedMultiplier;
        this.itemUseCanSprint = useEffects.canSprint;

        // effects
        this.effects = bot.entity.effects;

        this.jumpBoost = this.ctx.getEffectLevel(CheapEffects.JUMP_BOOST, this.effects);
        this.speed = this.ctx.getEffectLevel(CheapEffects.SPEED, this.effects);
        this.slowness = this.ctx.getEffectLevel(CheapEffects.SLOWNESS, this.effects);

        this.dolphinsGrace = this.ctx.getEffectLevel(CheapEffects.DOLPHINS_GRACE, this.effects);
        this.slowFalling = this.ctx.getEffectLevel(CheapEffects.SLOW_FALLING, this.effects);
        this.levitation = this.ctx.getEffectLevel(CheapEffects.LEVITATION, this.effects);
        this.weaving = this.ctx.getEffectLevel(CheapEffects.WEAVING, this.effects);


        // armour enchantments
        // The bot's OWN equipped armour arrives via set_slot into bot.inventory.slots (feet=8, legs=7,
        // chest=6, head=5) -- NOT bot.entity.equipment, which stays null for the local player. Read the
        // inventory slot first, falling back to entity.equipment for pre-1.20.5 / other-entity cases.
        const reg = (bot as any).registry;
        const bootsItem = (bot.inventory?.slots?.[8]) ?? bot.entity.equipment[5];
        const bootsEnch = getItemEnchantments(bootsItem, reg);
        this.depthStrider = this.ctx.getEnchantmentLevel(CheapEnchantments.DEPTH_STRIDER, bootsEnch);
        this.soulSpeed = this.ctx.getEnchantmentLevel(CheapEnchantments.SOUL_SPEED, bootsEnch);
        this.canWalkOnPowderSnow = (bootsItem as any)?.name === "leather_boots";

        const leggingsItem = (bot.inventory?.slots?.[7]) ?? bot.entity.equipment[3];
        const leggingsEnch = getItemEnchantments(leggingsItem, reg);
        this.swiftSneak = this.ctx.getEnchantmentLevel(CheapEnchantments.SWIFT_SNEAK, leggingsEnch);

        this.pose = getPose(bot.entity);
        this.gameMode = bot.game.gameMode;
        this.food = bot.food;

        // TODO:
        this.swimming = (bot.entity as any).swimming ?? false;
        this.sprinting = (bot.entity as any).sprinting ?? false; 
        this.crouching = (bot.entity as any).crouching ?? false;
        this.fallFlying = (bot.entity as any).fallFlying ?? (bot.entity as any).elytraFlying ?? false;

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
                this.flySpeed = 0.05; // same as creative
                this.mayFly = (bot.entity as any).canFly;
                break;
            default:
                throw new Error("Unknown game mode: " + bot.game.gameMode);
        }

        this.flying = !!(bot.entity as any).flying && this.mayFly


        return this;
    }

    public apply(bot: Bot): void {
        // const bot.entity = bot instanceof bot.entity ? bot : bot.entity;
        bot.entity.position.set(this.pos.x, this.pos.y, this.pos.z);
        bot.entity.velocity.set(this.vel.x, this.vel.y, this.vel.z);
        bot.entity.onGround = this.onGround;
        (bot.entity as any).lastOnGround = this.lastOnGround;
        (bot.entity as any).fallDistance = this.fallDistance;
        (bot.entity as any).isInPowderSnow = this.isInPowderSnow;
        (bot.entity as any).onClimbable = this.onClimbable;
        (bot.entity as any).isInWater = this.isInWater;
        (bot.entity as any).isUnderWater = this.isUnderWater;
        (bot.entity as any).wasEyeInWater = this.wasEyeInWater;
        (bot.entity as any).isInLava = this.isInLava;
        (bot.entity as any).isUnderLava = this.isUnderLava;
        (bot.entity as any).isInWeb = this.isInWeb;
        (bot.entity as any).elytraEquipped = this.validElytraEquipped;
        bot.fireworkRocketDuration = this.fireworkRocketDuration;
        (bot.entity as any).isCollidedHorizontally = this.isCollidedHorizontally;
        (bot.entity as any).isCollidedHorizontallyMinor = this.isCollidedHorizontallyMinor;
        (bot.entity as any).isCollidedVertically = this.isCollidedVertically;
        (bot.entity as any).supportingBlockPos = this.supportingBlockPos;

        // dunno what to do about these, ngl.
        (bot as any).jumpTicks = this.jumpTicks;
        (bot as any).jumpQueued = this.jumpQueued;
        (bot.entity as any).autoSpinAttackTicks = this.autoSpinAttackTicks;
        (bot as any).riptideQueued = false;
        (bot as any).flyJumpTriggerTime = this.flyJumpTriggerTime;
        (bot as any).sprintTriggerTime = this.sprintTriggerTime;

        bot.entity.yaw = this.yaw;
        bot.entity.pitch = this.pitch;
        bot.entity.height = this.height;
        bot.entity.width = this.halfWidth * 2;
        (bot.entity as any).eyeHeight = this.eyeHeight;

        Object.assign(bot.entity, this.pose)
        bot.game.gameMode = this.gameMode; // this should never actually be in charge.
        bot.food = this.food; // this should also never actually be in charge.

        (bot.entity as any).flying = this.flying ?? false;
        (bot.entity as any).swimming = this.swimming ?? false;
        (bot.entity as any).sprinting = this.sprinting ?? false;
        (bot.entity as any).crouching = this.crouching ?? false;
        (bot.entity as any).fallFlying = this.fallFlying;
        bot.entity.elytraFlying = this.fallFlying;
        bot.entity.attributes = this.attributes;

        this.control.applyControls(bot);
        (bot.entity as any).prevControl = this.prevControl;
    }

    public clone() {
        const tmp = new PlayerState(this.ctx, this.bot, this.control);
        tmp.pos.set(this.pos.x, this.pos.y, this.pos.z);
        tmp.vel.set(this.vel.x, this.vel.y, this.vel.z);
        tmp.onGround = this.onGround;
        tmp.lastOnGround = this.lastOnGround;
        tmp.fallDistance = this.fallDistance;
        tmp.isInPowderSnow = this.isInPowderSnow;
        tmp.wasInPowderSnow = this.wasInPowderSnow;
        tmp.canWalkOnPowderSnow = this.canWalkOnPowderSnow;
        tmp.onClimbable = this.onClimbable;
        tmp.isInWater = this.isInWater;
        tmp.isUnderWater = this.isUnderWater;
        tmp.wasEyeInWater = this.wasEyeInWater;
        tmp.isInLava = this.isInLava;
        tmp.isUnderLava = this.isUnderLava;
        tmp.isInWeb = this.isInWeb;
        tmp.validElytraEquipped = this.validElytraEquipped;
        tmp.fireworkRocketDuration = this.fireworkRocketDuration;
        tmp.isCollidedHorizontally = this.isCollidedHorizontally;
        tmp.isCollidedHorizontallyMinor = this.isCollidedHorizontallyMinor;
        tmp.isCollidedVertically = this.isCollidedVertically;
        tmp.supportingBlockPos = this.supportingBlockPos;
        tmp.pushableEntities = this.pushableEntities;
        tmp.pistonEvents = this.pistonEvents;

        tmp.sneakCollision = false; //TODO

        //not sure what to do here, ngl.
        tmp.jumpTicks = this.jumpTicks ?? 0;
        tmp.jumpQueued = this.jumpQueued ?? false;
        tmp.autoSpinAttackTicks = this.autoSpinAttackTicks ?? 0;
        tmp.riptideQueued = this.riptideQueued ?? false;
        tmp.riptideLevel = this.riptideLevel ?? 0;
        tmp.flyJumpTriggerTime = this.flyJumpTriggerTime ?? 0;
        tmp.sprintTriggerTime = this.sprintTriggerTime ?? 0;

        // Input only (not modified)
        tmp.attributes = this.attributes;
        tmp.yaw = this.yaw;
        tmp.pitch = this.pitch;
        tmp.control = this.control.clone();
        tmp.prevControl = this.prevControl.clone();

        tmp.isUsingItem = this.isUsingItem;
        tmp.isUsingMainHand = this.isUsingMainHand;
        tmp.isUsingOffHand = this.isUsingOffHand;
        tmp.itemUseSpeedMultiplier = this.itemUseSpeedMultiplier;
        tmp.itemUseCanSprint = this.itemUseCanSprint;
        tmp.isPassenger = this.isPassenger;

        // effects
        tmp.effects = this.effects;
        tmp.statusEffectNames = this.statusEffectNames;

        tmp.jumpBoost = this.jumpBoost;
        tmp.speed = this.speed;
        tmp.slowness = this.slowness;

        tmp.dolphinsGrace = this.dolphinsGrace;
        tmp.slowFalling = this.slowFalling;
        tmp.levitation = this.levitation;
        tmp.blindness = this.blindness;
        tmp.weaving = this.weaving;
        tmp.soulSpeed = this.soulSpeed;
        tmp.swiftSneak = this.swiftSneak;
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
        this.lastOnGround = other.lastOnGround;
        this.fallDistance = other.fallDistance;
        this.isInPowderSnow = other.isInPowderSnow;
        this.wasInPowderSnow = other.wasInPowderSnow;
        this.canWalkOnPowderSnow = other.canWalkOnPowderSnow;
        this.onClimbable = other.onClimbable;
        this.isInWater = other.isInWater;
        this.isUnderWater = other.isUnderWater;
        this.wasEyeInWater = other.wasEyeInWater;
        this.isInLava = other.isInLava;
        this.isUnderLava = other.isUnderLava;
        this.isInWeb = other.isInWeb;
        this.validElytraEquipped = other.validElytraEquipped;
        this.fireworkRocketDuration = other.fireworkRocketDuration;
        this.isCollidedHorizontally = other.isCollidedHorizontally;
        this.isCollidedHorizontallyMinor = other.isCollidedHorizontallyMinor
        this.isCollidedVertically = other.isCollidedVertically;
        this.supportingBlockPos = other.supportingBlockPos;
        this.pushableEntities = other.pushableEntities;
        this.pistonEvents = other.pistonEvents;

        this.sneakCollision = false; //TODO

        //not sure what to do here, ngl.
        this.jumpTicks = other.jumpTicks ?? 0;
        this.jumpQueued = other.jumpQueued ?? false;
        this.autoSpinAttackTicks = other.autoSpinAttackTicks ?? 0;
        this.riptideQueued = other.riptideQueued ?? false;
        this.riptideLevel = other.riptideLevel ?? 0;
        this.flyJumpTriggerTime = other.flyJumpTriggerTime ?? 0;
        this.sprintTriggerTime = other.sprintTriggerTime ?? 0;

        // Input only (not modified)
        this.attributes = other.attributes;
        this.yaw = other.yaw;
        this.pitch = other.pitch;
        this.control = other.control.clone();
        this.prevControl = other.prevControl.clone();

        this.isUsingItem = other.isUsingItem;
        this.isUsingMainHand = other.isUsingMainHand;
        this.isUsingOffHand = other.isUsingOffHand;
        this.itemUseSpeedMultiplier = other.itemUseSpeedMultiplier;
        this.itemUseCanSprint = other.itemUseCanSprint;
        this.isPassenger = other.isPassenger;

        // effects
        this.effects = other.effects;
        this.statusEffectNames = other.statusEffectNames;

        this.jumpBoost = other.jumpBoost;
        this.speed = other.speed;
        this.slowness = other.slowness;

        this.dolphinsGrace = other.dolphinsGrace;
        this.slowFalling = other.slowFalling;
        this.swiftSneak = other.swiftSneak;
        this.soulSpeed = other.soulSpeed;
        this.levitation = other.levitation;
        this.weaving = other.weaving;
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


    public lookAt(vec3: Vec3) {
        const dx = vec3.x - this.pos.x;
        const dy = vec3.y - this.pos.y;
        const dz = vec3.z - this.pos.z;

        this.yaw = Math.atan2(dz, dx) * 180 / Math.PI - 90;
        this.pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 180 / Math.PI;
        console.log(this.yaw, this.pitch);
    }

    public look(yaw: number, pitch:number) {
        this.yaw = yaw;
        this.pitch = pitch;
    }
}
export { ControlStateHandler };
