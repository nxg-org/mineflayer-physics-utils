import { AABB, AABBUtils } from "@nxg-org/mineflayer-util-plugin";
import { PlayerPoses } from "../states/poses";
import { EntityState } from "../states/entityState";
import { IPhysics } from "../engines/IPhysics";
import { applyMdToNewEntity } from "../../util/physicsUtils";
import entityLoader, { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import md from "minecraft-data";

function getPose(entity: Entity) {
    const pose = entity.metadata.find((e) => (e as any).type === 18);
    return pose ? ((pose as any).value as number) : PlayerPoses.STANDING;
}

function load(data: md.IndexedData) {
    EPhysicsCtx.mcData = data;
    EPhysicsCtx.entityData = data["entitiesByName"];
    EPhysicsCtx.mobData = data["mobs"];
    EPhysicsCtx.entityConstructor = (entityLoader as any)(data.version.minecraftVersion);
}

export const emptyVec = new Vec3(0, 0, 0);

type PlayerPoseContext = { [key in PlayerPoses]: { width: number; height: number } };
type CollisionContext = { blockEffects: boolean; affectedAfterCollision: boolean };
export class EPhysicsCtx {
    public static loadData: (data: md.IndexedData) => void = load;
    public static entityConstructor: new (id: number) => Entity;
    public static mcData: md.IndexedData;
    public static entityData: md.IndexedData["entitiesByName"];
    public static mobData: md.IndexedData["mobs"];

    /**
     * From minecraft's Player.java file.
     */
    public static readonly playerPoseContext: PlayerPoseContext = {
        0: { width: 0.6, height: 1.8 },
        1: { width: 0.2, height: 0.2 },
        2: { width: 0.6, height: 0.6 },
        3: { width: 0.6, height: 0.6 },
        4: { width: 0.6, height: 0.6 },
        5: { width: 0.6, height: 0.6 },
        6: { width: 0.6, height: 1.5 },
        7: { width: 0.2, height: 0.2 },
    };

    public readonly position: Vec3;
    public readonly velocity: Vec3;

    public readonly stepHeight: number = 0;

    public readonly gravity: number = 0.0;
    public readonly waterGravity: number;
    public readonly lavaGravity: number;

    public readonly airdrag: number = Math.fround(1 - 0.0);
    public readonly gravityThenDrag: boolean = false;
    public readonly useControls: boolean = false;

    public readonly collisionBehavior: CollisionContext = {
        blockEffects: false,
        affectedAfterCollision: true,
    };

    constructor(public ctx: IPhysics, public pose: PlayerPoses, public readonly state: EntityState, public readonly entityType: md.Entity) {
        this.position = state.position;
        this.velocity = state.velocity;

        if (entityType.type === "player" || !!EPhysicsCtx.mobData[entityType.id]) {
            this.gravity = 0.08;
            this.airdrag = Math.fround(1 - 0.02);
            this.gravityThenDrag = true;
            this.useControls = true;
            this.stepHeight = entityType.type === "player" ? 0.6 : 1.0;
            this.collisionBehavior = {
                blockEffects: true,
                affectedAfterCollision: true,
            };
        }

        if (entityType.name?.includes("experience_bottle")) {
            this.gravity = 0.06;
            this.airdrag = Math.fround(1 - 0.01);
        }
        if (entityType.name?.includes("spit")) {
            this.gravity = 0.06;
            this.airdrag = Math.fround(1 - 0.01);
        }
        switch (entityType.type) {
            case "water_creature":
            case "animal":
            case "hostile":
            case "mob":
                this.gravity = 0.08;
                this.airdrag = Math.fround(1 - 0.02);
                this.gravityThenDrag = true;
                this.useControls = true;
                this.stepHeight = 1.0;
                this.collisionBehavior = {
                    blockEffects: true,
                    affectedAfterCollision: true,
                };
            case "projectile":
                this.gravity = 0.03;
                this.airdrag = Math.fround(1 - 0.01);
                this.collisionBehavior = {
                    blockEffects: false,
                    affectedAfterCollision: false,
                };
            case "orb":
                this.gravity = 0.03;
                this.airdrag = Math.fround(1 - 0.02);
                this.collisionBehavior = {
                    blockEffects: false,
                    affectedAfterCollision: true,
                };
            case "other":
                if (entityType.name?.includes("minecart")) {
                    this.gravity = 0.04;
                    this.airdrag = Math.fround(1 - 0.05);
                    this.collisionBehavior = {
                        blockEffects: false,
                        affectedAfterCollision: true,
                    };
                } else if (entityType.name?.includes("block") || entityType.name?.includes("tnt")) {
                    this.gravity = 0.04;
                    this.airdrag = Math.fround(1 - 0.02);
                    this.collisionBehavior = {
                        blockEffects: false,
                        affectedAfterCollision: true,
                    };
                } else if (entityType.name?.includes("boat")) {
                    this.gravity = 0.04;
                    this.airdrag = Math.fround(1 - 0);
                    this.collisionBehavior = {
                        blockEffects: false,
                        affectedAfterCollision: true,
                    };
                } else if (
                    entityType.name?.includes("egg") ||
                    entityType.name?.includes("snowball") ||
                    entityType.name?.includes("potion") ||
                    entityType.name?.includes("pearl")
                ) {
                    this.gravity = 0.03;
                    this.airdrag = Math.fround(1 - 0.01);
                    this.collisionBehavior = {
                        blockEffects: false,
                        affectedAfterCollision: false,
                    };
                } else if (entityType.name?.includes("orb")) {
                    this.gravity = 0.03;
                    this.airdrag = Math.fround(1 - 0.02);
                    this.collisionBehavior = {
                        blockEffects: false,
                        affectedAfterCollision: true,
                    };
                } else if (entityType.name?.includes("bobber")) {
                    this.gravity = 0.03;
                    this.airdrag = Math.fround(1 - 0.08);
                    this.collisionBehavior = {
                        blockEffects: false,
                        affectedAfterCollision: true,
                    };
                } else if (entityType.name?.includes("spit")) {
                    this.gravity = 0.06;
                    this.airdrag = Math.fround(1 - 0.01);
                    this.collisionBehavior = {
                        blockEffects: false,
                        affectedAfterCollision: true,
                    };
                } else if (entityType.name?.includes("arrow") || entityType.name?.includes("trident")) {
                    this.gravity = 0.05;
                    this.airdrag = Math.fround(1 - 0.01);
                    this.collisionBehavior = {
                        blockEffects: false,
                        affectedAfterCollision: false,
                    };
                } else if (entityType.name?.includes("fireball") || entityType.name?.includes("skull")) {
                    this.gravity = 0.0;
                    this.airdrag = Math.fround(1 - 0.05);
                    this.gravityThenDrag = true;
                    this.collisionBehavior = {
                        blockEffects: false,
                        affectedAfterCollision: false,
                    };
                }
        }

        if (ctx.supportFeature("independentLiquidGravity")) {
            this.waterGravity = 0.02;
            this.lavaGravity = 0.02;
        } else if (ctx.supportFeature("proportionalLiquidGravity")) {
            this.waterGravity = this.gravity / 16;
            this.lavaGravity = this.gravity / 4;
        } else {
            this.waterGravity = 0.005;
            this.lavaGravity = 0.02;
        }
    }

    public static FROM_ENTITY(ctx: IPhysics, entity: Entity) {
        return new EPhysicsCtx(ctx, getPose(entity), EntityState.CREATE_FROM_ENTITY(ctx, entity), EPhysicsCtx.entityData[entity.name!]);
    }

    public static FROM_ENTITY_TYPE(ctx: IPhysics, entityType: md.Entity, options: Partial<Entity> = {}) {
        const newE = applyMdToNewEntity(EPhysicsCtx, entityType, options);
        return new EPhysicsCtx(ctx, PlayerPoses.STANDING, EntityState.CREATE_FROM_ENTITY(ctx, newE), entityType);
    }

    public static FROM_ENTITY_STATE(ctx: IPhysics, entityState: EntityState, entityType: md.Entity) {
        return new EPhysicsCtx(ctx, entityState.pose, entityState, entityType);
    }

    public clone() {
        return new EPhysicsCtx(this.ctx, this.state.pose, this.state.clone(), this.entityType);
    }

    public get height(): number {
        if (this.entityType.type === "player") {
            return EPhysicsCtx.playerPoseContext[this.pose].height;
        }
        return this.entityType.height ?? 0;
    }

    public get width(): number {
        if (this.entityType.type === "player") {
            return EPhysicsCtx.playerPoseContext[this.pose].width;
        }
        return this.entityType.width ?? 0;
    }

    public getHalfWidth(): number {
        return this.width / 2;
    }

    public getCurrentBBWithPose(): AABB {
        const halfWidth = this.getHalfWidth();
        return new AABB(
            this.position.x - halfWidth,
            this.position.y,
            this.position.z - halfWidth,
            this.position.x + halfWidth,
            this.position.y + this.height,
            this.position.z + halfWidth
        );
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
        const halfWidth = this.entityType.width ? this.entityType.width / 2 : 0;
        return new AABB(
            position.x - halfWidth,
            position.y,
            position.z - halfWidth,
            position.x + halfWidth,
            position.y + (this.entityType.height ?? 0),
            position.z + halfWidth
        );
    }
}
