import { Entity, EntityType } from "prismarine-entity";
import { EPhysicsCtx } from "../physics/settings";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import features from "../physics/info/features.json";
import md from "minecraft-data";
import { ControlStateHandler, EntityState, IEntityState, PlayerState } from "../physics/states";
import { Vec3 } from "vec3";
import { IPhysics } from "../physics/engines";
import { Bot } from "mineflayer";

export function makeSupportFeature(mcData: md.IndexedData) {
    return (feature: string) => features.some(({ name, versions }) => name === feature && versions.includes(mcData.version.majorVersion!));
}

type SupportFeature = ReturnType<typeof makeSupportFeature>

export const DefaultPlayer: md.Entity = {
    displayName: "Player",
    height: 1.8,
    width: 0.6,
    type: "player",
    name: "player",
    id: -1
}

export function applyMdToNewEntity(ctx: typeof EPhysicsCtx, entityType: md.Entity = DefaultPlayer, options: Partial<Entity> = {}): Entity {
    //entityType.category
    // entityType.internalId
    const tmp = new ctx.entityConstructor(-1);
    tmp.displayName = entityType.displayName
    tmp.height = entityType.height ?? 0;
    tmp.width = entityType.width ?? 0;
    tmp.type = entityType.type as EntityType;
    tmp.name = entityType.name

    Object.assign(tmp, options);
    return tmp as Entity;
}



export enum CheapEffects {
    JUMP_BOOST,
    SPEED,
    SLOWNESS,
    DOLPHINS_GRACE,
    SLOW_FALLING,
    LEVITATION,
    BLINDNESS
}

export enum CheapEnchantments {
    DEPTH_STRIDER,
    SWIFT_SNEAK,
    SOUL_SPEED
}

function getMetadataIndex(supportFeature: SupportFeature) {
    return supportFeature("itemUsageMetadata6") ? 6 : 8;
}

export function isEntityUsingItem(entity: Entity, supportFeature: SupportFeature): boolean {
    return (entity.metadata[getMetadataIndex(supportFeature)] as any) > 1;
}

export function whichHandIsEntityUsing(entity: Entity, supportFeature: SupportFeature): "hand" | "off-hand" {
    return (entity.metadata[getMetadataIndex(supportFeature)] as any) > 2 ? "off-hand" : "hand";
}

export function whichHandIsEntityUsingBoolean(entity: Entity, supportFeature: SupportFeature): boolean {
    return (entity.metadata[getMetadataIndex(supportFeature)] as any) > 2;
}

export function isUsableElytraItem(item: { name?: string; durabilityUsed?: number; maxDurability?: number } | null): boolean {
    if (!item || item.name !== "elytra") return false;
    if (typeof item.durabilityUsed === "number" && typeof item.maxDurability === "number") {
        return item.durabilityUsed < item.maxDurability - 1;
    }
    return true;
}

export function getStatusEffectNamesForVersion(supportFeature: SupportFeature) {
    if (supportFeature("effectNamesAreRegistryNames")) {
        // seems to not matter right now.
        return {
            jumpBoostEffectName: "JumpBoost",
            speedEffectName: "Speed",
            slownessEffectName: "Slowness",
            dolphinsGraceEffectName: "DolphinsGrace",
            slowFallingEffectName: "SlowFalling",
            levitationEffectName: "Levitation",
            blindnessEffectName: "Blindnesss"

        };
    } else {
        return {
            jumpBoostEffectName: "JumpBoost",
            speedEffectName: "Speed",
            slownessEffectName: "Slowness",
            dolphinsGraceEffectName: "DolphinsGrace",
            slowFallingEffectName: "SlowFalling",
            levitationEffectName: "Levitation",
            blindnessEffectName: "Blindnesss"
        };
    }
}

// lol. In case of expansion, yk.
export function getEnchantmentNamesForVersion(supportFeature: ReturnType<typeof makeSupportFeature>) {
    return {
        depthStriderEnchantmentName: "depth_strider",
        swiftSneakEnchantmentName: "swift_sneak",
        soulSpeedEnchantmentName: "soul_speed"
    };
}

