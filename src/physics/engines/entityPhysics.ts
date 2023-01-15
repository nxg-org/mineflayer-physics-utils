import { Vec3 } from "vec3";
import { AABB, AABBUtils } from "@nxg-org/mineflayer-util-plugin";
import md, { Effects, Enchantments } from "minecraft-data";
import * as math from "../info/math";
import * as attributes from "../info/attributes";
import * as features from "../info/features.json";
import loader, { Effect, Entity } from "prismarine-entity";
import { Bot, Enchantment } from "mineflayer";
import { Block } from "prismarine-block";
import { NormalizedEnchant } from "prismarine-item";
import {
    CheapEffects,
    CheapEnchantments,
    getEnchantmentNamesForVersion,
    getStatusEffectNamesForVersion,
    makeSupportFeature,
} from "../../util/physicsUtils";
import { PlayerState } from "../states/playerState";
import { EntityState } from "../states/entityState";
import { IPhysics, MobsByName } from "./IPhysics";
import { PhysicsSettings } from "../settings/physicsSettings";
import { EPhysicsCtx } from "../settings/entityPhysicsCtx";

type CheapEffectNames = keyof ReturnType<typeof getStatusEffectNamesForVersion>;
type CheapEnchantmentNames = keyof ReturnType<typeof getEnchantmentNamesForVersion>;

/**
 * Looking at this code, it's too specified towards players.
 *
 * I will eventually split this code into PlayerState and bot.entityState, where bot.entityState contains fewer controls.
 */

export class EntityPhysics implements IPhysics {
    public data: md.IndexedData;
    public movementSpeedAttribute: any;
    public supportFeature: ReturnType<typeof makeSupportFeature>;
    public blockSlipperiness: { [name: string]: number };

    protected slimeBlockId: number;
    protected soulsandId: number;
    protected honeyblockId: number;
    protected webId: number;
    protected waterId: number;
    protected lavaId: number;
    protected ladderId: number;
    protected vineId: number;
    protected bubblecolumnId: number;
    protected waterLike: Set<number>;

    public readonly statusEffectNames: { [type in CheapEffects]: string };
    public readonly enchantmentNames: { [type in CheapEnchantments]: string };

    constructor(mcData: md.IndexedData) {
        this.data = mcData;
        const blocksByName = mcData.blocksByName;
        this.supportFeature = makeSupportFeature(mcData);
        this.movementSpeedAttribute = (this.data.attributesByName.movementSpeed as any).resource;

        this.blockSlipperiness = {};
        this.slimeBlockId = blocksByName.slime_block ? blocksByName.slime_block.id : blocksByName.slime.id;
        this.blockSlipperiness[this.slimeBlockId] = 0.8;
        this.blockSlipperiness[blocksByName.ice.id] = 0.98;
        this.blockSlipperiness[blocksByName.packed_ice.id] = 0.98;

        // 1.9+
        if (blocksByName.frosted_ice) this.blockSlipperiness[blocksByName.frosted_ice.id] = 0.98;

        // 1.13+
        if (blocksByName.blue_ice) this.blockSlipperiness[blocksByName.blue_ice.id] = 0.989;

        this.soulsandId = blocksByName.soul_sand.id;
        this.honeyblockId = blocksByName.honey_block ? blocksByName.honey_block.id : -1; // 1.15+
        this.webId = blocksByName.cobweb ? blocksByName.cobweb.id : blocksByName.web.id;
        this.waterId = blocksByName.water.id;
        this.lavaId = blocksByName.lava.id;
        this.ladderId = blocksByName.ladder.id;
        this.vineId = blocksByName.vine.id;
        this.waterLike = new Set();
        if (blocksByName.seagrass) this.waterLike.add(blocksByName.seagrass.id); // 1.13+
        if (blocksByName.tall_seagrass) this.waterLike.add(blocksByName.tall_seagrass.id); // 1.13+
        if (blocksByName.kelp) this.waterLike.add(blocksByName.kelp.id); // 1.13+
        this.bubblecolumnId = blocksByName.bubble_column ? blocksByName.bubble_column.id : -1; // 1.13+
        if (blocksByName.bubble_column) this.waterLike.add(this.bubblecolumnId);

        this.statusEffectNames = {} as any; // mmm, speed.
        this.enchantmentNames = {} as any; //mmm, double speed.

        let ind = 0;
        const tmp = getStatusEffectNamesForVersion(this.supportFeature);
        for (const key in tmp) {
            this.statusEffectNames[ind as CheapEffects] = tmp[key as CheapEffectNames];
            ind++;
        }
        Object.freeze(this.statusEffectNames);
        ind = 0;
        const tmp1 = getEnchantmentNamesForVersion(this.supportFeature);
        for (const key in tmp1) {
            this.enchantmentNames[ind as CheapEnchantments] = tmp1[key as CheapEnchantmentNames];
        }
        Object.freeze(this.enchantmentNames);
    }

