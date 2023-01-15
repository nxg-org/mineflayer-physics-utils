import { Entity, EntityType } from "prismarine-entity";
import { EPhysicsCtx } from "../physics/settings";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import features from "../physics/info/features.json";
import md from "minecraft-data";

export function makeSupportFeature(mcData: md.IndexedData) {
    return (feature: string) => features.some(({ name, versions }) => name === feature && versions.includes(mcData.version.majorVersion!));
}

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
}

export enum CheapEnchantments {
    DEPTH_STRIDER,
}

export function isEntityUsingItem(entity: Entity): boolean {
    return ((entity.metadata[8] as any) & 1) > 0;
}

export function whichHandIsEntityUsing(entity: Entity): "hand" | "off-hand" {
    return ((entity.metadata[8] as any) & 2) > 0 ? "off-hand" : "hand";
}

export function whichHandIsEntityUsingBoolean(entity: Entity): boolean {
    return ((entity.metadata[8] as any) & 2) > 0; // true = offhand, false = hand
}

export function getStatusEffectNamesForVersion(supportFeature: ReturnType<typeof makeSupportFeature>) {
    if (supportFeature("effectNamesAreRegistryNames")) {
        // seems to not matter right now.
        return {
            jumpBoostEffectName: "JumpBoost",
            speedEffectName: "Speed",
            slownessEffectName: "Slowness",
            dolphinsGraceEffectName: "DolphinsGrace",
            slowFallingEffectName: "SlowFalling",
            levitationEffectName: "Levitation",
        };
    } else {
        return {
            jumpBoostEffectName: "JumpBoost",
            speedEffectName: "Speed",
            slownessEffectName: "Slowness",
            dolphinsGraceEffectName: "DolphinsGrace",
            slowFallingEffectName: "SlowFalling",
            levitationEffectName: "Levitation",
        };
    }
}

// lol. In case of expansion, yk.
export function getEnchantmentNamesForVersion(supportFeature: ReturnType<typeof makeSupportFeature>) {
    return {
        depthStriderEnchantmentName: "depth_strider",
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