export function getBetweenRectangle(src: AABB, dest: AABB) {
    const outerAABB = new AABB(
        Math.min(src.minX, dest.minX),
        Math.min(src.minY, dest.minY),
        Math.min(src.minZ, dest.minZ),
        Math.max(src.maxX, dest.maxX),
        Math.max(src.maxY, dest.maxY),
        Math.max(src.maxZ, dest.maxZ)
    );

    //Math.max() only good for length, otherwise leave because we want good shit.
    const innerAABBWidth = outerAABB.maxX - outerAABB.minX - (src.maxX - src.minX) - (dest.maxX - dest.minX);
    const innerAABBLength = outerAABB.maxZ - outerAABB.minZ - (src.maxZ - src.minZ) - (dest.maxZ - dest.minZ);
    const innerAABBHeight = outerAABB.maxY - outerAABB.minY - (src.maxY - src.minY) - (dest.maxY - dest.minY);

    //hm... could make a new AABB representing inner here.
    const outerCenter = outerAABB.getCenter();
    const wFlip = Math.sign(innerAABBWidth);
    const hFlip = Math.sign(innerAABBHeight);
    const lFlip = Math.sign(innerAABBLength);
    const innerAABB = new AABB(
        outerCenter.x - (wFlip * innerAABBWidth) / 2,
        outerCenter.y - (hFlip * innerAABBHeight) / 2,
        outerCenter.z - (lFlip * innerAABBLength) / 2,
        outerCenter.x + (wFlip * innerAABBWidth) / 2,
        outerCenter.y + (hFlip * innerAABBHeight) / 2,
        outerCenter.z + (lFlip * innerAABBLength) / 2
    );

    return innerAABB;
}


export function getLookingVector (entity: {yaw: number, pitch: number}) {
    // given a yaw pitch, we need the looking vector

    // yaw is right handed rotation about y (up) starting from -z (north)
    // pitch is -90 looking down, 90 looking up, 0 looking at horizon
    // lets get its coordinate system.
    // let x' = -z (north)
    // let y' = -x (west)
    // let z' = y (up)

    // the non normalized looking vector in x', y', z' space is
    // x' is cos(yaw)
    // y' is sin(yaw)
    // z' is tan(pitch)

    // substituting back in x, y, z, we get the looking vector in the normal x, y, z space
    // -z = cos(yaw) => z = -cos(yaw)
    // -x = sin(yaw) => x = -sin(yaw)
    // y = tan(pitch)

    // normalizing the vectors, we divide each by |sqrt(x*x + y*y + z*z)|
    // x*x + z*z = sin^2 + cos^2 = 1
    // so |sqrt(xx+yy+zz)| = |sqrt(1+tan^2(pitch))|
    //     = |sqrt(1+sin^2(pitch)/cos^2(pitch))|
    //     = |sqrt((cos^2+sin^2)/cos^2(pitch))|
    //     = |sqrt(1/cos^2(pitch))|
    //     = |+/- 1/cos(pitch)|
    //     = 1/cos(pitch) since pitch in [-90, 90]

    // the looking vector is therefore
    // x = -sin(yaw) * cos(pitch)
    // y = tan(pitch) * cos(pitch) = sin(pitch)
    // z = -cos(yaw) * cos(pitch)

    const yaw = entity.yaw
    const pitch = entity.pitch
    const sinYaw = Math.sin(yaw)
    const cosYaw = Math.cos(yaw)
    const sinPitch = Math.sin(pitch)
    const cosPitch = Math.cos(pitch)
    const lookX = -sinYaw * cosPitch
    const lookY = sinPitch
    const lookZ = -cosYaw * cosPitch
    const lookDir = new Vec3(lookX, lookY, lookZ)
    return {
      yaw,
      pitch,
      sinYaw,
      cosYaw,
      sinPitch,
      cosPitch,
      lookX,
      lookY,
      lookZ,
      lookDir
    }
  }


/**
 * Converts an old PlayerState object into the new PlayerState class format.
 * * @param bot The current Mineflayer bot instance.
 * @param oldState The old PlayerState object to migrate.
 * @param ctx The IPhysics context required by the new PlayerState constructor.
 * @returns A newly formatted PlayerState instance.
 */
