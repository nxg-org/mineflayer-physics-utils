import { AABB, AABBUtils } from "@nxg-org/mineflayer-util-plugin";
import md from "minecraft-data";
import { Block } from "prismarine-block";
import { Effect } from "prismarine-entity";
import { Vec3 } from "vec3";
import {
  CheapEffects,
  CheapEnchantments,
  getEnchantmentNamesForVersion,
  getStatusEffectNamesForVersion,
  makeSupportFeature,
  getLookingVector,
} from "../../util/physicsUtils";
import * as math from "../info/math";
import * as attributes from "../info/attributes";
import { EPhysicsCtx } from "../settings/entityPhysicsCtx";
import { EntityState, IEntityState } from "../states";
import { IPhysics } from "./IPhysics";
import { PlayerPoses, PlayerState, convInpToAxes, getCollider } from "../states";
import { PhysicsWorldSettings } from "../settings";
import { computePistonPush } from "../../subsystems/piston-push";

import type { world } from "prismarine-world"

type CheapEffectNames = keyof ReturnType<typeof getStatusEffectNamesForVersion>;
type CheapEnchantmentNames = keyof ReturnType<typeof getEnchantmentNamesForVersion>;

type Heading = { forward: number; strafe: number };
type World = { getBlock: world.WorldSync["getBlock"]};

type CollisionCtx = { entityY: number; descending: boolean; fallDistance: number; walkOnPowderSnow: boolean };


function extractAttribute(ctx: IPhysics, genericName: string) {
  const data = ctx.data.attributesByName[genericName] as any;
  if (data == null) return null;
  if (ctx.supportFeature("attributesPrefixedByMinecraft")) {
    return `minecraft:${data.resource}`;
  } else {
    return data.resource;
  }
}

