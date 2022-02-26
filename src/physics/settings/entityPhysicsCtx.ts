import { AABB, AABBUtils } from "@nxg-org/mineflayer-util-plugin";
import { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import { PlayerPoses, PlayerPosesByNumber } from "../states/poses";
import md from "minecraft-data";
import { EntityState } from "../states/entityState";
import { IPhysics } from "../engines/IPhysics";

function getPose(entity: Entity) {
    const pose = entity.metadata.find((e) => (e as any).type === 18);
    return pose ? ((pose as any).value as number) : PlayerPoses.STANDING;
}

export const emptyVec = new Vec3(0, 0, 0);

type PlayerPoseContext = {[key in PlayerPoses]: {width: number, height: number}}
export class EntityPhysicsContext {
    public static mcData: md.IndexedData;
    public static readonly entityData = EntityPhysicsContext.mcData["entitiesByName"];
    public static readonly mobData = EntityPhysicsContext.mcData["mobs"];

    public static readonly playerPoseContext = 
    {
       0: {width: 0.6, height: 1.8},
       1: {width: 0.2, height: 0.2},
       2: {width: 0.6, height: 0.6},
       3: {width: 0.6, height: 0.6},
       4: {width: 0.6, height: 0.6},
       5: {width: 0.6, height: 0.6},
       6: {width: 0.6, height: 1.5},
       7: {width: 0.2, height: 0.2},
    }
  
    constructor(
        public pose: PlayerPoses,
        public readonly entityType: md.Entity,
        public readonly position: Vec3,
        public readonly velocity: Vec3,
        public readonly useControls: boolean,
    ) {

        
    }

    public static FROM_ENTITY(entity: Entity) {
        return new EntityPhysicsContext(
            getPose(entity),
            EntityPhysicsContext.entityData[entity.name!], //unsafe.
            entity.position,
            entity.velocity,
            entity.type === "player" || entity.type === "mob",
        );
    }

    public static FROM_ENTITY_TYPE(entityType: md.Entity) {
        const isMob = !!EntityPhysicsContext.mobData[entityType.id];
        return new EntityPhysicsContext(
            PlayerPoses.STANDING,
            entityType,
            emptyVec.clone(),
            emptyVec.clone(),
            entityType.type === "player" || isMob,
        );
    }

    public get height(): number {
        if (this.entityType.type === "player") {
            return EntityPhysicsContext.playerPoseContext[this.pose].height;
        }
        return this.entityType.height ?? 0;
    }

    public get width(): number {
        if (this.entityType.type === "player") {
            return EntityPhysicsContext.playerPoseContext[this.pose].width;
        }
        return this.entityType.width ?? 0;
    }

    public getHalfWidth(): number {
        return this.width / 2;
    }
    
    public getBBWithPose(position: { x: number; y: number; z: number }): AABB {
        const halfWidth = this.getHalfWidth();
        return new AABB(
            position.x - halfWidth,
            position.y,
            position.z - halfWidth,
            position.x + halfWidth,
            position.y + this.height,
            position.z + halfWidth
        );
    }

    public getBB(position: { x: number; y: number; z: number }): AABB {
        const halfWidth = this.entityType.width ? this.entityType.width / 2 : 0 ;
        return new AABB(
            position.x - halfWidth,
            position.y,
            position.z - halfWidth,
            position.x + halfWidth,
            position.y + (this.entityType.height ?? 0),
            position.z + halfWidth,
        );
    }
}