    getEntityBB(entity: EPhysicsCtx, pos: { x: number; y: number; z: number }): AABB {
        const w = entity.getHalfWidth();
        return new AABB(-w, 0, -w, w, entity.height, w).offset(pos.x, pos.y, pos.z);
    }

    setPositionToBB(entity: EPhysicsCtx, bb: AABB, pos: { x: number; y: number; z: number }) {
        const halfWidth = entity.getHalfWidth();
        pos.x = bb.minX + halfWidth;
        pos.y = bb.minY;
        pos.z = bb.minZ + halfWidth;
    }

    shouldMoveEntity(entity: EPhysicsCtx) {
        return !(
            (entity.state.isCollidedHorizontally || entity.state.isCollidedVertically) &&
            !entity.collisionBehavior.affectedAfterCollision
        );
    }

    getUnderlyingBlockBBs(queryBB: AABB, world: any /*prismarine-world*/): AABB[] {
        const surroundingBBs = [];
        const cursor = new Vec3(0, Math.floor(queryBB.minY) - 0.251, 0);
        for (cursor.z = Math.floor(queryBB.minZ); cursor.z <= Math.floor(queryBB.maxZ); cursor.z++) {
            for (cursor.x = Math.floor(queryBB.minX); cursor.x <= Math.floor(queryBB.maxX); cursor.x++) {
                const block = world.getBlock(cursor);
                if (block) {
                    const blockPos = block.position;
                    for (const shape of block.shapes) {
                        const blockBB = new AABB(shape[0], shape[1], shape[2], shape[3], shape[4], shape[5]);
                        blockBB.offset(blockPos.x, blockPos.y, blockPos.z);
                        surroundingBBs.push(blockBB);
                    }
                }
            }
        }
        return surroundingBBs;
    }

    getSurroundingBBs(queryBB: AABB, world: any /*prismarine-world*/): AABB[] {
        const surroundingBBs = [];
        const cursor = new Vec3(0, 0, 0);
        for (cursor.y = Math.floor(queryBB.minY) - 1; cursor.y <= Math.floor(queryBB.maxY); cursor.y++) {
            for (cursor.z = Math.floor(queryBB.minZ); cursor.z <= Math.floor(queryBB.maxZ); cursor.z++) {
                for (cursor.x = Math.floor(queryBB.minX); cursor.x <= Math.floor(queryBB.maxX); cursor.x++) {
                    const block = world.getBlock(cursor);
                    if (block) {
                        const blockPos = block.position;
                        for (const shape of block.shapes) {
                            const blockBB = new AABB(shape[0], shape[1], shape[2], shape[3], shape[4], shape[5]);
                            blockBB.offset(blockPos.x, blockPos.y, blockPos.z);
                            surroundingBBs.push(blockBB);
                        }
                    }
                }
            }
        }
        return surroundingBBs;
    }

    adjustPositionHeight(entity: EPhysicsCtx, pos: Vec3, world: any /*prismarine-world*/) {
        const playerBB = this.getEntityBB(entity, pos);
        const queryBB = playerBB.clone().extend(0, -1, 0);
        const surroundingBBs = this.getSurroundingBBs(queryBB, world);

        let dy = -1;
        for (const blockBB of surroundingBBs) {
            dy = blockBB.computeOffsetY(playerBB, dy);
        }
        pos.y += dy;
    }