function computeModifiedFriction(friction: number, modifier: number): number {
  const v = 1 - (1 - friction) * modifier;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Looking at this code, it's too specified towards players.
 *
 * I will eventually split this code into PlayerState and bot.entityState, where bot.entityState contains fewer controls.
 */

export class BotcraftPhysics implements IPhysics {
  public data: md.IndexedData;
  public movementSpeedAttribute: string;
  public jumpStrengthAttribute: string;
  public movementEfficiencyAttribute: string;
  public waterMovementEfficiencyAttribute: string;
  public sneakingSpeedAttribute: string;
  public stepHeightAttribute: string;
  public gravityAttribute: string;
  public frictionModifierAttribute: string;
  public airDragModifierAttribute: string;
  public bouncinessAttribute: string;
  public scaleAttribute: string;
  public supportFeature: ReturnType<typeof makeSupportFeature>;
  public blockSlipperiness: { [name: string]: number };

  protected bedIds: Set<number>;
  protected slimeBlockId: number;
  protected soulsandId: number;
  protected berryBushId: number;
  protected powderSnowId: number;
  protected honeyblockId: number;
  protected webId: number;
  protected waterId: number;
  protected lavaId: number;
  protected ladderId: number;
  protected vineId: number;
  protected scaffoldId: number;
  protected climbableSet: Set<number>;
  protected canGlideThroughSet: Set<number>;
  protected bubblecolumnId: number;
  protected potentSulfurId: number;
  protected waterLike: Set<number>;

  public readonly statusEffectNames: { [type in CheapEffects]: string };
  public readonly enchantmentNames: { [type in CheapEnchantments]: string };

  constructor(mcData: md.IndexedData) {
    this.data = mcData;
    const blocksByName = mcData.blocksByName;
    this.supportFeature = makeSupportFeature(mcData);
    this.movementSpeedAttribute = extractAttribute(this, "movementSpeed");
    this.movementEfficiencyAttribute = extractAttribute(this, "movementEfficiency");
    this.jumpStrengthAttribute = extractAttribute(this, "jumpStrength");
    this.waterMovementEfficiencyAttribute = extractAttribute(this, "waterMovementEfficiency");
    this.sneakingSpeedAttribute = extractAttribute(this, "sneakingSpeed");
    this.stepHeightAttribute = extractAttribute(this, "stepHeight");
    this.gravityAttribute = extractAttribute(this, "gravity");
    this.frictionModifierAttribute = extractAttribute(this, "frictionModifier");
    this.airDragModifierAttribute = extractAttribute(this, "airDragModifier");
    this.bouncinessAttribute = extractAttribute(this, "bounciness");
    this.scaleAttribute = extractAttribute(this, "scale");

    this.blockSlipperiness = {};
    this.slimeBlockId = blocksByName.slime_block ? blocksByName.slime_block.id : blocksByName.slime.id;
    this.blockSlipperiness[this.slimeBlockId] = 0.8;
    this.blockSlipperiness[blocksByName.ice.id] = 0.98;
    this.blockSlipperiness[blocksByName.packed_ice.id] = 0.98;

    // 1.9+
    if (blocksByName.frosted_ice) this.blockSlipperiness[blocksByName.frosted_ice.id] = 0.98;

    // 1.13+
    if (blocksByName.blue_ice) this.blockSlipperiness[blocksByName.blue_ice.id] = 0.989;

    const bedColors = [
      "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
      "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
    ];
    this.bedIds = new Set<number>();
    for (const color of bedColors) {
      const b = blocksByName[`${color}_bed`];
      if (b) this.bedIds.add(b.id);
    }
    if (blocksByName.bed) this.bedIds.add(blocksByName.bed.id); // legacy pre-1.13 single bed block
    this.soulsandId = blocksByName.soul_sand.id;
    this.scaffoldId = blocksByName.scaffolding?.id ?? -1; // 1.14+
    this.berryBushId = blocksByName.sweet_berry_bush?.id ?? -1; // 1.14+
    this.powderSnowId = blocksByName.powder_snow?.id ?? -1;
    this.honeyblockId = blocksByName.honey_block ? blocksByName.honey_block.id : -1; // 1.15+
    this.webId = blocksByName.cobweb ? blocksByName.cobweb.id : blocksByName.web.id;
    this.waterId = blocksByName.water.id;
    this.lavaId = blocksByName.lava.id;
    this.ladderId = blocksByName.ladder.id;
    this.vineId = blocksByName.vine.id;
    this.climbableSet = new Set<number>();
    for (const n of [
      "ladder", "vine", "scaffolding",
      "weeping_vines", "weeping_vines_plant",
      "twisting_vines", "twisting_vines_plant",
      "cave_vines", "cave_vines_plant",
    ]) {
      const b = blocksByName[n];
      if (b) this.climbableSet.add(b.id);
    }
    this.canGlideThroughSet = new Set<number>();
    for (const n of [
      "vine",
      "twisting_vines", "twisting_vines_plant",
      "weeping_vines", "weeping_vines_plant",
      "cave_vines", "cave_vines_plant",
    ]) {
      const b = blocksByName[n];
      if (b) this.canGlideThroughSet.add(b.id);
    }
    this.waterLike = new Set();
    if (blocksByName.seagrass) this.waterLike.add(blocksByName.seagrass.id); // 1.13+
    if (blocksByName.tall_seagrass) this.waterLike.add(blocksByName.tall_seagrass.id); // 1.13+
    if (blocksByName.kelp) this.waterLike.add(blocksByName.kelp.id); // 1.13+
    if (blocksByName.kelp_plant) this.waterLike.add(blocksByName.kelp_plant.id); // 1.13+
    this.bubblecolumnId = blocksByName.bubble_column ? blocksByName.bubble_column.id : -1; // 1.13+
    if (blocksByName.bubble_column) this.waterLike.add(this.bubblecolumnId);
    this.potentSulfurId = blocksByName.potent_sulfur ? blocksByName.potent_sulfur.id : -1;

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
    return new AABB(-w, 0, -w, w, entity.height, w).translate(pos.x, pos.y, pos.z);
  }

  setPositionToBB(entity: EPhysicsCtx, bb: AABB, pos: { x: number; y: number; z: number }) {
    const halfWidth = entity.getHalfWidth();
    pos.x = bb.minX + halfWidth;
    pos.y = bb.minY;
    pos.z = bb.minZ + halfWidth;
  }

  getSurroundingBBs(queryBB: AABB, world: World, underlying = true, collisionCtx?: CollisionCtx): AABB[] {
    const surroundingBBs = [];
    const cursor = new Vec3(0, 0, 0);
    for (cursor.y = Math.floor(queryBB.minY) - Number(underlying); cursor.y <= Math.floor(queryBB.maxY); ++cursor.y) {
      for (cursor.z = Math.floor(queryBB.minZ); cursor.z <= Math.floor(queryBB.maxZ); ++cursor.z) {
        for (cursor.x = Math.floor(queryBB.minX); cursor.x <= Math.floor(queryBB.maxX); ++cursor.x) {
          const block = world.getBlock(cursor) as Block | null;
          if (block != null) {
            const blockPos = block.position;
            const shapes =
              collisionCtx !== undefined && block.type === this.scaffoldId
                ? this.scaffoldingCollisionShapes(block, collisionCtx.entityY, collisionCtx.descending)
                : collisionCtx !== undefined && block.type === this.powderSnowId
                ? this.powderSnowCollisionShapes(block, collisionCtx)
                : block.shapes;
            for (const shape of shapes) {
              const blockBB = new AABB(shape[0], shape[1], shape[2], shape[3], shape[4], shape[5]);
              blockBB.translate(blockPos.x, blockPos.y, blockPos.z);
              surroundingBBs.push(blockBB);
            }
          }
        }
      }
    }
    return surroundingBBs;
  }

  private scaffoldingCollisionShapes(block: Block, entityY: number, descending: boolean): number[][] {
    const y = block.position.y;
    if (entityY > y + 1 - 1e-5 && !descending) return block.shapes;
    const props = block.getProperties() as { distance?: unknown; bottom?: unknown };
    const distance = Number(props.distance); // prismarine-block yields the int property as a string
    const bottom = props.bottom === true || props.bottom === "true";
    if (distance !== 0 && bottom && entityY > y - 1e-5) {
      return [[0, 0, 0, 1, 0.125, 1]];
    }
    return [];
  }

  private powderSnowCollisionShapes(block: Block, ctx: CollisionCtx): number[][] {
    const y = block.position.y;
    if (ctx.fallDistance > 2.5) return [[0, 0, 0, 1, 0.8999999761581421, 1]];
    if (ctx.walkOnPowderSnow && ctx.entityY > y + 1 - 1e-5 && !ctx.descending) return [[0, 0, 0, 1, 1, 1]];
    return [];
  }

  getWaterInBBs(bb: AABB, world: World) {
    const bbs = [];
    const cursor = new Vec3(0, 0, 0);
    for (cursor.y = Math.floor(bb.minY); cursor.y <= Math.floor(bb.maxY); cursor.y++) {
      for (cursor.z = Math.floor(bb.minZ); cursor.z <= Math.floor(bb.maxZ); cursor.z++) {
        for (cursor.x = Math.floor(bb.minX); cursor.x <= Math.floor(bb.maxX); cursor.x++) {
          const block = world.getBlock(cursor);
          if (block && (block.type === this.waterId || this.waterLike.has(block.type) || block.getProperties().waterlogged)) {
            // Presence-based: do not gate on a computed fluid height here.
            bbs.push(new AABB(cursor.x, cursor.y, cursor.z, cursor.x + 1, cursor.y + 1, cursor.z + 1));
          }
        }
      }
    }
    return bbs;
  }

  getEffectLevel(wantedEffect: CheapEffects, effects: Effect[]) {
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

  getEnchantmentLevel(wantedEnchantment: CheapEnchantments, enchantments: any[]) {
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

  private verGreaterThan(ver: string) {
    return this.data.version[">"](ver);
  }

  private verLessThan(ver: string) {
    return this.data.version["<"](ver);
  }

  private worldIsFree(world: World, bb: AABB, ignoreLiquid: boolean) {
    const bbs = ignoreLiquid ? this.getSurroundingBBs(bb, world, false) : [...this.getSurroundingBBs(bb, world, false), ...this.getWaterInBBs(bb, world)];

    // now we have to actually check for collisions.
    for (const blockBB of bbs) {
      if (blockBB.intersects(bb)) {
        const blockAt = world.getBlock(blockBB.minPoint())!;
        // console.log('world not free due to block: ', blockAt.name, blockAt.position)
        return false;
      }
    }
    return true;
  }

  private suffocatesAt(player: PlayerState, world: World, blockX: number, blockZ: number): boolean {
    const bb = player.getBB();
    const testArea = new AABB(blockX, bb.minY, blockZ, blockX + 1, bb.maxY, blockZ + 1).expand(-1e-7, -1e-7, -1e-7);
    const cursor = new Vec3(0, 0, 0);
    for (cursor.y = Math.floor(testArea.minY); cursor.y <= Math.floor(testArea.maxY); ++cursor.y) {
      for (cursor.z = Math.floor(testArea.minZ); cursor.z <= Math.floor(testArea.maxZ); ++cursor.z) {
        for (cursor.x = Math.floor(testArea.minX); cursor.x <= Math.floor(testArea.maxX); ++cursor.x) {
          const block = world.getBlock(cursor) as Block | null;
          if (block == null || block.boundingBox === "empty" || !block.shapes || block.shapes.length !== 1) continue;
          const s = block.shapes[0];
          if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 1 && s[4] === 1 && s[5] === 1) {
            const blockBB = new AABB(s[0], s[1], s[2], s[3], s[4], s[5]).translate(cursor.x, cursor.y, cursor.z);
            if (blockBB.intersects(testArea)) return true;
          }
        }
      }
    }
    return false;
  }

  private moveTowardsClosestSpace(player: PlayerState, world: World, x: number, z: number) {
    const blockX = Math.floor(x);
    const blockZ = Math.floor(z);
    if (!this.suffocatesAt(player, world, blockX, blockZ)) return;

    const xd = x - blockX;
    const zd = z - blockZ;
    let closest = Number.MAX_VALUE;
    let dirAxisX = false;
    let dirStep = 0;
    let hasDir = false;

    if (xd < closest && !this.suffocatesAt(player, world, blockX - 1, blockZ)) {
      closest = xd;
      dirAxisX = true;
      dirStep = -1;
      hasDir = true;
    }
    if (1.0 - xd < closest && !this.suffocatesAt(player, world, blockX + 1, blockZ)) {
      closest = 1.0 - xd;
      dirAxisX = true;
      dirStep = 1;
      hasDir = true;
    }
    if (zd < closest && !this.suffocatesAt(player, world, blockX, blockZ - 1)) {
      closest = zd;
      dirAxisX = false;
      dirStep = -1;
      hasDir = true;
    }
    if (1.0 - zd < closest && !this.suffocatesAt(player, world, blockX, blockZ + 1)) {
      closest = 1.0 - zd;
      dirAxisX = false;
      dirStep = 1;
      hasDir = true;
    }

    if (hasDir) {
      if (dirAxisX) {
        player.vel.x = 0.1 * dirStep;
      } else {
        player.vel.z = 0.1 * dirStep;
      }
    }
  }

  private pushEntities(player: PlayerState) {
    const boxes = player.pushableEntities;
    if (boxes == null || boxes.length === 0) return;
    if (player.gameMode === "spectator" || player.onClimbable || player.isPassenger) return;

    const playerBox = player.getBB();
    const px = player.pos.x;
    const pz = player.pos.z;
    for (const box of boxes) {
      if (!playerBox.intersects(box)) continue;
      const ex = (box.minX + box.maxX) / 2;
      const ez = (box.minZ + box.maxZ) / 2;
      let dx = px - ex;
      let dz = pz - ez;
      let d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d >= Math.fround(0.01)) {
        d = Math.sqrt(d);
        dx /= d;
        dz /= d;
        let pow = 1.0 / d;
        if (pow > 1.0) pow = 1.0;
        dx *= pow;
        dz *= pow;
        dx *= Math.fround(0.05);
        dz *= Math.fround(0.05);
        player.vel.x += dx;
        player.vel.z += dz;
      }
    }
  }

  private pushByPistons(player: PlayerState, world: World) {
    const events = player.pistonEvents;
    if (events == null || events.length === 0) return;
    for (const ev of events) {
      const bb = player.getBB();
      const r = computePistonPush(ev, {
        box: { minX: bb.minX, minY: bb.minY, minZ: bb.minZ, maxX: bb.maxX, maxY: bb.maxY, maxZ: bb.maxZ },
        x: player.pos.x,
        z: player.pos.z,
        onGround: player.onGround,
        supportingBlockPos: player.supportingBlockPos,
      });
      if (r.velSetAxis === 0) player.vel.x = r.velSetValue;
      else if (r.velSetAxis === 1) player.vel.y = r.velSetValue;
      else if (r.velSetAxis === 2) player.vel.z = r.velSetValue;
      if (r.pushDelta) {
        const disp = this.collideBoundingBox(world, player.getBB(), new Vec3(r.pushDelta.x, r.pushDelta.y, r.pushDelta.z));
        player.pos.x += disp.x;
        player.pos.y += disp.y;
        player.pos.z += disp.z;
      }
      if (r.stuckDelta) {
        const disp = this.collideBoundingBox(world, player.getBB(), new Vec3(r.stuckDelta.x, r.stuckDelta.y, r.stuckDelta.z));
        player.pos.x += disp.x;
        player.pos.y += disp.y;
        player.pos.z += disp.z;
      }
    }
  }

  /**
   * 1:1 copy of the original physicsTick function from botcraft
   * https://github.com/adepierre/Botcraft/blob/6c572071b0237c27a85211a246ce10565ef4d80f/botcraft/src/Game/Physics/PhysicsManager.cpp#L277
   *
   *
   * @param ctx
   * @param world
   */
  private physicsTick(ctx: EPhysicsCtx, world: World) {
    // Check for rocket boosting if currently in elytra flying mode
    const entity = ctx.state;

    // if (ctx.state.elytraFlying) {
    //   // TODO: entity check for fireworks
    //   // TODO: check if firework is attached to player
    //   if (false) {
    //     // player->speed += player->front_vector * 0.1 + (player->front_vector * 1.5 - player->speed) * 0.5;
    //   }
    // }

    // for now, only check if this is a player.

    const playerFlag = ctx.entityType.type === "player";

    if (playerFlag) {
      this.pushByPistons(ctx.state as PlayerState, world);
    }

    this.fluidPhysics(ctx, world, true);
    this.fluidPhysics(ctx, world, false);

    // updateSwimming moved into AiStep.

    // separation into a new function
    // originally: https://github.com/adepierre/Botcraft/blob/6c572071b0237c27a85211a246ce10565ef4d80f/botcraft/src/Game/Physics/PhysicsManager.cpp#L325
    if (playerFlag) {
      this.localPlayerAIStep(ctx, world);
    }
  }

  /**
   * Assume later than 1.13.2 before calling this function.
   * @param player
   * @param world
   */
  private updatePoses(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    const swimPose = getCollider(PlayerPoses.SWIMMING, player.pos, player.scale).expand(-1e-7, -1e-7, -1e-7);
    // ignoreLiquid=true: liquids must not block the pose-fit check, or crouching would never register underwater.
    if (this.worldIsFree(world, swimPose, true)) {
      // update poses
      let currentPose: PlayerPoses;
      // Pose priority: SLEEPING > SWIMMING > FALL_FLYING > SPIN_ATTACK > CROUCHING > STANDING.
      if (player.pose === PlayerPoses.SLEEPING) {
        currentPose = PlayerPoses.SLEEPING;
      } else if (this.isSwimmingAndNotFlying(ctx, world)) {
        currentPose = PlayerPoses.SWIMMING;
      }
      // player->GetDataSharedFlagsIdImpl(EntitySharedFlagsId::FallFlying)
      else if (player.fallFlying) {
        currentPose = PlayerPoses.FALL_FLYING;
      }
      else if (player.autoSpinAttackTicks > 0) {
        currentPose = PlayerPoses.SPIN_ATTACK;
      } else if (player.control.sneak && !player.flying) {
        currentPose = PlayerPoses.SNEAKING;
      } else {
        currentPose = PlayerPoses.STANDING;
      }

      const poseBB = getCollider(currentPose, player.pos, player.scale).expand(-1e-7, -1e-7, -1e-7);
      if (player.gameMode === "spectator" || this.worldIsFree(world, poseBB, true)) {
        player.pose = currentPose;
      } else {
        const crouchBB = getCollider(PlayerPoses.SNEAKING, player.pos, player.scale).expand(-1e-7, -1e-7, -1e-7);
        if (this.worldIsFree(world, crouchBB, true)) {
          player.pose = PlayerPoses.SNEAKING;
        } else {
          player.pose = PlayerPoses.SWIMMING;
        }
      }
    }
  }

  private fluidPhysics(ctx: EPhysicsCtx, world: World, water: boolean) {
    const player = ctx.state as PlayerState;
    const aabb = getCollider(player.pose, player.pos, player.scale).expand(-1e-3, -1e-3, -1e-3); // -0.001
    if (water) {
      player.isInWater = false;
      player.isUnderWater = false;
    } else {
      player.isInLava = false;
      player.isUnderLava = false;
    }

    const minAABB = aabb.minPoint();
    const maxAABB = aabb.maxPoint();
    const eyeHeight = player.eyeHeight + player.pos.y;

    const waterCond = (block: Block) => block.type === this.waterId || this.waterLike.has(block.type) || block.getProperties().waterlogged;
    const lavaCond = (block: Block) => block.type === this.lavaId;

    const push = new Vec3(0, 0, 0);
    const blockPos = new Vec3(0, 0, 0);
    let fluidRelativeHeight = 0.0;
    let numPush = 0;
    let eyeInFluidThisTick = false;
    for (blockPos.x = Math.floor(minAABB.x); blockPos.x <= Math.floor(maxAABB.x); ++blockPos.x) {
      for (blockPos.y = Math.floor(minAABB.y); blockPos.y <= Math.floor(maxAABB.y); ++blockPos.y) {
        for (blockPos.z = Math.floor(minAABB.z); blockPos.z <= Math.floor(maxAABB.z); ++blockPos.z) {
          const block = world.getBlock(blockPos);
          if (block == null) continue;

          const waterRes = waterCond(block);
          const lavaRes = lavaCond(block);
          if ((waterRes && !water) || (lavaRes && water) || (!waterRes && !lavaRes)) {
            continue;
          }

          let fluidHeight = 0.0;
          const blockAbv = world.getBlock(blockPos.offset(0, 1, 0));
          if ((blockAbv != null && waterCond(blockAbv) && waterRes) || (blockAbv != null && lavaCond(blockAbv) && lavaRes)) {
            fluidHeight = 1.0;
          } else {
            fluidHeight = this.getLiquidHeightPcent(block, water);
          }

          if (fluidHeight + blockPos.y < minAABB.y) {
            continue;
          }

          if (water) {
            player.isInWater = true;
          } else {
            player.isInLava = true;
          }
          if (fluidHeight + blockPos.y > eyeHeight) {
            eyeInFluidThisTick = true;
          }

          fluidRelativeHeight = Math.max(fluidHeight + blockPos.y - minAABB.y, fluidRelativeHeight);

          if (player.flying) continue;

          const currentPush = this.getFlow(block, world, water);
          if (fluidRelativeHeight < 0.4) {
            currentPush.scale(fluidRelativeHeight);
          }
          push.add(currentPush);
          numPush++;
        }
      }
    }

    if (water) {
      player.isUnderWater = player.wasEyeInWater && player.isInWater;
      player.wasEyeInWater = eyeInFluidThisTick;
    } else {
      player.isUnderLava = eyeInFluidThisTick;
    }

    if (water) {
      player.waterHeight = fluidRelativeHeight;
    } else {
      player.lavaHeight = fluidRelativeHeight;
    }

    const pushLenSqr = push.x * push.x + push.y * push.y + push.z * push.z;
    if (numPush === 0 || pushLenSqr < 1.0e-5) {
      return;
    }

    // Player path: average by currentCount (non-players normalize instead).
    push.scale(1.0 / numPush);
    if (water) {
      push.scale(0.014);
    } else {
      const worldInUltraWarm = false; // TODO: implement this (bot world relevance)
      push.scale(worldInUltraWarm ? 0.007 : 0.0023333333333333335);
    }

    const pushNorm = push.norm();
    if (
      Math.abs(player.vel.x) < ctx.worldSettings.negligeableVelocity &&
      Math.abs(player.vel.z) < ctx.worldSettings.negligeableVelocity &&
      pushNorm < 0.0045000000000000005
    ) {
      // normalize and scale
      push.normalize().scale(0.0045000000000000005);
    }
    player.vel.add(push);
  }

  getFlow(block: Block, world: World, water: boolean) {
    const thisOwnHeight = this.getLiquidHeightPcent(block, water); // amount/9
    const flow = new Vec3(0, 0, 0);
    for (const [dx, dz] of [
      [0, 1],
      [-1, 0],
      [0, -1],
      [1, 0],
    ]) {
      const adjBlock = world.getBlock(block.position.offset(dx, 0, dz));
      const adjLevel = this.getRenderedDepth(adjBlock, water);
      let distance = 0.0;
      if (adjLevel < 0) {
        // A neighbour that isn't this fluid contributes nothing if solid; approximate !blocksMotion()
        // via boundingBox === "empty".
        if (adjBlock && adjBlock.boundingBox === "empty") {
          const belowBlock = world.getBlock(block.position.offset(dx, -1, dz));
          const belowLevel = this.getRenderedDepth(belowBlock, water);
          if (belowLevel >= 0) {
            const belowOwnHeight = this.getLiquidHeightPcent(belowBlock, water);
            if (belowOwnHeight > 0.0) {
              distance = thisOwnHeight - (belowOwnHeight - 0.8888889);
            }
          }
        }
      } else {
        const adjOwnHeight = this.getLiquidHeightPcent(adjBlock, water);
        distance = thisOwnHeight - adjOwnHeight;
      }
      if (distance !== 0.0) {
        flow.x += dx * distance;
        flow.z += dz * distance;
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
          // normalize() mutates flow in place, so this bias is applied before breaking out.
          flow.normalize().translate(0, -6, 0);
          break;
        }
      }
    }

    return flow.normalize();
  }

  getLiquidHeightPcent(block: Block, water: boolean) {
    return 1 - (this.getRenderedDepth(block, water) + 1) / 9;
  }

  getRenderedDepth(block: Block, water: boolean) {
    if (!block) return -1;
    if (water) {
      if (this.waterLike.has(block.type)) return 0;
      if (block.getProperties().waterlogged) return 0;
      if (block.type !== this.waterId) return -1;
    } else {
      if (block.type !== this.lavaId) return -1;
    }
    const meta = block.metadata;
    return meta >= 8 ? 0 : meta;
  }

  private updateSwimming(player: PlayerState, world: World) {
    if (player.flying) {
      player.swimming = false;
    } else if (player.swimming) {
      player.swimming = player.sprinting && player.isInWater;
    } else {
      const block = world.getBlock(player.pos);
      player.swimming =
        player.sprinting &&
        player.isUnderWater &&
        block != null &&
        !!(block.type === this.waterId || this.waterLike.has(block.type) || block.getProperties().waterlogged);
    }
  }

  private isMovingSlowly(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    if (this.verGreaterThan("1.13.2")) {
      const visuallyCrawling =
        player.pose === PlayerPoses.SWIMMING &&
        !player.isInWater;
      return player.crouching || visuallyCrawling;
    }

    return player.crouching;
  }

  private localPlayerAIStep(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    const tickStartedOnGround = player.onGround;
    const heading = convInpToAxes(player);
    player.heading = heading;

    this.tryRiptide(ctx, world);

    // moved into AiStep since it's tied to player behavior. Strictly, is Player::updateSwimming.
    this.updateSwimming(player, world);

    this.inputsToCrouch(ctx, heading, world);

    if (this.verGreaterThan("1.13.2") && player.gameMode !== "spectator") {
      const bb = player.getBB();
      const w = bb.maxX - bb.minX;
      this.moveTowardsClosestSpace(player, world, player.pos.x - w * 0.35, player.pos.z + w * 0.35);
      this.moveTowardsClosestSpace(player, world, player.pos.x - w * 0.35, player.pos.z - w * 0.35);
      this.moveTowardsClosestSpace(player, world, player.pos.x + w * 0.35, player.pos.z - w * 0.35);
      this.moveTowardsClosestSpace(player, world, player.pos.x + w * 0.35, player.pos.z + w * 0.35);
    }

    this.inputsToSprint(ctx, heading, world);
    this.inputsToFly(ctx, heading, world);

    // If sneaking in water, add downward speed
    if (player.isInWater && player.control.sneak && !player.flying) {
      player.vel.y -= 0.03999999910593033;
    }

    if (player.flying) {
      player.vel.y +=
        (-1 * (player.control.sneak as unknown as number) + (player.control.jump as unknown as number)) * player.flySpeed * 3.0;
    }

    // player::AiStep
    {
      player.flyJumpTriggerTime = Math.max(0, player.flyJumpTriggerTime - 1);
    }

    // livingEntity::AiStep
    {
      player.jumpTicks = Math.max(0, player.jumpTicks - 1);
      // 1.21.11+: horizontal dead-zone is a COMBINED check (x/z zeroed together when
      // horizontalDistanceSqr < negligeableVelocity^2); Y stays per-axis. Pre-1.21.11 uses
      // independent x/z snapping.
      const negVel = ctx.worldSettings.negligeableVelocity;
      if (!this.verLessThan("1.21.11")) {
        if (player.vel.x * player.vel.x + player.vel.z * player.vel.z < negVel * negVel) {
          player.vel.x = 0;
          player.vel.z = 0;
        }
      } else {
        if (Math.abs(player.vel.x) < negVel) {
          player.vel.x = 0;
        }
        if (Math.abs(player.vel.z) < negVel) {
          player.vel.z = 0;
        }
      }
      if (Math.abs(player.vel.y) < negVel) {
        player.vel.y = 0;
      }

      this.inputsToJump(player, world, ctx.worldSettings);

      // TODO: properly implement heading handler. forward-axis is forward, left-axis = strafe. weird naming.
      heading.forward *= 0.98;
      heading.strafe *= 0.98;
      // player->inputs.forward_axis *= 0.98f;
      // player->inputs.left_axis *= 0.98f;

      // Compensate water downward speed depending on looking direction (?)

      if (this.isSwimmingAndNotFlying(ctx, world)) {
        const mSinPitch = Math.sin(player.pitch);
        let condition = mSinPitch <= 0.0 || player.control.jump;
        if (!condition) {
          // check above block
          const bl1 = world.getBlock(new Vec3(player.pos.x, player.pos.y + 1.0 - 0.1, player.pos.z));
          condition = bl1 != null && (this.waterId === bl1.type || this.waterLike.has(bl1.type))
        }
        if (condition) {
          // console.log('changing vel by',  (mSinPitch - player.vel.y) * (mSinPitch < -0.2 ? 0.085 : 0.06));
          player.vel.y += (mSinPitch - player.vel.y) * (mSinPitch < -0.2 ? 0.085 : 0.06);
        }
      }


      // Must run unconditionally before movement; gating it to fall-flying only causes a velocity blowup.
      if (this.verGreaterThan("1.13.2")) {
        this.updatePoses(ctx, world);
      }

      const velY = player.vel.y;
      this.movePlayer(ctx, world); // TODO: should be in player-specific logic??
      if (player.flying) {
        player.vel.y = 0.6 * velY;
        /* player->SetDataSharedFlagsIdImpl(EntitySharedFlagsId::FallFlying, false); */ player.fallFlying = false;
      }

      player.onClimbable = this.isInClimbable(player, world);

      if (player.autoSpinAttackTicks > 0) {
        player.autoSpinAttackTicks--;
        if (player.isCollidedHorizontally) {
          player.autoSpinAttackTicks = 0;
        }
      }

      if (this.verGreaterThan("1.8.9")) {
        this.pushEntities(player);
      }
    } // !livingplayer::AiStep

    if (player.onGround && player.flying && player.gameMode !== "spectator") {
      player.flying = false;
      // onUpdateAbilities();
    }

    // Gen: pretty sure mobs can't spawn or exist outside world borders. this should be fine in here.
    player.pos.x = math.clamp(-2.9999999e7, player.pos.x, 2.9999999e7);
    player.pos.z = math.clamp(-2.9999999e7, player.pos.z, 2.9999999e7);

    if (this.verGreaterThan("1.13.2")) {
      this.updatePoses(ctx, world);
    }

    // Preserve the current inputs for the next tick after all previous-state
    // consumers in this tick have already read the prior values.
    player.lastOnGround = player.onGround;
    player.prevHeading.forward = heading.forward;
    player.prevHeading.strafe = heading.strafe;
    player.prevControl.jump = player.control.jump;
    player.prevControl.sneak = player.control.sneak;

  }

  private inputsToCrouch(ctx: EPhysicsCtx, heading: Heading, world: World) {
    const player = ctx.state as PlayerState;
    if (this.verGreaterThan("1.13.2")) {
      const sneakBb = getCollider(PlayerPoses.SNEAKING, player.pos, player.scale);
      const standBb = getCollider(PlayerPoses.STANDING, player.pos, player.scale);
      sneakBb.expand(-1e-7, -1e-7, -1e-7);
      standBb.expand(-1e-7, -1e-7, -1e-7);

      // ignoreLiquid=true so submerging water does not block CROUCHING; crouching must stay true underwater
      // so isMovingSlowly() is true and the sneak-speed 0.3 scale applies.
      player.crouching =
        !this.isSwimmingAndNotFlying(ctx, world) &&
        this.worldIsFree(world, sneakBb, true) &&
        (player.prevControl.sneak || !this.worldIsFree(world, standBb, true));
    } else {
      player.crouching = !this.isSwimmingAndNotFlying(ctx, world) && player.prevControl.sneak;
    }



    // Determine if moving slowly
    const isMovingSlowly = this.isMovingSlowly(ctx, world);

    // Handle post-1.21.3 sprinting conditions
    if (this.verGreaterThan("1.21.3")) {
      // TODO: just use stored blindness effect.
      const hasBlindness = this.getEffectLevel(CheapEffects.BLINDNESS, player.effects) > 0;

      const forceStopWhenMovingSlowly = this.verLessThan("1.21.5") && isMovingSlowly;
      if (hasBlindness || forceStopWhenMovingSlowly) {
        this.setSprinting(ctx, false);
      }
    }

    // Apply slow down to player inputs when moving slowly
    if (isMovingSlowly) {
      let sneakCoefficient: number;

      if (this.verLessThan("1.19")) {
        sneakCoefficient = 0.3;
      } else if (this.verLessThan("1.21")) {
        sneakCoefficient = 0.3 + player.swiftSneak * 0.15;
        sneakCoefficient = Math.min(Math.max(0.0, sneakCoefficient), 1.0);
      } else {
        // Look up by the resolved attribute key; mineflayer stores the base value separately from
        // modifiers (e.g. an equipped swift-sneak enchant), so fold via attributes.getAttributeValue
        // rather than reading .value directly, or the enchant is silently ignored.
        const ssAttr = this.sneakingSpeedAttribute ? player.attributes?.[this.sneakingSpeedAttribute] : undefined;
        sneakCoefficient = ssAttr ? attributes.getAttributeValue(ssAttr as any, this.sneakingSpeedAttribute) : 0.3;
      }
      heading.forward *= sneakCoefficient;
      heading.strafe *= sneakCoefficient;
    }
  }

  private isSwimmingAndNotFlying(ctx: EPhysicsCtx, world: World): boolean {
    const entity = ctx.state;
    //  return !player->flying &&
    // player->game_mode != GameType::Spectator &&
    // player->GetDataSharedFlagsIdImpl(EntitySharedFlagsId::Swimming);

    if (entity instanceof PlayerState) {
      return !entity.flying && entity.gameMode !== "spectator" && entity.swimming;
    } else {
      return false; // TODO: proper handling of non-player mobs.
    }
  }

  private inputsToSprint(ctx: EPhysicsCtx, heading: Heading, world: World) {
    const player = ctx.state as PlayerState;

    // console.log('is sprinting', player.sprinting, 'can sprint', this.canStartSprinting(ctx, heading), player.sprinting)
    if (this.canStartSprinting(ctx, heading) &&
      (player.control.sprint || (player.sprintTriggerTime > 0 && heading.forward >= (player.isInWater ? 1e-5 : 0.8)))) {
      this.setSprinting(ctx, true);
    }

    // console.log('should stop', this.shouldStopRunSprinting(ctx, heading), 'minor collision', player.isCollidedHorizontallyMinor)
    // Stop sprinting if necessary
    if (player.sprinting) {
      if (!player.control.sprint) {
        this.setSprinting(ctx, false);
      }

      if (this.isSwimming(ctx)) {
        if (this.shouldStopSwimSprinting(ctx, heading)) {
          this.setSprinting(ctx, false);
        }
      } else if (this.shouldStopRunSprinting(ctx, heading)) {
        this.setSprinting(ctx, false);
      }
    }
  }

  private canStartSprinting(ctx: EPhysicsCtx, heading: Heading): boolean {
    const player = ctx.state as PlayerState;
    return !player.sprinting &&
      // 1.21.11+: sprinting requires only a nonzero forward impulse (no land-only 0.8 threshold).
      heading.forward >= 1e-5 &&
      this.hasEnoughFoodToSprint(ctx) &&
      !player.isSlowDueToUsingItem &&
      !player.blindness &&
      //  (!player.isPassenger || this.vehicleCanSprint(ctx)) &&
      (!player.fallFlying || player.isUnderWater) &&
      (!player.crouching || player.isUnderWater) &&
      (!player.isInWater || player.isUnderWater);
  }

  private hasEnoughFoodToSprint(ctx: EPhysicsCtx): boolean {
    const player = ctx.state as PlayerState;
    return /* player.isPassenger ||*/ player.food > 6 || player.mayFly;
  }

  private vehicleCanSprint(ctx: EPhysicsCtx): boolean {
    return false;
    // const player = ctx.state as PlayerState;
    // return player.vehicle &&
    //        player.vehicle.canSprint &&
    //        player.vehicle.isLocalInstanceAuthoritative;
  }

  private isSwimming(ctx: EPhysicsCtx): boolean {
    const player = ctx.state as PlayerState;
    return player.isInWater && player.isUnderWater;
  }

  private handleFallFlyingCollisions(player: PlayerState, previousHorizontalSpeed: number) {
    if (!player.isCollidedHorizontally) return;

    const currentHorizontalSpeed = Math.sqrt(player.vel.x * player.vel.x + player.vel.z * player.vel.z);
    const deltaSpeed = previousHorizontalSpeed - currentHorizontalSpeed;
    const collisionDamage = deltaSpeed * 10.0 - 3.0;

    if (collisionDamage > 0.0) {
      // Vanilla applies fly-into-wall damage and sound here.
      // BotcraftPhysics currently does not model those side effects.
    }
  }

  private applyFireworkBoost(player: PlayerState) {
    if (player.fireworkRocketDuration <= 0) return;

    if (!player.fallFlying) {
      player.fireworkRocketDuration = 0;
      return;
    }

    const { lookDir } = getLookingVector(player);
    player.vel.x += lookDir.x * 0.1 + (lookDir.x * 1.5 - player.vel.x) * 0.5;
    player.vel.y += lookDir.y * 0.1 + (lookDir.y * 1.5 - player.vel.y) * 0.5;
    player.vel.z += lookDir.z * 0.1 + (lookDir.z * 1.5 - player.vel.z) * 0.5;
    --player.fireworkRocketDuration;
  }

  private shouldStopRunSprinting(ctx: EPhysicsCtx, heading: Heading): boolean {
    const player = ctx.state as PlayerState;
    return player.blindness > 0 ||
      //  (player.isPassenger && !this.vehicleCanSprint(ctx)) ||
      heading.forward < 1e-5 ||
      !this.hasEnoughFoodToSprint(ctx) ||
      (player.isCollidedHorizontally && !player.isCollidedHorizontallyMinor) ||
      (player.isInWater && !player.isUnderWater);
  }

  private shouldStopSwimSprinting(ctx: EPhysicsCtx, heading: Heading): boolean {
    const player = ctx.state as PlayerState;
    return player.blindness > 0 ||
      //  (player.isPassenger && !this.vehicleCanSprint(ctx)) ||
      !player.isInWater ||
      (heading.forward <= 1e-5 && !player.onGround && !player.control.sneak) ||
      !this.hasEnoughFoodToSprint(ctx);
  }

  /**
   * TODO: almost certainly unfinished.
   * @param player
   * @param value
   */
  setSprinting(ctx: EPhysicsCtx, value: boolean) {
    const player = ctx.state as PlayerState;
    let attr = player.attributes[this.movementSpeedAttribute];

    if (this.verLessThan("1.20.5")) {
      // Legacy: the engine starts from a synthetic base (server effect modifiers were re-derived in
      // getMovementSpeedAttribute), so rebuilding from playerSpeed here is fine.
      if (attr != null) attributes.deleteAttributeModifier(attr, ctx.worldSettings.sprintingUUID);
      attr = attributes.createAttributeValue(ctx.worldSettings.playerSpeed);
      if (value) {
        attributes.addAttributeModifier(attr, {
          uuid: ctx.worldSettings.sprintingUUID,
          amount: ctx.worldSettings.sprintSpeed,
          operation: 2,
        });
      }
      player.attributes[this.movementSpeedAttribute] = attr;
    } else {
      // 1.20.5+: mutate the EXISTING movement_speed attribute in place; do NOT rebuild from a synthetic
      // base or server-synced effect modifiers (speed/slowness) would be discarded. Fall back to a
      // synthetic base only if the server never sent movement_speed.
      if (attr == null) {
        attr = attributes.createAttributeValue(Math.fround(ctx.worldSettings.playerSpeed));
        player.attributes[this.movementSpeedAttribute] = attr;
      }
      attributes.deleteAttributeModifier(attr, ctx.worldSettings.sprintingUUID);
      attributes.deleteAttributeModifier(attr, "minecraft:sprinting");
      if (value) {
        attributes.addAttributeModifier(attr, {
          uuid: ctx.worldSettings.sprintingUUID,
          amount: ctx.worldSettings.sprintSpeed,
          operation: 2,
        });
      }
    }

    // potential deviation from vanilla.
    // if (value != player.sprinting) {
    //   player.sprintTriggerTime = ctx.worldSettings.sprintTimeTriggerCooldown;
    // }

    player.sprinting = value;
  }

  private inputsToFly(ctx: EPhysicsCtx, heading: Heading, world: World) {
    const player = ctx.state as PlayerState;
    let flyChanged = false;
    if (player.mayFly) {
      // Auto trigger if in spectator mode
      if (player.gameMode === "spectator") {
        player.flying = true;
        flyChanged = true;
        // onUpdateAbilities();
      } else {
        // If double jump in creative, swap flying mode
        if (player.prevControl.jump && player.control.jump) {
          if (player.flyJumpTriggerTime === 0) {
            player.flyJumpTriggerTime = ctx.worldSettings.flyJumpTriggerCooldown;
          } else if (this.isSwimmingAndNotFlying(ctx, world)) {
            player.flying = !player.flying;
            flyChanged = true;
            // onUpdateAbilities();
            player.flyJumpTriggerTime = 0;
          }
        }
      }
    }

    const hasLevitationEffect = player.levitation > 0;

    if (
      player.control.jump &&
      !flyChanged &&
      !player.prevControl.jump &&
      !player.flying &&
      !player.onClimbable &&
      !player.onGround &&
      !player.isInWater &&
      /* !player->GetDataSharedFlagsIdImpl(EntitySharedFlagsId::FallFlying) && */ !player.fallFlying &&
      !hasLevitationEffect
    ) {
      const hasElytra = player.validElytraEquipped;
      if (hasElytra) {
        player.fallFlying = true;
        // https://github.com/adepierre/Botcraft/blob/6c572071b0237c27a85211a246ce10565ef4d80f/botcraft/src/Game/Physics/PhysicsManager.cpp#L792
        // something about setting actions?
      }
    }
  }

  private inputsToJump(entity: IEntityState, world: World, worldSettings: PhysicsWorldSettings) {
    // TODO: implement non-player entity jumping.

    if (entity instanceof PlayerState) {
      const player = entity as PlayerState;

      if (!player.control.jump) {
        player.jumpTicks = 0;
        return;
      }

      if (player.flying) {
        return;
      }

      const fluidJumpThreshold = player.eyeHeight < 0.4 ? 0.0 : 0.4;
      const fluidHeight = player.isInLava ? player.lavaHeight : player.waterHeight;
      const inWaterAndColumn = player.isInWater && fluidHeight > 0.0;
      if (inWaterAndColumn && (!player.onGround || fluidHeight > fluidJumpThreshold)) {
        player.vel.y += 0.03999999910593033; // jumpInLiquid: +0.04f
      } else if (player.isInLava && (!player.onGround || fluidHeight > fluidJumpThreshold)) {
        player.vel.y += 0.03999999910593033; // jumpInLiquid: +0.04f
      } else if ((player.onGround || (inWaterAndColumn && fluidHeight <= fluidJumpThreshold)) && player.jumpTicks === 0) {
        const blockJumpFactor = this.getBlockJumpFactor(player, world, worldSettings);
        const jumpBoost = Math.fround(0.1 * player.jumpBoost); // in mineflayer, level 1 is 1, not 0.

        if (this.verLessThan("1.20.5")) {
          const jumpPower = Math.fround(Math.fround(0.42) * Math.fround(blockJumpFactor) + jumpBoost);
          player.vel.y = Math.max(jumpPower, player.vel.y);
          if (player.sprinting) {
            const yawRad = Math.PI - player.yaw; // should already be in yaw. MINEFLAYER SPECIFC CHANGE, MATH.PI -
            // potential inconsistency here. This may not be accurate.
            const offsetX = Math.fround(Math.sin(yawRad)) * 0.2;
            const offsetZ = Math.fround(Math.cos(yawRad)) * 0.2;
            player.vel.x -= offsetX
            player.vel.z += offsetZ
          }
        } else {
          const jsAttr = this.jumpStrengthAttribute ? entity.attributes?.[this.jumpStrengthAttribute] : undefined;
          const value = Math.fround(jsAttr ? attributes.getAttributeValue(jsAttr as any, this.jumpStrengthAttribute) : Math.fround(0.42));
          const jumpPower = Math.fround(value * Math.fround(blockJumpFactor) + jumpBoost);
          if (jumpPower > 1e-5) {
            player.vel.y = Math.max(jumpPower, player.vel.y);
            if (player.sprinting) {
              const yawRad = Math.PI - player.yaw; // should already be in yaw. MINEFLAYER SPECIFC CHANGE, MATH.PI -
              player.vel.x -= Math.sin(yawRad) * 0.2;
              player.vel.z += Math.cos(yawRad) * 0.2;
            }
          }
        }

        player.jumpTicks = worldSettings.autojumpCooldown;
      }
    }
  }

  private getBlockJumpFactor(entity: IEntityState, world: World, worldSettings: PhysicsWorldSettings) {
    const feetBlock = world.getBlock(new Vec3(entity.pos.x, entity.pos.y, entity.pos.z));
    const feetJumpFactor = this.getKnownJumpFactor(feetBlock?.type, worldSettings);
    if (feetJumpFactor !== 1.0) return feetJumpFactor;

    const supportBlock = world.getBlock(this.getBlockBelowAffectingMovement(entity, world));
    return this.getKnownJumpFactor(supportBlock?.type, worldSettings);
  }

  private getKnownJumpFactor(blockType: number | undefined, worldSettings: PhysicsWorldSettings) {
    if (blockType == null) return 1.0;
    if (blockType === this.honeyblockId) return worldSettings.honeyblockJumpSpeed;
    return 1.0;
  }

  private getOffGroundSpeed(player: PlayerState) {
    if (player.flying) {
      return player.sprinting ? player.flySpeed * 2.0 : player.flySpeed;
    }

    return player.sprinting ? Math.fround(0.025999999) : Math.fround(0.02);
  }

  private getBlockBelowAffectingMovement(entity: IEntityState, world: World) {
    if (entity.supportingBlockPos != null) {
      // Keep the supporting block's X/Z, but re-derive Y as floor(pos.y - 0.500001).
      return new Vec3(entity.supportingBlockPos.x, Math.floor(entity.pos.y - 0.500001), entity.supportingBlockPos.z);
    } else {
      return entity.pos.offset(0, -0.500001, 0);
    }
  }

  /**
   * Taken from original physics impl.
   * @param entity
   * @returns
   */
 getMovementSpeedAttribute(entity: EPhysicsCtx) {
    const isSprinting = entity.state instanceof PlayerState && entity.state.sprinting;
    let attribute;
    
    // In 1.21+, this should map to 'minecraft:movement_speed'
    if (entity.state.attributes && entity.state.attributes[this.movementSpeedAttribute]) {
      attribute = entity.state.attributes[this.movementSpeedAttribute];
    } else {
      // Create fallback if server hasn't sent it
      attribute = attributes.createAttributeValue(Math.fround(entity.worldSettings.playerSpeed));
    }

    // --- SPRINTING ---
    // Delete both the legacy UUID and the 1.20.5+ "minecraft:sprinting" id so a server-synced sprint
    // modifier can never stack on top of the engine's add.
    attribute = attributes.deleteAttributeModifier(attribute, entity.worldSettings.sprintingUUID);
    attribute = attributes.deleteAttributeModifier(attribute, "minecraft:sprinting");
    if (isSprinting) {
      attribute = attributes.addAttributeModifier(attribute, {
        uuid: entity.worldSettings.sprintingUUID,
        // Math.fround(0.3) perfectly resolves to 0.30000001192092896
        amount: Math.fround(0.3),
        operation: 2,
      });
    }

    // --- SPEED / SLOWNESS EFFECTS ---
    // 1.20.5+: SPEED/SLOWNESS are applied server-side as attribute modifiers and synced to the client, so
    // do NOT re-add them here (getAttributeValue already folds the server-synced modifiers). Pre-1.20.5 has
    // no server-synced modifiers, so the engine must re-add them itself (below).
    if (this.verLessThan("1.20.5")) {
      // --- SPEED EFFECT --- (legacy only)
      const SPEED_UUID = "91AEAA56-376B-4498-935B-2F7F68070635";
      attribute = attributes.deleteAttributeModifier(attribute, SPEED_UUID);

      const speedLevel = this.getEffectLevel(CheapEffects.SPEED, entity.state.effects);
      if (speedLevel > 0) {
        attribute = attributes.addAttributeModifier(attribute, {
          uuid: SPEED_UUID,
          // Truncate the 0.2 first, then multiply, then truncate again (how Java float math works)
          amount: Math.fround(Math.fround(0.2) * speedLevel),
          operation: 2,
        });
      }

      // --- SLOWNESS EFFECT --- (legacy only)
      const SLOWNESS_UUID = "7107DE5E-7CE8-4030-940E-514C1F160890";
      attribute = attributes.deleteAttributeModifier(attribute, SLOWNESS_UUID);

      const slownessLevel = this.getEffectLevel(CheapEffects.SLOWNESS, entity.state.effects);
      if (slownessLevel > 0) {
        attribute = attributes.addAttributeModifier(attribute, {
          uuid: SLOWNESS_UUID,
          amount: Math.fround(Math.fround(-0.15) * slownessLevel),
          operation: 2,
        });
      }
    }

    // Calculate the final speed and cast the entire result to a 32-bit float
    const attributeSpeed = Math.fround(attributes.getAttributeValue(attribute, this.movementSpeedAttribute));
    return attributeSpeed;
  }

  private tryRiptide(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    if (!player.riptideQueued) return;
    player.riptideQueued = false; // one-shot: consume regardless of whether the gates below pass
    if (!(player.riptideLevel > 0) || player.isPassenger) return;

    const strength = 1.5 + 0.75 * (player.riptideLevel - 1);
    const { lookDir } = getLookingVector(player);
    const dist = Math.sqrt(lookDir.x * lookDir.x + lookDir.y * lookDir.y + lookDir.z * lookDir.z);
    if (dist > 0) {
      const f = strength / dist;
      player.vel.x += lookDir.x * f;
      player.vel.y += lookDir.y * f;
      player.vel.z += lookDir.z * f;
    }

    player.autoSpinAttackTicks = 20;

    if (player.onGround) {
      const bb = player.getBB();
      const disp = this.collideBoundingBox(world, bb, new Vec3(0, 1.1999999, 0));
      player.pos.y += disp.y;
      if (disp.y + 1e-7 < 1.1999999) player.isCollidedVertically = true;
      player.onGround = false;
    }
  }

  /**
   * Assume EPhysicsCtx is wrapping a PlayerState.
   * @param ctx
   * @param world
   */
  movePlayer(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    {
      // LivingEntity::travel
      const goingDown = player.vel.y <= 0.0;
      const hasSlowFalling = player.slowFalling > 0;

      // named drag in botcraft. That seems incorrect. Not sure yet.
      const gravAttr = this.gravityAttribute ? player.attributes?.[this.gravityAttribute] : undefined;
      const baseGravity = gravAttr
        ? attributes.getAttributeValue(gravAttr as any, this.gravityAttribute)
        : ctx.gravity;
      let gravity: number;
      if (this.verLessThan("1.20.5")) {
        gravity = goingDown && hasSlowFalling ? 0.01 : baseGravity;
      } else {
        gravity = goingDown && hasSlowFalling ? Math.min(0.01, baseGravity) : baseGravity;
      }

      if (player.isInWater && !player.flying) {
        const initY = player.pos.y;
        let waterSlowDown = player.sprinting ? ctx.sprintWaterInertia : ctx.waterInertia;
        let inputStrength = 0.02;
        let depthStriderMult;
        if (this.verLessThan("1.21")) {
          const depthStrider = player.depthStrider;
          depthStriderMult = Math.min(depthStrider, 3) / 3;
        } else {
          // depth_strider is a server-synced WATER_MOVEMENT_EFFICIENCY attribute modifier (not a base value
          // change), so read it via attributes.getAttributeValue (folds modifiers) rather than the bare
          // .value, or an equipped depth-strider enchant is silently ignored. Default 0.0 when absent.
          const wmeAttr = this.waterMovementEfficiencyAttribute
            ? player.attributes?.[this.waterMovementEfficiencyAttribute]
            : undefined;
          depthStriderMult = wmeAttr ? attributes.getAttributeValue(wmeAttr as any, this.waterMovementEfficiencyAttribute) : 0;
        }

        if (!player.onGround) {
          depthStriderMult *= 0.5;
        }
        if (depthStriderMult > 0.0) {
          waterSlowDown += (0.54600006 - waterSlowDown) * depthStriderMult; // magic number
          const movementSpeed = this.getMovementSpeedAttribute(ctx); // slight deviation, using utility method
          inputStrength += Math.fround(movementSpeed - inputStrength) * depthStriderMult;
        }

        if (this.verGreaterThan("1.12.2")) {
          if (player.dolphinsGrace > 0) {
            waterSlowDown = 0.96; // magic number
          }
        }

        this.applyInputs(inputStrength, player);
        this.applyMovement(ctx, world);

        if (player.isCollidedHorizontally && player.onClimbable) {
          player.vel.y = 0.2;
        }

        player.vel.x *= waterSlowDown;
        player.vel.y *= 0.800000011920929; // magic number, pretty sure this is wrong.
        player.vel.z *= waterSlowDown;

        if (gravity !== 0.0 && !player.sprinting) {
          if (
            goingDown &&
            Math.abs(player.vel.y - 0.005) >= ctx.worldSettings.negligeableVelocity &&
            Math.abs(player.vel.y - gravity / 16.0) < ctx.worldSettings.negligeableVelocity
          ) {
            player.vel.y = -0.003;
          } else {
            player.vel.y -= gravity / 16.0;
          }
        }

        const bb = player.getBB().expand(-1e-7, -1e-7, -1e-7);
        bb.translate(0, 0.6000000238418579 - player.pos.y + initY, 0);
        bb.translateVec(player.vel);
        if (player.isCollidedHorizontally && this.worldIsFree(world, bb, false)) {
          player.vel.y = ctx.worldSettings.outOfLiquidImpulse;
        }
      } else if (player.isInLava && !player.flying) {
        const initY = player.pos.y;
        this.applyInputs(0.02, player);
        this.applyMovement(ctx, world);

        const fluidJumpThreshold = player.eyeHeight < 0.4 ? 0.0 : 0.4;
        if (player.lavaHeight <= fluidJumpThreshold) {
          player.vel.x *= 0.5;
          player.vel.y *= 0.800000011920929; // LAVA_SHALLOW_VERTICAL_DRAG
          player.vel.z *= 0.5;
          if (gravity !== 0.0 && !player.sprinting) {
            if (
              goingDown &&
              Math.abs(player.vel.y - 0.005) >= ctx.worldSettings.negligeableVelocity &&
              Math.abs(player.vel.y - gravity / 16.0) < ctx.worldSettings.negligeableVelocity
            ) {
              player.vel.y = -0.003;
            } else {
              player.vel.y -= gravity / 16.0;
            }
          }
        } else {
          player.vel.scale(0.5);
        }

        // Lava extra-sink: gravity here is the slow-fall-aware effective gravity, not the raw ctx.gravity.
        if (gravity !== 0.0) {
          player.vel.y -= gravity / 4.0;
        }

        const bb = player.getBB().expand(-1e-7, -1e-7, -1e-7);
        bb.translate(0, 0.6000000238418579 - player.pos.y + initY, 0); // Math.fround(0.60)
        bb.translateVec(player.vel);
        if (player.isCollidedHorizontally && this.worldIsFree(world, bb, false)) {
          player.vel.y = ctx.worldSettings.outOfLiquidImpulse;
        }
      }
      // elytra flying.
      else if (player.fallFlying && !player.onClimbable) {
        const previousHorizontalSpeed = Math.sqrt(player.vel.x * player.vel.x + player.vel.z * player.vel.z);

        // slight deviation
        // sqrt(front_vector.x² + front_vector.z²) to follow vanilla code
        const { pitch, sinPitch, cosPitch, lookDir } = getLookingVector(player);

        const cosPitchFromLength = Math.sqrt(lookDir.x * lookDir.x + lookDir.z * lookDir.z);
        const cosPitchSqr = cosPitch * cosPitch;
        const hVel = Math.sqrt(player.vel.x * player.vel.x + player.vel.z * player.vel.z);
        player.vel.y += gravity * (-1 + 0.75 * cosPitchSqr);

        if (player.vel.y < 0.0 && cosPitchFromLength > 0.0) {
          const deltaSpeed = -player.vel.y * 0.1 * cosPitchSqr;
          player.vel.x += (lookDir.x * deltaSpeed) / cosPitchFromLength;
          player.vel.z += (lookDir.z * deltaSpeed) / cosPitchFromLength;
          player.vel.y += deltaSpeed;
        }

        if (player.pitch > 0.0 && cosPitchFromLength > 0.0) {
          const deltaSpeed = hVel * lookDir.y * 0.04;
          player.vel.x += (-lookDir.x * deltaSpeed) / cosPitchFromLength;
          player.vel.z += (-lookDir.z * deltaSpeed) / cosPitchFromLength;
          player.vel.y += deltaSpeed * 3.2; // magic number
        }

        if (cosPitchFromLength > 0.0) {
          player.vel.x += ((lookDir.x / cosPitchFromLength) * hVel - player.vel.x) * 0.1;
          player.vel.z += ((lookDir.z / cosPitchFromLength) * hVel - player.vel.z) * 0.1;
        }
        player.vel.x *= Math.fround(0.99); // magic number, this DEFINITELY should be replaced by a drag value.
        player.vel.z *= Math.fround(0.99); // magic number, this DEFINITELY should be replaced by a drag value.
        player.vel.y *= Math.fround(0.98); // magic number, this DEFINITELY should be replaced by a drag value.
        this.applyMovement(ctx, world);

        this.handleFallFlyingCollisions(player, previousHorizontalSpeed);
      } else {
        if (player.fallFlying) player.fallFlying = false;

        const blockBelow = world.getBlock(this.getBlockBelowAffectingMovement(player, world));

        // deviation. using our stores slipperiness values.
        const rawFriction = blockBelow
          ? this.blockSlipperiness[blockBelow.type] ?? ctx.worldSettings.defaultSlipperiness
          : ctx.worldSettings.defaultSlipperiness;

        const fmAttr = this.frictionModifierAttribute ? player.attributes?.[this.frictionModifierAttribute] : undefined;
        const frictionModifier = fmAttr ? attributes.getAttributeValue(fmAttr as any, this.frictionModifierAttribute) : 1.0;
        const adAttr = this.airDragModifierAttribute ? player.attributes?.[this.airDragModifierAttribute] : undefined;
        const airDragModifier = adAttr ? attributes.getAttributeValue(adAttr as any, this.airDragModifierAttribute) : 1.0;

        const friction = computeModifiedFriction(rawFriction, frictionModifier);
        const airDrag = computeModifiedFriction(ctx.airborneInertia, airDragModifier);
        const verticalDrag = computeModifiedFriction(0.9800000190734863, airDragModifier);

        // console.log(blockBelow.name, blockBelow.position, player.supportingBlockPos, friction)
        // Uses player.onGround as it stood at the START of this tick (this tick's applyMovement, which
        // updates onGround, has not run yet).
        const inertia = player.onGround ? friction * airDrag : airDrag;

        // deviation, adding additional logic for changing attribute values.
        const movementSpeedAttr = this.getMovementSpeedAttribute(ctx);

        let inputStrength: number;
        if (player.lastOnGround) {
          inputStrength = movementSpeedAttr * (0.21600002 / (friction * friction * friction));
        } else {
          inputStrength = this.getOffGroundSpeed(player);
        }

       

        this.applyInputs(inputStrength, player);

        if (player.onClimbable) {
          // LivingEntity::handleOnClimbable
          player.vel.x = math.clamp(-0.15000000596046448, player.vel.x, 0.15000000596046448); // Math.fround(0.15)
          player.vel.z = math.clamp(-0.15000000596046448, player.vel.z, 0.15000000596046448); // Math.fround(0.15)
          player.vel.y = Math.max(-0.15000000596046448, player.vel.y); // Math.fround(0.15)
          const feetBlock = world.getBlock(new Vec3(player.pos.x, player.pos.y, player.pos.z));
          // Zero Y only when falling (vel.y < 0), not on scaffolding (which must never cling), and while sneaking.
          if (feetBlock && player.vel.y < 0.0 && this.scaffoldId !== feetBlock.type && player.control.sneak) {
            player.vel.y = 0.0;
          }
        }

        this.applyMovement(ctx, world);

        if (
          (player.isCollidedHorizontally || player.control.jump) &&
          (player.onClimbable || (player.wasInPowderSnow && player.canWalkOnPowderSnow))
        ) {
          player.vel.y = 0.2;
        }

        if (player.levitation > 0) {
          player.vel.y += (0.05 * player.levitation - player.vel.y) * 0.2;
        } else {
          player.vel.y -= gravity;
        }

        player.vel.x *= inertia;
        player.vel.z *= inertia;
        player.vel.y *= verticalDrag;
      }

      this.applyFireworkBoost(player);
    }

    // Bubble-column / honey-slide pushes must be applied AFTER the full travel branch above, not mid-move,
    // or gravity/drag would corrupt the final velocity.
    this.applyBubbleColumnEffects(player, world);
    this.applyHoneySlideEffects(player, world);
    this.applyGeyserEffects(player, world);
  }

  // Honey slide mutates vel.y directly; must run after the full travel branch (gravity/drag), not mid-move
  // inside checkInsideBlocks, or it would corrupt the final velocity.
  applyHoneySlideEffects(player: PlayerState, world: World) {
    if (player.flying) return;
    if (this.honeyblockId < 0) return;
    const deflate = this.verLessThan("1.21.11") ? 1e-7 : 1e-5;
    const aabb = player.getBB().expand(-deflate, -deflate, -deflate);
    const [minAABB, maxAABB] = aabb.minAndMaxArrays();
    const blockPos = new Vec3(0, 0, 0);
    for (blockPos.y = Math.floor(minAABB[1]); blockPos.y <= Math.floor(maxAABB[1]); ++blockPos.y) {
      for (blockPos.x = Math.floor(minAABB[0]); blockPos.x <= Math.floor(maxAABB[0]); ++blockPos.x) {
        for (blockPos.z = Math.floor(minAABB[2]); blockPos.z <= Math.floor(maxAABB[2]); ++blockPos.z) {
          const block = world.getBlock(blockPos);
          if (block == null || this.honeyblockId !== block.type) continue;
          const oldDeltaY = player.vel.y / 0.9800000190734863 + 0.08;
          const newSlideY = (-0.05 - 0.08) * 0.9800000190734863; // getNewDeltaY(-0.05) = -0.1274
          if (
            !player.onGround &&
            player.pos.y <= blockPos.y + 0.9375 - 1e-7 &&
            oldDeltaY < -0.08 &&
            (Math.abs(blockPos.x + 0.5 - player.pos.x) + 1e-7 > 0.4375 + player.halfWidth ||
              Math.abs(blockPos.z + 0.5 - player.pos.z) + 1e-7 > 0.4375 + player.halfWidth)
          ) {
            if (oldDeltaY < -0.13) {
              const factor = -0.05 / oldDeltaY;
              player.vel.x *= factor;
              player.vel.z *= factor;
              player.vel.y = newSlideY;
            } else {
              player.vel.y = newSlideY;
            }
            player.fallDistance = 0.0;
            return; // only one honey cell needs to drive the slide; matches a single entityInside hit
          }
        }
      }
    }
  }

  applyGeyserEffects(player: PlayerState, world: World) {
    if (this.potentSulfurId < 0) return; // block absent (<26.2 data) => identity
    if (player.flying) return;
    if (player.isPassenger) return;

    const ALLOWED_WATER_BLOCKS_ABOVE = 4;
    const GEYSER_MAX_REACH = 6 * ALLOWED_WATER_BLOCKS_ABOVE + 1;

    const bb = player.getBB();
    const [minA, maxA] = bb.minAndMaxArrays();
    const topY = Math.floor(maxA[1]);
    const bottomY = Math.floor(minA[1]) - GEYSER_MAX_REACH;
    const cursor = new Vec3(0, 0, 0);

    for (cursor.x = Math.floor(minA[0]); cursor.x <= Math.floor(maxA[0]); ++cursor.x) {
      for (cursor.z = Math.floor(minA[2]); cursor.z <= Math.floor(maxA[2]); ++cursor.z) {
        for (cursor.y = topY; cursor.y >= bottomY; --cursor.y) {
          const block = world.getBlock(cursor);
          if (block == null) break;
          if (block.type === this.potentSulfurId) {
            const state = block.getProperties().potent_sulfur_state;
            if (state === "erupting" || state === "continuous") {
              this.applyGeyserLaunch(player, world, cursor.x, cursor.y, cursor.z, minA, maxA);
            }
            break;
          }
          if (block.boundingBox !== "empty") break;
        }
      }
    }
  }

  private isGeyserPassable(block: Block | null): boolean {
    return block != null && block.boundingBox === "empty";
  }

  private isGeyserWaterSource(block: Block | null): boolean {
    if (block == null) return false;
    if (this.waterLike.has(block.type)) return true;
    if (block.getProperties().waterlogged) return true;
    if (block.type !== this.waterId) return false;
    return block.metadata === 0;
  }

  private findGeyserSourceCapY(world: World, sx: number, sy: number, sz: number): number | null {
    const maxY = sy + 4 + 1;
    const p = new Vec3(sx, sy + 1, sz);
    for (; p.y <= maxY; ++p.y) {
      const block = world.getBlock(p);
      const isSource = this.isGeyserWaterSource(block);
      const isWaterBlock = block != null && block.type === this.waterId;
      const passable = this.isGeyserPassable(block);
      if (!isSource || (!isWaterBlock && !passable)) {
        return passable ? p.y : null;
      }
    }
    return null;
  }

  private getGeyserForceHeight(world: World, sx: number, sy: number, sz: number, waterBlocks: number): number {
    const cap = 6 * waterBlocks;
    const p = new Vec3(sx, sy + 1, sz);
    for (let i = 0; i < cap; ++i) {
      p.y = sy + 1 + i;
      if (!this.isGeyserPassable(world.getBlock(p))) return i;
    }
    return cap;
  }

  private applyGeyserLaunch(
    player: PlayerState,
    world: World,
    sx: number,
    sy: number,
    sz: number,
    minA: number[],
    maxA: number[]
  ): void {
    const capY = this.findGeyserSourceCapY(world, sx, sy, sz);
    if (capY == null) return;
    const waterBlocks = capY - sy - 1;
    const forceHeight = this.getGeyserForceHeight(world, sx, sy, sz, waterBlocks);

    let aabbMinY = sy + 1;
    let aabbMaxY = sy + 2;
    const ya = forceHeight - 1;
    if (ya < 0) aabbMinY += ya;
    else if (ya > 0) aabbMaxY += ya;

    if (
      !(
        minA[0] < sx + 1 &&
        maxA[0] > sx &&
        minA[2] < sz + 1 &&
        maxA[2] > sz &&
        minA[1] < aabbMaxY &&
        maxA[1] > aabbMinY
      )
    ) {
      return;
    }

    if (player.vel.y > -0.5 && player.fallDistance > 1.0) player.fallDistance = 1.0;

    if (player.vel.y < 0.30000001192092896 + waterBlocks * 0.1) {
      player.vel.y += 0.20000000298023224;
    }
  }

  applyMovement(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    if (player.gameMode === "spectator") {
      player.pos.translate(player.vel.x, player.vel.y, player.vel.z);
      return;
    }

    // console.log('wtf vel?', player.vel)
    // this might be a clone.
    let movement = player.vel.clone();


    // if a player is stuck, reset stuck multiplier and set velocity to 0.
    if (player.stuckSpeedMultiplier.norm() ** 2 > 1e-7) {
      movement.x *= player.stuckSpeedMultiplier.x;
      movement.y *= player.stuckSpeedMultiplier.y;
      movement.z *= player.stuckSpeedMultiplier.z;
      player.stuckSpeedMultiplier.set(0, 0, 0);
      player.vel.set(0, 0, 0);
    }

    let maxUpStep = ctx.stepHeight;
    if (!this.verLessThan("1.20.5")) {
      const shAttr = this.stepHeightAttribute ? player.attributes?.[this.stepHeightAttribute] : undefined;
      maxUpStep = shAttr ? attributes.getAttributeValue(shAttr as any, this.stepHeightAttribute) : ctx.stepHeight;
    }

    // const playerAABB = player.getBB();
    const isAboveGround = (): boolean => {
      if (player.onGround) return true;
      if (!(player.fallDistance < maxUpStep)) return false;
      const bb = player.getBB();
      const minHeight = maxUpStep - player.fallDistance;
      const fallProbe = new AABB(
        bb.minX + 1e-7,
        bb.minY - minHeight - 1e-7,
        bb.minZ + 1e-7,
        bb.maxX - 1e-7,
        bb.minY,
        bb.maxZ - 1e-7
      );
      return !this.worldIsFree(world, fallProbe, true);
    };
    if (!player.flying && movement.y <= 0.0 && player.control.sneak && isAboveGround()) {
      // Player::maybeBackOffFromEdge
      const step = 0.05;

      // for readability.
      const prepare = (x: number, y: number, z: number) => {
        const bb = player.getBB().translate(x, y, z);
        bb.expand(-1e-7, -1e-7, -1e-7);
        return bb;
      };

      while (movement.x != 0.0 && this.worldIsFree(world, prepare(movement.x, -maxUpStep, 0), true)) {
        // console.log('x', movement.x, step, this.worldIsFree(world, prepare(movement.x, -maxUpStep, 0), true))
        movement.x = movement.x < step && movement.x >= -step ? 0.0 : movement.x > 0.0 ? movement.x - step : movement.x + step;
      }

      while (movement.z != 0.0 && this.worldIsFree(world, prepare(0, -maxUpStep, movement.z), true)) {
        movement.z = movement.z < step && movement.z >= -step ? 0.0 : movement.z > 0.0 ? movement.z - step : movement.z + step;
      }

      while (movement.x != 0.0 && movement.z != 0.0 && this.worldIsFree(world, prepare(movement.x, -maxUpStep, movement.z), true)) {
        movement.x = movement.x < step && movement.x >= -step ? 0.0 : movement.x > 0.0 ? movement.x - step : movement.x + step;
        movement.z = movement.z < step && movement.z >= -step ? 0.0 : movement.z > 0.0 ? movement.z - step : movement.z + step;
      }
    }

    // 1.20.5: this is var2 in entity::move
    const movementBeforeCollisions = movement.clone();

    { // Entity::collide
      const playerAABB = player.getBB();
      const hDistSqr = (vec: Vec3) => vec.x * vec.x + vec.z * vec.z;

      const scaffoldCtx: CollisionCtx = {
        entityY: player.pos.y,
        descending: player.control.sneak,
        fallDistance: player.fallDistance,
        walkOnPowderSnow: player.canWalkOnPowderSnow,
      };

      const movementStep = movement.norm() ** 2 === 0 ? movement : this.collideBoundingBox(world, playerAABB, movement, [], scaffoldCtx);

      const collisionX = movement.x !== movementStep.x;
      const collisionY = movement.y !== movementStep.y;
      const collisionZ = movement.z !== movementStep.z;
      const onGroundAfterCollision = collisionY && movement.y < 0.0;

      let resultMovement = movementStep;

      if (maxUpStep > 0 && (onGroundAfterCollision || player.onGround) && (collisionX || collisionZ)) {
        const groundedAABB = onGroundAfterCollision ? playerAABB.moveCoords(0, movementStep.y, 0) : playerAABB;

        let stepUpAABB = groundedAABB.expandTowardsCoords(movement.x, maxUpStep, movement.z);
        if (!onGroundAfterCollision) {
          stepUpAABB = stepUpAABB.expandTowardsCoords(0, -1.0e-5, 0);
        }

        const stepColliders = this.getSurroundingBBs(stepUpAABB, world, true, scaffoldCtx);

        const stepHeightToSkip = Math.fround(movementStep.y);
        const maxStepF = Math.fround(maxUpStep);
        const candidateSet = new Set<number>();
        for (const collider of stepColliders) {
          for (const coord of [collider.minY, collider.maxY]) {
            const relativeCoord = Math.fround(coord - groundedAABB.minY);
            if (!(relativeCoord < 0.0) && relativeCoord !== stepHeightToSkip) {
              if (relativeCoord > maxStepF) break;
              candidateSet.add(relativeCoord);
            }
          }
        }
        const candidateStepUpHeights = Array.from(candidateSet).sort((a, b) => a - b);

        const flatHDistSqr = hDistSqr(movementStep);
        for (const candidateStepUpHeight of candidateStepUpHeights) {
          const stepFromGround = this.collideWithShapes(
            new Vec3(movement.x, candidateStepUpHeight, movement.z),
            groundedAABB,
            stepColliders
          );
          if (hDistSqr(stepFromGround) > flatHDistSqr) {
            const distanceToGround = playerAABB.minY - groundedAABB.minY;
            resultMovement = new Vec3(stepFromGround.x, stepFromGround.y - distanceToGround, stepFromGround.z);
            break;
          }
        }
      }
      movement = resultMovement;
    }
    // console.log('after all collision', movement)
    // Apply the move when the post-move length is non-negligible, OR the collision barely shortened it
    // (the second condition also commits tiny residual moves that collision trimmed only slightly).
    const _postLenSqr = movement.norm() ** 2;
    const posBeforeMove = player.pos.clone();
    if (_postLenSqr > 1e-7 || movementBeforeCollisions.norm() ** 2 - _postLenSqr < 1e-7) {
      player.pos.add(movement);
    }

    // 1.20.5: movement is now considered var4.

    // Horizontal collision flags use a 1e-5 tolerance.
    const collisionX = Math.abs(movement.x - movementBeforeCollisions.x) >= 1e-5;
    // Vertical collision uses an EXACT inequality, never a tolerance like the horizontal flags.
    const collisionY = movement.y !== movementBeforeCollisions.y;
    const collisionZ = Math.abs(movement.z - movementBeforeCollisions.z) >= 1e-5;

    // console.log('collisions', collisionX, collisionY, collisionZ, movementBeforeCollisions, movement, player.vel, player.pos, player.getBB())
    player.isCollidedHorizontally = collisionX || collisionZ;
    player.isCollidedVertically = collisionY;

    if (player.isCollidedHorizontally) {
      player.isCollidedHorizontallyMinor = this.isCollidedHorizontallyMinor(player, movement);

    } else {
      player.isCollidedHorizontallyMinor = false;
    }

    // TODO: add minor horizontal collision check
    {
      // Entity::setOnGroundWithKnownMovement
      const wasOnGround = player.onGround;
      const groundedByCollision = movementBeforeCollisions.y < 0.0 && collisionY;
      const shouldCheckStandingSupport = wasOnGround && Math.abs(movementBeforeCollisions.y) <= 1e-7;

      player.onGround = groundedByCollision;
      if (player.onGround || shouldCheckStandingSupport) {
        const halfWidth = player.halfWidth;
        const feetSliceAABB = new AABB(
          player.pos.x - halfWidth,
          player.pos.y,
          player.pos.z - halfWidth,
          player.pos.x + halfWidth,
          player.pos.y + 1,
          player.pos.z + halfWidth
        );
        const supportingBlockPos = this.getSupportingBlockPos(world, feetSliceAABB);
        // console.log("sBlockPos", feetSliceAABB, supportingBlockPos);
        if (supportingBlockPos != null || player.onGroundWithoutSupportingBlock) {
          player.supportingBlockPos = supportingBlockPos;
        } else {

          player.supportingBlockPos = this.getSupportingBlockPos(world, feetSliceAABB.translate(-movement.x, 0.0, -movement.z));
        }

        // Finding a supporting block position does not mean onGround should be forced true — onGround is
        // set purely by the collision result above; a found support block only updates supportingBlockPos.
        // unnecessary due to it being a getter.
        //  player->on_ground_without_supporting_block = !player->supporting_block_pos.has_value();
      } else {
        // player->on_ground_without_supporting_block = false;
        // player->supporting_block_pos = std::optional<Position>();
        player.supportingBlockPos = null;
      }
    }

    if (!player.isInWater && movement.y < 0.0) {
      player.fallDistance -= Math.fround(movement.y);
    }
    if (player.onGround) {
      player.fallDistance = 0.0;
    }

    // update speeds
    const bnAttr = this.bouncinessAttribute ? player.attributes?.[this.bouncinessAttribute] : undefined;
    const entityBounciness =
      !player.control.sneak && bnAttr
        ? attributes.getAttributeValue(bnAttr as any, this.bouncinessAttribute)
        : 0.0;

    if (collisionX) {
      player.vel.x = -player.vel.x * entityBounciness;
    }
    if (collisionZ) {
      player.vel.z = -player.vel.z * entityBounciness;
    }
    if (collisionY) {
      const velY = player.vel.y;
      const gravAttr = this.gravityAttribute ? player.attributes?.[this.gravityAttribute] : undefined;
      const baseGravity = gravAttr
        ? attributes.getAttributeValue(gravAttr as any, this.gravityAttribute)
        : ctx.gravity;
      const isFalling = velY <= 0.0;
      const effGravity = isFalling && player.slowFalling > 0 ? Math.min(0.01, baseGravity) : baseGravity;

      let restitution = entityBounciness;
      if (movementBeforeCollisions.y < 0.0) {
        const blockBelow = world.getBlock(player.pos.offset(0, -0.2, 0));
        const suppressesBounce = blockBelow != null && this.honeyblockId === blockBelow.type;
        if (-velY >= effGravity && !player.control.sneak && !suppressesBounce) {
          let blockRestitution = 0.0;
          if (blockBelow != null) {
            if (this.slimeBlockId === blockBelow.type) blockRestitution = 1.0;
            else if (this.bedIds.has(blockBelow.type)) blockRestitution = 0.75;
          }
          restitution = Math.max(restitution, blockRestitution);
        } else {
          restitution = 0.0;
        }
      }

      if (restitution > 0.0) {
        const portion = movement.y / velY;
        const gravityComp = portion * effGravity;
        const adAttr = this.airDragModifierAttribute ? player.attributes?.[this.airDragModifierAttribute] : undefined;
        const airDragModifier = adAttr
          ? attributes.getAttributeValue(adAttr as any, this.airDragModifierAttribute)
          : 1.0;
        const airDrag = computeModifiedFriction(0.9800000190734863, airDragModifier);
        const effectiveDrag = 1.0 + portion * (airDrag - 1.0);
        player.vel.y = (gravityComp - velY) * effectiveDrag * restitution;
      } else {
        player.vel.y = 0.0;
      }
    }

    // Rough fix for now: ignore this if we are flying.
    if (!player.flying) {
      this.checkInsideBlocks(player, world, posBeforeMove);
    }

    let blockSpeedFactor = 1.0;
    if (this.verGreaterThan("1.15.2")) {
      // soul_sand and honey are always 0.4 regardless of soul-speed; the slowdown is cancelled only via
      // the MOVEMENT_EFFICIENCY lerp below, not by gating here.
      const feetBlock = world.getBlock(new Vec3(player.pos.x, player.pos.y, player.pos.z));
      const feetIsWaterLike = feetBlock != null &&
        (feetBlock.type === this.waterId || feetBlock.type === this.bubblecolumnId);
      if (feetBlock && (this.honeyblockId === feetBlock.type || this.soulsandId === feetBlock.type)) {
        blockSpeedFactor = 0.4;
      }
      // When the feet block is water/bubble-column, do not consult the block below — water always keeps
      // speedFactor 1.0.
      if (blockSpeedFactor === 1.0 && !feetIsWaterLike) {
        const blockBelow = world.getBlock(this.getBlockBelowAffectingMovement(player, world));
        if (blockBelow && (this.honeyblockId === blockBelow.type || this.soulsandId === blockBelow.type)) {
          blockSpeedFactor = 0.4;
        }
      }
    }

    if (this.verGreaterThan("1.20.6")) {
      // MOVEMENT_EFFICIENCY defaults to 0 (not 1) when absent — the server omits it unless soul-speed is
      // active, and a wrong default of 1 would cancel the honey/soul-sand slowdown entirely.
      const meAttr = this.movementEfficiencyAttribute ? player.attributes?.[this.movementEfficiencyAttribute] : undefined;
      const factor = meAttr ? attributes.getAttributeValue(meAttr as any, this.movementEfficiencyAttribute) : 0
      blockSpeedFactor = blockSpeedFactor + factor * (1 - blockSpeedFactor);
    }

    player.vel.x *= blockSpeedFactor;
    player.vel.z *= blockSpeedFactor;
  }

  // localPlayer.java
  isCollidedHorizontallyMinor(state: IEntityState, var1: Vec3): boolean {
    if (!(state instanceof PlayerState)) return false;

    if (this.verGreaterThan("1.20.3")) { // apparently 1.20.4+ {
      const player = state as PlayerState;

      // @Override
      // protected boolean isHorizontalCollisionMinor(Vec3 var1) {
      //    float var2 = this.getYRot() * (float) (Math.PI / 180.0);
      //    double var3 = (double)Mth.sin(var2);
      //    double var5 = (double)Mth.cos(var2);
      //    double var7 = (double)this.xxa * var5 - (double)this.zza * var3;
      //    double var9 = (double)this.zza * var5 + (double)this.xxa * var3;
      //    double var11 = Mth.square(var7) + Mth.square(var9);
      //    double var13 = Mth.square(var1.x) + Mth.square(var1.z);
      //    if (!(var11 < 1.0E-5F) && !(var13 < 1.0E-5F)) {
      //       double var15 = var7 * var1.x + var9 * var1.z;
      //       double var17 = Math.acos(var15 / Math.sqrt(var11 * var13));
      //       return var17 < 0.13962634F;
      //    } else {
      //       return false;
      //    }
      // }

      const yawRad = Math.PI - player.yaw //* (Math.PI / 180);
      const sinYaw = Math.sin(yawRad);
      const cosYaw = Math.cos(yawRad);
      const xxa = player.prevHeading.forward
      const zza = player.prevHeading.strafe

      const xxaRot = xxa * cosYaw - zza * sinYaw;
      const zzaRot = zza * cosYaw + xxa * sinYaw;

      const horizSpeed = xxaRot ** 2 + zzaRot ** 2;
      const horizMovement = var1.x ** 2 + var1.z ** 2;
      if (horizSpeed >= 1e-5 && horizMovement >= 1e-5) {
        const dot = xxaRot * var1.x + zzaRot * var1.z;
        let angle = Math.acos(dot / Math.sqrt(horizSpeed * horizMovement));

        // unsure why this is needed, but this ends up matching.
        angle = Math.abs(angle - Math.PI / 2)
        return angle < 0.13962634; // magic number

      } else return false;
    }
    return false;

  }

  // Version-gated surface predicate: 1.21.11+ checks collision-shape-empty AND fluid-state-empty above;
  // pre-1.21.11 just checks isAir().
  private bubbleColumnAbove(world: World, blockPos: Vec3): boolean {
    const aboveBlock = world.getBlock(blockPos.offset(0, 1, 0));
    if (!this.verLessThan("1.21.11")) {
      const collisionEmpty = aboveBlock == null || aboveBlock.boundingBox === "empty";
      const fluidEmpty =
        aboveBlock == null ||
        !(aboveBlock.type === this.waterId ||
          this.waterLike.has(aboveBlock.type) ||
          aboveBlock.getProperties().waterlogged ||
          aboveBlock.type === this.lavaId);
      return collisionEmpty && fluidEmpty;
    }
    return aboveBlock == null || aboveBlock.name === "air";
  }

  // Applies one bubble-column push for a single visited column cell.
  private applyBubbleColumn(player: PlayerState, world: World, block: Block, blockPos: Vec3) {
    // bubble_column "drag" property defaults to true when absent.
    const dragDown = block.getProperties().drag !== false;
    if (this.bubbleColumnAbove(world, blockPos)) {
      player.vel.y = dragDown
        ? Math.max(-0.9, player.vel.y - 0.03)
        : Math.min(1.8, player.vel.y + 0.1);
    } else {
      // resetFallDistance() intentionally omitted: fallDistance is not tracked by this engine.
      player.vel.y = dragDown
        ? Math.max(-0.3, player.vel.y - 0.03)
        : Math.min(0.7, player.vel.y + 0.06);
    }
  }

  // Applies the bubble-column Y push using the FINAL post-move bounding box, after the full travel step —
  // this must run last, not mid-move, so travel's water drag/buoyancy does not corrupt the pushed velocity.
  applyBubbleColumnEffects(player: PlayerState, world: World) {
    if (player.flying) return; // bubble-column push is skipped while flying.
    if (this.bubblecolumnId < 0) return;
    const deflate = this.verLessThan("1.21.11") ? 1e-7 : 1e-5;
    const aabb = player.getBB().expand(-deflate, -deflate, -deflate);
    const [minAABB, maxAABB] = aabb.minAndMaxArrays();
    const blockPos = new Vec3(0, 0, 0);
    for (blockPos.y = Math.floor(minAABB[1]); blockPos.y <= Math.floor(maxAABB[1]); ++blockPos.y) {
      for (blockPos.x = Math.floor(minAABB[0]); blockPos.x <= Math.floor(maxAABB[0]); ++blockPos.x) {
        for (blockPos.z = Math.floor(minAABB[2]); blockPos.z <= Math.floor(maxAABB[2]); ++blockPos.z) {
          const block = world.getBlock(blockPos);
          if (block == null) continue;
          if (this.bubblecolumnId === block.type) {
            this.applyBubbleColumn(player, world, block, blockPos);
          }
        }
      }
    }
  }

  checkInsideBlocks(player: PlayerState, world: World, posBeforeMove?: Vec3) {
    // Deflate the bbox by 1e-5 on 1.21.11+ (1e-7 pre-1.21.11) to match the final post-move scan.
    // stepOn dispatch runs before the entityInside scan, gated on onGround; only slime blocks override
    // stepOn (damping horizontal velocity when |vel.y| < 0.1 and not sneaking).
    if (player.onGround && !player.control.sneak) {
      const stepBlock = world.getBlock(new Vec3(player.pos.x, Math.floor(player.pos.y - 0.2), player.pos.z));
      if (stepBlock && this.slimeBlockId === stepBlock.type) {
        const absDeltaY = Math.abs(player.vel.y);
        if (absDeltaY < 0.1) {
          const scale = 0.4 + absDeltaY * 0.2;
          player.vel.x *= scale;
          player.vel.z *= scale;
        }
      }
    }

    const deflate = this.verLessThan("1.21.11") ? 1e-7 : 1e-5;
    const aabb = player.getBB().expand(-deflate, -deflate, -deflate);
    let [minAABB, maxAABB] = aabb.minAndMaxArrays();
    if (posBeforeMove) {
      const w = player.halfWidth;
      const h = aabb.maxY - aabb.minY;
      const pMinX = posBeforeMove.x - w + deflate, pMaxX = posBeforeMove.x + w - deflate;
      const pMinY = posBeforeMove.y + deflate, pMaxY = posBeforeMove.y + h + deflate;
      const pMinZ = posBeforeMove.z - w + deflate, pMaxZ = posBeforeMove.z + w - deflate;
      minAABB = [Math.min(minAABB[0], pMinX), Math.min(minAABB[1], pMinY), Math.min(minAABB[2], pMinZ)];
      maxAABB = [Math.max(maxAABB[0], pMaxX), Math.max(maxAABB[1], pMaxY), Math.max(maxAABB[2], pMaxZ)];
    }
    const blockPos = new Vec3(0, 0, 0);
    for (blockPos.y = Math.floor(minAABB[1]); blockPos.y <= Math.floor(maxAABB[1]); ++blockPos.y) {
      for (blockPos.x = Math.floor(minAABB[0]); blockPos.x <= Math.floor(maxAABB[0]); ++blockPos.x) {
        for (blockPos.z = Math.floor(minAABB[2]); blockPos.z <= Math.floor(maxAABB[2]); ++blockPos.z) {
          const block = world.getBlock(blockPos);
          if (block == null) continue;
          if (this.webId === block.type) {
            // WebBlock::entityInside
            player.stuckSpeedMultiplier = player.weaving > 0
              ? new Vec3(0.5, 0.25, 0.5)
              : new Vec3(0.25, 0.05000000074505806, 0.25);
          } else if (this.bubblecolumnId === block.type) {
            // Bubble-column push is intentionally NOT applied here; it's deferred to
            // applyBubbleColumnEffects() (called after the full travel step), so travel's water
            // drag/buoyancy cannot corrupt it.
          } else if (this.honeyblockId === block.type) {
            // Honey slide is intentionally NOT applied here; it's deferred to applyHoneySlideEffects()
            // (called after the full travel step) so travel's gravity/drag cannot corrupt it. (Speed/jump
            // factor are separate & unaffected.)
          } else if (this.berryBushId === block.type) {
            // BerryBushBlock::entityInside
            player.stuckSpeedMultiplier = new Vec3(0.800000011920929, 0.75, 0.800000011920929); // magic number
          } else if (this.powderSnowId === block.type) {
            // PowderSnowBlock::entityInside
            player.isInPowderSnow = true;
            const feetBlock = world.getBlock(new Vec3(player.pos.x, player.pos.y, player.pos.z));
            if (feetBlock && this.powderSnowId === feetBlock.type) {
              player.stuckSpeedMultiplier = new Vec3(0.8999999761581421, 1.5, 0.8999999761581421);
            }
          }
        }
      }
    }
  }

  collideBoundingBox(world: World, bb: AABB, movement: Vec3, colliders: AABB[] = [], collisionCtx?: CollisionCtx): Vec3 {
    const queryBB = bb.expandTowards(movement);

    const combinedColliders = [...colliders];

    const blockCollisions = this.getSurroundingBBs(queryBB, world, true, collisionCtx);
    for (const block of blockCollisions) {
      combinedColliders.push(block);
    }

    // console.log('queryBB', queryBB, combinedColliders.length)

    return this.collideWithShapes(movement, bb, combinedColliders);
  }


  private collideWithShapes(movement: Vec3, bb: AABB, colliders: AABB[] = []): Vec3 {
    if (colliders.length === 0) {
      return movement;
    }

    let dx = movement.x;
    let dy = movement.y;
    let dz = movement.z;

    if (dy !== 0.0) {
      dy = this.shapeCollide(1, bb, colliders, dy);
      if (dy !== 0.0) {
        bb = bb.moveCoords(0, dy, 0);
      }
    }

    const prioritizeZ = Math.abs(dx) < Math.abs(dz);
    if (prioritizeZ && dz !== 0.0) {
      dz = this.shapeCollide(2, bb, colliders, dz);
      if (dz !== 0.0) {
        bb = bb.moveCoords(0, 0, dz);
      }
    }

    if (dx !== 0.0) {
      dx = this.shapeCollide(0, bb, colliders, dx);
      if (!prioritizeZ && dx !== 0.0) {
        bb = bb.moveCoords(dx, 0, 0);
      }
    }

    if (!prioritizeZ && dz !== 0.0) {
      dz = this.shapeCollide(2, bb, colliders, dz);
    }

    // console.log('shift', dx, dy, dz)

    return new Vec3(dx, dy, dz);
  }

  shapeCollide(axis: number, bb: AABB, colliders: AABB[], movement: number): number {
    if (Math.abs(movement) < 1e-7) {
      return 0.0;
    }

    movement = this.voxelShapeCollide(axis, bb, movement, colliders);

    return movement;
  }



  /**
   * Handles collision detection and response along a single axis.
   * @param axis The axis to check for collision (0 = X, 1 = Y, 2 = Z)
   * @param bb The bounding box that's moving
   * @param movement The proposed movement amount along the specified axis
   * @param colliders Array of AABBs to check for collisions with
   * @returns The adjusted movement amount that prevents collisions
   */
  private voxelShapeCollide(axis: number, bb: AABB, movement: number, colliders: AABB[]): number {
    // If there's no movement or no colliders, return the original movement
    if (movement === 0 || colliders.length === 0) {
      return movement;
    }

    let adjustedMovement = movement;

    for (const collider of colliders) {
      // Calculate offset manually based on the axis
      if (axis === 0) { // X axis
        // Check if there's overlap in Y and Z axes (perpendicular axes are shrunk by 1e-7)
        if (bb.maxY - 1e-7 > collider.minY && bb.minY + 1e-7 < collider.maxY &&
          bb.maxZ - 1e-7 > collider.minZ && bb.minZ + 1e-7 < collider.maxZ) {

          if (movement > 0 && bb.maxX + movement > collider.minX && bb.maxX <= collider.minX) {
            // Moving right and will collide
            adjustedMovement = Math.min(adjustedMovement, collider.minX - bb.maxX);
          }
          else if (movement < 0 && bb.minX + movement < collider.maxX && bb.minX >= collider.maxX) {
            // Moving left and will collide
            adjustedMovement = Math.max(adjustedMovement, collider.maxX - bb.minX);
          }
        }
      }
      else if (axis === 1) { // Y axis
        // Check if there's overlap in X and Z axes (perpendicular axes are shrunk by 1e-7)
        if (bb.maxX - 1e-7 > collider.minX && bb.minX + 1e-7 < collider.maxX &&
          bb.maxZ - 1e-7 > collider.minZ && bb.minZ + 1e-7 < collider.maxZ) {

          if (movement > 0 && bb.maxY + movement > collider.minY && bb.maxY <= collider.minY) {
            // Moving up and will collide
            adjustedMovement = Math.min(adjustedMovement, collider.minY - bb.maxY);
          }
          else if (movement < 0 && bb.minY + movement < collider.maxY && bb.minY >= collider.maxY) {
            // Moving down and will collide
            adjustedMovement = Math.max(adjustedMovement, collider.maxY - bb.minY);
          }
        }
      }
      else { // Z axis
        // Check if there's overlap in X and Y axes (perpendicular axes are shrunk by 1e-7)
        if (bb.maxX - 1e-7 > collider.minX && bb.minX + 1e-7 < collider.maxX &&
          bb.maxY - 1e-7 > collider.minY && bb.minY + 1e-7 < collider.maxY) {

          if (movement > 0 && bb.maxZ + movement > collider.minZ && bb.maxZ <= collider.minZ) {
            // Moving forward and will collide
            adjustedMovement = Math.min(adjustedMovement, collider.minZ - bb.maxZ);
          }
          else if (movement < 0 && bb.minZ + movement < collider.maxZ && bb.minZ >= collider.maxZ) {
            // Moving backward and will collide
            adjustedMovement = Math.max(adjustedMovement, collider.maxZ - bb.minZ);
          }
        }
      }
    }

    // if (axis === 0) {
    //   ('test')
    //   console.log(bb, colliders,)
    //   console.log('movement:', movement, 'adjustedMovement', adjustedMovement)
    //   console.log('end test')
    //   console.log
    // }

    return adjustedMovement;
  }


  collideOneAxis(movedAABB: AABB, movement: Vec3, axis: number, colliders: AABB[]) {
    const minAABB = movedAABB.minPoint().toArray();
    const maxAABB = movedAABB.maxPoint().toArray();
    const movementLst = movement.toArray();

    const thisAxis = axis % 3;
    const axis1 = (axis + 1) % 3;
    const axis2 = (axis + 2) % 3;

    for (const collider of colliders) {
      if (Math.abs(movementLst[thisAxis]) < 1e-7) {
        movementLst[thisAxis] = 0;
      }
      const minCollider = collider.minPoint().toArray();
      const maxCollider = collider.maxPoint().toArray();

      const cond1 = movementLst[thisAxis] > 0.0 && maxAABB[thisAxis] - 1e-7 <= minCollider[thisAxis];
      const cond2 = movementLst[thisAxis] < 0.0 && minAABB[thisAxis] + 1e-7 >= maxCollider[thisAxis];
      if (
        maxAABB[axis1] - 1e-7 > minCollider[axis1] &&
        minAABB[axis1] + 1e-7 < maxCollider[axis1] &&
        maxAABB[axis2] - 1e-7 > minCollider[axis2] &&
        minAABB[axis2] + 1e-7 < maxCollider[axis2]
      ) {
        if (cond1) {
          movementLst[thisAxis] = Math.min(minCollider[thisAxis] - maxAABB[thisAxis], movementLst[thisAxis]);
        } else if (cond2) {
          movementLst[thisAxis] = Math.max(maxCollider[thisAxis] - minAABB[thisAxis], movementLst[thisAxis]);
        }
      }
    }
    movement.x = movementLst[0];
    movement.y = movementLst[1];
    movement.z = movementLst[2];
    // deviation. pretty bad code but its accurate.
    movedAABB.translate(thisAxis == 0 ? movementLst[0] : 0, thisAxis == 1 ? movementLst[1] : 0, thisAxis == 2 ? movementLst[2] : 0);
  }

  applyInputs(inputStrength: number, player: PlayerState) {
    // Use flySpeed for horizontal movement when flying
    if (player.flying) {
      inputStrength *= player.flySpeed * 40;
    }

    const inputVector = new Vec3(player.heading.strafe, 0, player.heading.forward);

    if (player.isUsingItem && !player.isPassenger) {
      inputVector.scale(Math.fround(player.itemUseSpeedMultiplier));
    }

    // This reproduces the input-then-normalize pipeline exactly only for boolean, axis-aligned headings
    // (forward/strafe in {-1,0,+1}) — fractional/analog headings (e.g. eased pathfinder input) are NOT
    // guaranteed to match and would diverge until proper square-movement scaling is ported in.
    const sqrNorm = inputVector.norm() ** 2;
    if (sqrNorm < 1e-7) {
      return;
    }
    if (sqrNorm > 1) {
      inputVector.normalize();
    }
    inputVector.scale(inputStrength);

    const yaw = Math.PI - player.yaw;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);

    const offsetX = inputVector.x * cosYaw - inputVector.z * sinYaw;
    const offsetZ = inputVector.z * cosYaw + inputVector.x * sinYaw;
    player.vel.x += offsetX;
    player.vel.z += offsetZ;
  }

  isInClimbable(player: PlayerState, world: World): boolean {
    if (player.gameMode === "spectator") {
      return false;
    }

    const feetBlock = world.getBlock(new Vec3(player.pos.x, player.pos.y, player.pos.z));
    if (feetBlock == null) return false;

    if (player.fallFlying && this.canGlideThroughSet.has(feetBlock.type)) return false;

    // TODO: if trapdoor AND below block is a ladder with the same facing property
    // as the trapdoor then the trapdoor is a climbable block too.
    return this.climbableSet.has(feetBlock.type);
  }

  getSupportingBlockPos(world: World, feetSliceAABB: AABB): Vec3 | null {
    const aabb = feetSliceAABB;
    const [minAABB, maxAABB] = aabb.minAndMaxArrays();
    const blockPos = new Vec3(0, 0, 0);
    let minDistance = Infinity;
    let ret = null;
    for (blockPos.y = Math.floor(minAABB[1] - 1); blockPos.y <= Math.floor(maxAABB[1]); ++blockPos.y) {
      for (blockPos.x = Math.floor(minAABB[0]); blockPos.x <= Math.floor(maxAABB[0]); ++blockPos.x) {
        for (blockPos.z = Math.floor(minAABB[2]); blockPos.z <= Math.floor(maxAABB[2]); ++blockPos.z) {
          const block = world.getBlock(blockPos);
          if (block == null || block.boundingBox === "empty") continue;
          // console.log('checking block', block.name, block.position)
          for (const shape of block.shapes) {
            const bb1 = AABB.fromShape(shape).translateVec(blockPos);
            if (aabb.collides(bb1)) {
              const distance = aabb.getCenter().distanceTo(bb1.getCenter());
              if (distance < minDistance) {
                minDistance = distance;
                ret = blockPos.clone();
              }
            }
          }
        }
      }
    }
    return ret;
  }

  simulate(entity: EPhysicsCtx, world: World): IEntityState {
    entity.state.attributes ??= {}
    this.physicsTick(entity, world);
    entity.state.age++;
    return entity.state;
  }
}
