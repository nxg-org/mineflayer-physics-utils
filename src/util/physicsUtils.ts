import { Entity, EntityType } from "prismarine-entity";
import { EPhysicsCtx } from "../physics/settings";
import { AABB } from "@nxg-org/mineflayer-util-plugin";
import features from "../physics/info/features.json";
import md from "minecraft-data";
import { EntityState, IEntityState } from "../physics/states";
import { Vec3 } from "vec3";

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
    SWIFT_SNEAK
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
        swiftSneakEnchantmentName: "swift_sneak"
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