    moveEntity(entity: EPhysicsCtx, dx: number, dy: number, dz: number, world: any /*prismarine-world*/) {
        if (!this.shouldMoveEntity(entity)) {
            entity.velocity.set(0, 0, 0);
            return;
        }
        const vel = entity.velocity;
        const pos = entity.position;

        if (entity.state.isInWeb && !entity.entityType?.name.includes("arrow")) {
            dx *= 0.25;
            dy *= 0.05;
            dz *= 0.25;
            vel.x = 0;
            vel.y = 0;
            vel.z = 0;
            entity.state.isInWeb = false;
        }

        const oldOldVelX = dx;
        let oldVelX = dx;
        const oldVelY = dy;
        let oldVelZ = dz;
        const oldOldVelZ = dz;

        if (entity.useControls && entity.state.controlState.sneak && entity.state.onGround) {
            const step = 0.05;

            // In the 3 loops bellow, y offset should be -1, but that doesnt reproduce vanilla behavior.
            for (; dx !== 0 && this.getSurroundingBBs(this.getEntityBB(entity, pos).offset(dx, 0, 0), world).length === 0; oldVelX = dx) {
                if (dx < step && dx >= -step) dx = 0;
                else if (dx > 0) dx -= step;
                else dx += step;
            }

            for (; dz !== 0 && this.getSurroundingBBs(this.getEntityBB(entity, pos).offset(0, 0, dz), world).length === 0; oldVelZ = dz) {
                if (dz < step && dz >= -step) dz = 0;
                else if (dz > 0) dz -= step;
                else dz += step;
            }

            while (dx !== 0 && dz !== 0 && this.getSurroundingBBs(this.getEntityBB(entity, pos).offset(dx, 0, dz), world).length === 0) {
                if (dx < step && dx >= -step) dx = 0;
                else if (dx > 0) dx -= step;
                else dx += step;

                if (dz < step && dz >= -step) dz = 0;
                else if (dz > 0) dz -= step;
                else dz += step;

                oldVelX = dx;
                oldVelZ = dz;
            }
        }

        let playerBB = this.getEntityBB(entity, pos);
        const queryBB = playerBB.clone().extend(dx, dy, dz);
        const surroundingBBs = this.getSurroundingBBs(queryBB, world);
        const oldBB = playerBB.clone();

        for (const blockBB of surroundingBBs) {
            dy = blockBB.computeOffsetY(playerBB, dy);
        }
        playerBB.offset(0, dy, 0);

        for (const blockBB of surroundingBBs) {
            dx = blockBB.computeOffsetX(playerBB, dx);
        }
        playerBB.offset(dx, 0, 0);

        for (const blockBB of surroundingBBs) {
            dz = blockBB.computeOffsetZ(playerBB, dz);
        }
        playerBB.offset(0, 0, dz);

        // Step on block if height < stepHeight
        if (entity.stepHeight > 0 && (entity.state.onGround || (dy !== oldVelY && oldVelY < 0)) && (dx !== oldVelX || dz !== oldVelZ)) {
            const oldVelXCol = dx;
            const oldVelYCol = dy;
            const oldVelZCol = dz;
            const oldBBCol = playerBB.clone();

            dy = entity.stepHeight;
            const queryBB = oldBB.clone().extend(oldVelX, dy, oldVelZ);
            const surroundingBBs = this.getSurroundingBBs(queryBB, world);

            const BB1 = oldBB.clone();
            const BB2 = oldBB.clone();
            const BB_XZ = BB1.clone().extend(dx, 0, dz);

            let dy1 = dy;
            let dy2 = dy;
            for (const blockBB of surroundingBBs) {
                dy1 = blockBB.computeOffsetY(BB_XZ, dy1);
                dy2 = blockBB.computeOffsetY(BB2, dy2);
            }
            BB1.offset(0, dy1, 0);
            BB2.offset(0, dy2, 0);

            let dx1 = oldVelX;
            let dx2 = oldVelX;
            for (const blockBB of surroundingBBs) {
                dx1 = blockBB.computeOffsetX(BB1, dx1);
                dx2 = blockBB.computeOffsetX(BB2, dx2);
            }
            BB1.offset(dx1, 0, 0);
            BB2.offset(dx2, 0, 0);

            let dz1 = oldVelZ;
            let dz2 = oldVelZ;
            for (const blockBB of surroundingBBs) {
                dz1 = blockBB.computeOffsetZ(BB1, dz1);
                dz2 = blockBB.computeOffsetZ(BB2, dz2);
            }
            BB1.offset(0, 0, dz1);
            BB2.offset(0, 0, dz2);

            const norm1 = dx1 * dx1 + dz1 * dz1;
            const norm2 = dx2 * dx2 + dz2 * dz2;

            if (norm1 > norm2) {
                dx = dx1;
                dy = -dy1;
                dz = dz1;
                playerBB = BB1;
            } else {
                dx = dx2;
                dy = -dy2;
                dz = dz2;
                playerBB = BB2;
            }

            for (const blockBB of surroundingBBs) {
                dy = blockBB.computeOffsetY(playerBB, dy);
            }
            playerBB.offset(0, dy, 0);

            if (oldVelXCol * oldVelXCol + oldVelZCol * oldVelZCol >= dx * dx + dz * dz) {
                dx = oldVelXCol;
                dy = oldVelYCol;
                dz = oldVelZCol;
                playerBB = oldBBCol;
            }
        }

        // Update flags
        this.setPositionToBB(entity, playerBB, pos);
        entity.state.sneakCollision = dx !== oldOldVelX || dz !== oldOldVelZ;
        entity.state.isCollidedHorizontally = dx !== oldVelX || dz !== oldVelZ;
        entity.state.isCollidedVertically = dy !== oldVelY;
        entity.state.onGround = entity.state.isCollidedVertically && oldVelY < 0;

        const blockAtFeet = world.getBlock(pos.offset(0, -0.2, 0));

        if (dx !== oldVelX) vel.x = 0;
        if (dz !== oldVelZ) vel.z = 0;
        if (dy !== oldVelY) {
            if (
                entity.collisionBehavior.blockEffects &&
                blockAtFeet &&
                blockAtFeet.type === this.slimeBlockId &&
                !entity.state.controlState.sneak
            ) {
                vel.y = -vel.y;
            } else {
                vel.y = 0;
            }
        }

        // Finally, apply block collisions (web, soulsand...)
        playerBB.contract(0.001, 0.001, 0.001);
        const cursor = new Vec3(0, 0, 0);
        for (cursor.y = Math.floor(playerBB.minY); cursor.y <= Math.floor(playerBB.maxY); cursor.y++) {
            for (cursor.z = Math.floor(playerBB.minZ); cursor.z <= Math.floor(playerBB.maxZ); cursor.z++) {
                for (cursor.x = Math.floor(playerBB.minX); cursor.x <= Math.floor(playerBB.maxX); cursor.x++) {
                    const block = world.getBlock(cursor);
                    if (block) {
                        if (entity.collisionBehavior.blockEffects && this.supportFeature("velocityBlocksOnCollision")) {
                            if (block.type === this.soulsandId) {
                                vel.x *= PhysicsSettings.soulsandSpeed;
                                vel.z *= PhysicsSettings.soulsandSpeed;
                            } else if (block.type === this.honeyblockId) {
                                vel.x *= PhysicsSettings.honeyblockSpeed;
                                vel.z *= PhysicsSettings.honeyblockSpeed;
                            }
                        }
                        if (block.type === this.webId) {
                            entity.state.isInWeb = true;
                        }

                        // no blockEffects check here, apparently all entities are affected by this.
                        else if (block.type === this.bubblecolumnId) {
                            const down = !block.metadata;
                            const aboveBlock = world.getBlock(cursor.offset(0, 1, 0));
                            const bubbleDrag =
                                aboveBlock && aboveBlock.type === 0 /* air */
                                    ? PhysicsSettings.bubbleColumnSurfaceDrag
                                    : PhysicsSettings.bubbleColumnDrag;
                            if (down) {
                                vel.y = Math.max(bubbleDrag.maxDown, vel.y - bubbleDrag.down);
                            } else {
                                vel.y = Math.min(bubbleDrag.maxUp, vel.y + bubbleDrag.up);
                            }
                        }
                    }
                }
            }
        }
        if (entity.collisionBehavior.blockEffects && this.supportFeature("velocityBlocksOnTop")) {
            const blockBelow = world.getBlock(entity.position.floored().offset(0, -0.5, 0));
            if (blockBelow) {
                if (blockBelow.type === this.soulsandId) {
                    vel.x *= PhysicsSettings.soulsandSpeed;
                    vel.z *= PhysicsSettings.soulsandSpeed;
                } else if (blockBelow.type === this.honeyblockId) {
                    vel.x *= PhysicsSettings.honeyblockSpeed;
                    vel.z *= PhysicsSettings.honeyblockSpeed;
                }
            }
        }
    }

