import { AABB } from "@nxg-org/mineflayer-util-plugin";
import md from "minecraft-data";
import { Bot } from "mineflayer";
import { Block } from "prismarine-block";
import { Entity } from "prismarine-entity";
import { promisify } from "util";
import { Vec3 } from "vec3";
import features from "../info/features.json";
import { PlayerState } from "../states/playerState";

export function makeSupportFeature(mcData: md.IndexedData) {
    return (feature: string) => features.some(({ name, versions }) => name === feature && versions.includes(mcData.version.majorVersion!));
}

export function load(
    StaticToEdit: { mcData: md.IndexedData; entityData: md.IndexedData["entitiesByName"]; mobData: md.IndexedData["mobs"] },
    data: md.IndexedData
) {
    StaticToEdit.mcData = data;
    StaticToEdit.entityData = data["entitiesByName"];
    StaticToEdit.mobData = data["mobs"];
}

export function MDEntityNamesToPrismarineEntities(mdEntities: md.IndexedData["entitiesByName"]) {
    const obj: { [mdEntityName: string]: Entity } = {};
    for (const key in mdEntities) {
        const mdEnt = mdEntities[key];
        obj[key] = new Entity(mdEnt.id);
    }

    return obj;
}

export enum CheapEffects {
    SPEED,
    JUMP_BOOST,
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
        return {
            jumpBoostEffectName: "jump_boost",
            speedEffectName: "speed",
            slownessEffectName: "slowness",
            dolphinsGraceEffectName: "dolphins_grace",
            slowFallingEffectName: "slow_falling",
            levitationEffectName: "levitation",
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