export function convertPlayerState(bot: Bot, oldState: any, ctx: IPhysics): PlayerState {
    // 1. Initialize the new state. 
    // This automatically runs update() and pulls the bot's current real state.
    const newState = new PlayerState(ctx, bot);

    // 2. Overwrite spatial and velocity data with the old simulated state
    if (oldState.pos) newState.pos.set(oldState.pos.x, oldState.pos.y, oldState.pos.z);
    if (oldState.vel) newState.vel.set(oldState.vel.x, oldState.vel.y, oldState.vel.z);

    // 3. Map collision and environment flags
    newState.onGround = oldState.onGround ?? newState.onGround;
    newState.isInWater = oldState.isInWater ?? newState.isInWater;
    newState.isInLava = oldState.isInLava ?? newState.isInLava;
    newState.isInWeb = oldState.isInWeb ?? newState.isInWeb;
    newState.isCollidedHorizontally = oldState.isCollidedHorizontally ?? newState.isCollidedHorizontally;
    newState.isCollidedVertically = oldState.isCollidedVertically ?? newState.isCollidedVertically;
    
    // 4. Map movement and action states
    newState.fallFlying = oldState.fallFlying ?? oldState.elytraFlying ?? newState.fallFlying;
    newState.validElytraEquipped = oldState.validElytraEquipped ?? oldState.elytraEquipped ?? newState.validElytraEquipped;
    newState.jumpTicks = oldState.jumpTicks ?? newState.jumpTicks;
    newState.jumpQueued = oldState.jumpQueued ?? newState.jumpQueued;
    newState.fireworkRocketDuration = oldState.fireworkRocketDuration ?? newState.fireworkRocketDuration;
    newState.yaw = oldState.yaw ?? newState.yaw;
    newState.pitch = oldState.pitch ?? newState.pitch;

    // 5. Map Control State
    // The old state uses a standard object for controls; the new uses ControlStateHandler.
    if (oldState.control) {
        // Create a fresh clone of the bot's current controls, then overwrite with simulated ones
        newState.control = ControlStateHandler.COPY_BOT(bot);
        Object.assign(newState.control, oldState.control);
    }

    // 6. Map Attributes, Effects, and Enchantments
    newState.attributes = oldState.attributes ?? newState.attributes;
    
    newState.jumpBoost = oldState.jumpBoost ?? newState.jumpBoost;
    newState.speed = oldState.speed ?? newState.speed;
    newState.slowness = oldState.slowness ?? newState.slowness;
    newState.dolphinsGrace = oldState.dolphinsGrace ?? newState.dolphinsGrace;
    newState.slowFalling = oldState.slowFalling ?? newState.slowFalling;
    newState.levitation = oldState.levitation ?? newState.levitation;
    
    newState.depthStrider = oldState.depthStrider ?? newState.depthStrider;

    return newState;
}

/**
 * Applies the values of the new PlayerState class back onto an old PlayerState object.
 * This updates the oldState in-place.
 * * @param newState The current, updated instance of the new PlayerState class.
 * @param oldState The old PlayerState object to be overwritten.
 */
export function applyToPlayerState(newState: PlayerState, oldState: any): void {
    // 1. Update Spatial and Velocity Data
    // Using .set() preserves the original Vec3 object reference in the old state.
    if (oldState.pos && newState.pos) {
        oldState.pos.set(newState.pos.x, newState.pos.y, newState.pos.z);
    }
    if (oldState.vel && newState.vel) {
        oldState.vel.set(newState.vel.x, newState.vel.y, newState.vel.z);
    }

    // 2. Map Environment & Collision Flags
    oldState.onGround = newState.onGround;
    oldState.isInWater = newState.isInWater;
    oldState.isInLava = newState.isInLava;
    oldState.isInWeb = newState.isInWeb;
    oldState.isCollidedHorizontally = newState.isCollidedHorizontally;
    oldState.isCollidedVertically = newState.isCollidedVertically;
    
    // 3. Map Movement & Actions
    oldState.fallFlying = newState.fallFlying;
    oldState.elytraFlying = newState.fallFlying;
    oldState.validElytraEquipped = newState.validElytraEquipped;
    oldState.elytraEquipped = newState.validElytraEquipped;
    oldState.jumpTicks = newState.jumpTicks;
    oldState.jumpQueued = newState.jumpQueued;
    oldState.fireworkRocketDuration = newState.fireworkRocketDuration;
    oldState.yaw = newState.yaw;
    oldState.pitch = newState.pitch;

    // 4. Downgrade Control State
    // Extracts standard booleans from the ControlStateHandler so the old state 
    // doesn't accidentally inherit class methods.
    if (newState.control) {
        oldState.control = {
            forward: newState.control.forward,
            back: newState.control.back,
            left: newState.control.left,
            right: newState.control.right,
            jump: newState.control.jump,
            sprint: newState.control.sprint,
            sneak: newState.control.sneak
        };
    }

    // 5. Map Attributes, Effects, and Enchantments
    oldState.attributes = newState.attributes;
    oldState.jumpBoost = newState.jumpBoost;
    oldState.speed = newState.speed;
    oldState.slowness = newState.slowness;
    oldState.dolphinsGrace = newState.dolphinsGrace;
    oldState.slowFalling = newState.slowFalling;
    oldState.levitation = newState.levitation;
    oldState.depthStrider = newState.depthStrider;
}