    applyHeading(entity: EPhysicsCtx, strafe: number, forward: number, multiplier: number) {
        if (!this.shouldMoveEntity(entity)) {
            entity.velocity.set(0, 0, 0);
            return;
        }
        let speed = Math.sqrt(strafe * strafe + forward * forward);
        if (speed < 0.01) return;

        speed = multiplier / Math.max(speed, 1);

        strafe *= speed;
        forward *= speed;

        const yaw = Math.PI - entity.state.yaw;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);

        const vel = entity.velocity;
        vel.x += strafe * cos - forward * sin;
        vel.z += forward * cos + strafe * sin;
    }

    getEffectLevelCustom(wantedEffect: CheapEffects, effects: Effect[]) {
        const effectDescriptor = this.data.effectsByName[this.statusEffectNames[wantedEffect]];
        if (!effectDescriptor) {
            return 0;
        }
        const effectInfo = effects[effectDescriptor.id];
        if (!effectInfo) {
            return 0;
        }
        return effectInfo.amplifier + 1;
    }

    getEnchantmentLevelCustom(wantedEnchantment: CheapEnchantments, enchantments: any[]) {
        const enchantmentName = this.enchantmentNames[wantedEnchantment];
        const enchantmentDescriptor = this.data.enchantmentsByName[enchantmentName];
        if (!enchantmentDescriptor) {
            return 0;
        }

        for (const enchInfo of enchantments) {
            if (typeof enchInfo.id === "string") {
                if (enchInfo.id.includes(enchantmentName)) {
                    return enchInfo.lvl;
                }
            } else if (enchInfo.id === enchantmentDescriptor.id) {
                return enchInfo.lvl;
            }
        }
        return 0;
    }

    isOnLadder(pos: { x: number; y: number; z: number }, world: any /*prismarine-world*/) {
        const block = world.getBlock(pos);
        return block && (block.type === this.ladderId || block.type === this.vineId);
    }

    doesNotCollide(entity: EPhysicsCtx, pos: { x: number; y: number; z: number }, world: any /*prismarine-world*/) {
        const pBB = this.getEntityBB(entity, pos);
        return !this.getSurroundingBBs(pBB, world).some((x) => pBB.intersects(x)) && this.getWaterInBB(pBB, world).length === 0;
    }

    isMaterialInBB(queryBB: AABB, type: number, world: any /*prismarine-world*/) {
        const cursor = new Vec3(0, 0, 0);
        for (cursor.y = Math.floor(queryBB.minY); cursor.y <= Math.floor(queryBB.maxY); cursor.y++) {
            for (cursor.z = Math.floor(queryBB.minZ); cursor.z <= Math.floor(queryBB.maxZ); cursor.z++) {
                for (cursor.x = Math.floor(queryBB.minX); cursor.x <= Math.floor(queryBB.maxX); cursor.x++) {
                    const block = world.getBlock(cursor);
                    if (block && block.type === type) return true;
                }
            }
        }
        return false;
    }

    getWaterInBB(bb: AABB, world: any /*prismarine-world*/) {
        const waterBlocks = [];
        const cursor = new Vec3(0, 0, 0);
        for (cursor.y = Math.floor(bb.minY); cursor.y <= Math.floor(bb.maxY); cursor.y++) {
            for (cursor.z = Math.floor(bb.minZ); cursor.z <= Math.floor(bb.maxZ); cursor.z++) {
                for (cursor.x = Math.floor(bb.minX); cursor.x <= Math.floor(bb.maxX); cursor.x++) {
                    const block = world.getBlock(cursor);
                    if (block && (block.type === this.waterId || this.waterLike.has(block.type) || block.getProperties().waterlogged)) {
                        const waterLevel = cursor.y + 1 - this.getLiquidHeightPcent(block);
                        if (Math.ceil(bb.maxY) >= waterLevel) waterBlocks.push(block);
                    }
                }
            }
        }
        return waterBlocks;
    }

    getLiquidHeightPcent(block: Block) {
        return (this.getRenderedDepth(block) + 1) / 9;
    }

    getRenderedDepth(block: Block) {
        if (!block) return -1;
        if (this.waterLike.has(block.type)) return 0;
        if (block.getProperties().waterlogged) return 0;
        if (block.type !== this.waterId) return -1;
        const meta = block.metadata;
        return meta >= 8 ? 0 : meta;
    }

    getFlow(block: Block, world: any /*prismarine-world*/) {
        const curlevel = this.getRenderedDepth(block);
        const flow = new Vec3(0, 0, 0);
        for (const [dx, dz] of [
            [0, 1],
            [-1, 0],
            [0, -1],
            [1, 0],
        ]) {
            const adjBlock = world.getBlock(block.position.offset(dx, 0, dz));
            const adjLevel = this.getRenderedDepth(adjBlock);
            if (adjLevel < 0) {
                if (adjBlock && adjBlock.boundingBox !== "empty") {
                    const adjLevel = this.getRenderedDepth(world.getBlock(block.position.offset(dx, -1, dz)));
                    if (adjLevel >= 0) {
                        const f = adjLevel - (curlevel - 8);
                        flow.x += dx * f;
                        flow.z += dz * f;
                    }
                }
            } else {
                const f = adjLevel - curlevel;
                flow.x += dx * f;
                flow.z += dz * f;
            }
        }

        if (block.metadata >= 8) {
            for (const [dx, dz] of [
                [0, 1],
                [-1, 0],
                [0, -1],
                [1, 0],
            ]) {
                const adjBlock = world.getBlock(block.position.offset(dx, 0, dz));
                const adjUpBlock = world.getBlock(block.position.offset(dx, 1, dz));
                if ((adjBlock && adjBlock.boundingBox !== "empty") || (adjUpBlock && adjUpBlock.boundingBox !== "empty")) {
                    flow.normalize().translate(0, -6, 0);
                }
            }
        }

        return flow.normalize();
    }

    isInWaterApplyCurrent(bb: AABB, vel: { x: number; y: number; z: number }, world: any /*prismarine-world*/) {
        const acceleration = new Vec3(0, 0, 0);
        const waterBlocks = this.getWaterInBB(bb, world);
        const isInWater = waterBlocks.length > 0;
        for (const block of waterBlocks) {
            const flow = this.getFlow(block, world);
            acceleration.add(flow);
        }

        const len = acceleration.norm();
        if (len > 0) {
            vel.x += (acceleration.x / len) * 0.014;
            vel.y += (acceleration.y / len) * 0.014;
            vel.z += (acceleration.z / len) * 0.014;
        }
        return isInWater;
    }

    moveEntityWithHeading(entity: EPhysicsCtx, strafe: number, forward: number, world: any /*prismarine-world*/) {
        if (!this.shouldMoveEntity(entity)) {
            entity.velocity.set(0, 0, 0);
            return;
        }
        const vel = entity.velocity;
        const pos = entity.position;

        const gravityMultiplier = vel.y <= 0 && entity.state.slowFalling > 0 ? PhysicsSettings.slowFalling : 1;

        // Unsure how to handle this w/ other entities.
        if (!entity.state.isInWater && !entity.state.isInLava) {
            let acceleration = entity.airborneAccel;
            let inertia = entity.airborneInertia;
            const blockUnder = world.getBlock(pos.offset(0, -1, 0));
            if (entity.state.onGround && blockUnder) {
                let playerSpeedAttribute;
                if (entity.state.attributes && entity.state.attributes[this.movementSpeedAttribute]) {
                    // Use server-side player attributes
                    playerSpeedAttribute = entity.state.attributes[this.movementSpeedAttribute];
                } else {
                    // Create an attribute if the player does not have it
                    //TODO: Generalize to all entities.
                    playerSpeedAttribute = attributes.createAttributeValue(PhysicsSettings.playerSpeed);
                }
                // Client-side sprinting (don't rely on server-side sprinting)
                // setSprinting in LivingEntity.java
                //TODO: Generalize to all entities.
                playerSpeedAttribute = attributes.deleteAttributeModifier(playerSpeedAttribute, PhysicsSettings.sprintingUUID); // always delete sprinting (if it exists)
                if (entity.state.controlState.sprint) {
                    if (!attributes.checkAttributeModifier(playerSpeedAttribute, PhysicsSettings.sprintingUUID)) {
                        playerSpeedAttribute = attributes.addAttributeModifier(playerSpeedAttribute, {
                            uuid: PhysicsSettings.sprintingUUID,
                            amount: PhysicsSettings.sprintSpeed,
                            operation: 2,
                        });
                    }
                }
                // Calculate what the speed is (0.1 if no modification)
                const attributeSpeed = attributes.getAttributeValue(playerSpeedAttribute);
                inertia = (this.blockSlipperiness[blockUnder.type] || PhysicsSettings.defaultSlipperiness) * 0.91;
                acceleration = attributeSpeed * (0.1627714 / (inertia * inertia * inertia));
                if (acceleration < 0) acceleration = 0; // acceleration should not be negative
            }

            this.applyHeading(entity, strafe, forward, acceleration);

            if (entity.collisionBehavior.blockEffects && this.isOnLadder(pos, world)) {
                vel.x = math.clamp(-PhysicsSettings.ladderMaxSpeed, vel.x, PhysicsSettings.ladderMaxSpeed);
                vel.z = math.clamp(-PhysicsSettings.ladderMaxSpeed, vel.z, PhysicsSettings.ladderMaxSpeed);
                vel.y = Math.max(vel.y, entity.state.controlState.sneak ? 0 : -PhysicsSettings.ladderMaxSpeed);
            }

            this.moveEntity(entity, vel.x, vel.y, vel.z, world);

            if (
                entity.collisionBehavior.blockEffects &&
                this.isOnLadder(pos, world) &&
                (entity.state.isCollidedHorizontally || (this.supportFeature("climbUsingJump") && entity.state.controlState.jump))
            ) {
                vel.y = PhysicsSettings.ladderClimbSpeed; // climb ladder
            }

            // Not adding an additional function call. No point.
            if (entity.gravityThenDrag) {
                // Apply gravity, then air drag.
                if (entity.state.levitation > 0) vel.y += (0.05 * entity.state.levitation - vel.y) * 0.2;
                else vel.y -= entity.gravity * gravityMultiplier;
                vel.y *= entity.airdrag;
            } else {
                // Apply airdrag, then gravity.
                vel.y *= entity.airdrag;
                if (entity.state.levitation > 0) vel.y += (0.05 * entity.state.levitation - vel.y) * 0.2;
                else vel.y -= entity.gravity * gravityMultiplier;
            }

            vel.x *= inertia;
            vel.z *= inertia;
        } else {
            // Water / Lava movement
            const lastY = pos.y;
            let acceleration = entity.liquidAccel;
            const inertia = entity.state.isInWater ? entity.waterInertia : entity.lavaInertia;
            let horizontalInertia = inertia;

            if (entity.state.isInWater) {
                let strider = Math.min(entity.state.depthStrider, 3);
                if (!entity.state.onGround) {
                    strider *= 0.5;
                }
                if (strider > 0) {
                    horizontalInertia += ((0.546 - horizontalInertia) * strider) / 3;
                    acceleration += ((0.7 - acceleration) * strider) / 3;
                }

                if (entity.state.dolphinsGrace > 0) horizontalInertia = 0.96;
            }

            this.applyHeading(entity, strafe, forward, acceleration);
            this.moveEntity(entity, vel.x, vel.y, vel.z, world);
            if (entity.gravityThenDrag) {
                vel.y -= (entity.state.isInWater ? entity.waterGravity : entity.lavaGravity) * gravityMultiplier;
                vel.y *= inertia;
            } else {
                vel.y *= inertia;
                vel.y -= (entity.state.isInWater ? entity.waterGravity : entity.lavaGravity) * gravityMultiplier;
            }
            vel.x *= horizontalInertia;
            vel.z *= horizontalInertia;

            if (
                entity.state.isCollidedHorizontally &&
                this.doesNotCollide(entity, pos.offset(vel.x, vel.y + 0.6 - pos.y + lastY, vel.z), world)
            ) {
                vel.y = PhysicsSettings.outOfLiquidImpulse; // jump out of liquid
            }
        }
    }

    simulate(entity: EPhysicsCtx, world: any /*prismarine-world*/): EntityState {
        if (!this.shouldMoveEntity(entity)) {
            entity.velocity.set(0, 0, 0);
            return entity.state;
        }

        const vel = entity.velocity;
        const pos = entity.position;

        const waterBB = this.getEntityBB(entity, pos).contract(0.001, 0.401, 0.001);
        const lavaBB = this.getEntityBB(entity, pos).contract(0.1, 0.4, 0.1);

        // assume that if we shouldn't move entity, isInWater and isInLava are already properly set.

        entity.state.isInWater = this.isInWaterApplyCurrent(waterBB, vel, world);
        entity.state.isInLava = this.isMaterialInBB(lavaBB, this.lavaId, world);

        // Reset velocity component if it falls under the threshold
        if (Math.abs(vel.x) < PhysicsSettings.negligeableVelocity) vel.x = 0;
        if (Math.abs(vel.y) < PhysicsSettings.negligeableVelocity) vel.y = 0;
        if (Math.abs(vel.z) < PhysicsSettings.negligeableVelocity) vel.z = 0;

        let strafe = 0;
        let forward = 0;
        // Handle inputs
        if (entity.useControls) {
            if (entity.state.controlState.jump || entity.state.jumpQueued) {
                if (entity.state.jumpTicks > 0) entity.state.jumpTicks--;
                if (entity.state.isInWater || entity.state.isInLava) {
                    vel.y += Math.fround(0.4);
                } else if (entity.state.onGround && entity.state.jumpTicks === 0) {
                    const blockBelow = world.getBlock(entity.position.floored().offset(0, -0.5, 0));
                    vel.y =
                        Math.fround(0.42) * (blockBelow && blockBelow.type === this.honeyblockId ? PhysicsSettings.honeyblockJumpSpeed : 1);
                    if (entity.state.jumpBoost > 0) {
                        vel.y += 0.1 * entity.state.jumpBoost;
                    }
                    if (entity.state.controlState.sprint) {
                        const yaw = Math.PI - entity.state.yaw;
                        vel.x -= Math.sin(yaw) * 0.2;
                        vel.z += Math.cos(yaw) * 0.2;
                    }
                    entity.state.jumpTicks = PhysicsSettings.autojumpCooldown;
                }
            } else {
                entity.state.jumpTicks = 0; // reset autojump cooldown
            }
            entity.state.jumpQueued = false;

            strafe =
                ((entity.state.controlState.right as unknown as number) - (entity.state.controlState.left as unknown as number)) * 0.98;
            forward =
                ((entity.state.controlState.forward as unknown as number) - (entity.state.controlState.back as unknown as number)) * 0.98;

            if (entity.state.controlState.sneak) {
                strafe *= PhysicsSettings.sneakSpeed;
                forward *= PhysicsSettings.sneakSpeed;
                entity.state.controlState.sprint = false;
            }

            if (entity.state.isUsingItem) {
                strafe *= PhysicsSettings.usingItemSpeed;
                forward *= PhysicsSettings.usingItemSpeed;
                entity.state.controlState.sprint = false;
            }
        }

        this.moveEntityWithHeading(entity, strafe, forward, world);

        return entity.state;
    }
}
