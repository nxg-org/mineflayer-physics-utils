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
import { IEntityState } from "../states";
import { IPhysics } from "./IPhysics";
import { PlayerPoses, PlayerState, convInpToAxes, getCollider } from "../states";
import { PhysicsWorldSettings } from "../settings";

type CheapEffectNames = keyof ReturnType<typeof getStatusEffectNamesForVersion>;
type CheapEnchantmentNames = keyof ReturnType<typeof getEnchantmentNamesForVersion>;

type Heading = { forward: number; strafe: number };
type World = {
  getBlock: (pos: Vec3) => Block;
};

function extractAttribute(ctx: IPhysics, genericName: string) {
  const data = ctx.data.attributesByName[genericName] as any;
  if (data == null) return null;
  if (ctx.supportFeature("attributesPrefixedByMinecraft")) {
    return `minecraft:${data.resource}`;
  } else {
    return data.resource;
  }
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
  public stepHeightAttribute: string;
  public supportFeature: ReturnType<typeof makeSupportFeature>;
  public blockSlipperiness: { [name: string]: number };

  protected bedId: number;
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
  protected bubblecolumnId: number;
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
    this.stepHeightAttribute = extractAttribute(this, "stepHeight");

    this.blockSlipperiness = {};
    this.slimeBlockId = blocksByName.slime_block ? blocksByName.slime_block.id : blocksByName.slime.id;
    this.blockSlipperiness[this.slimeBlockId] = 0.8;
    this.blockSlipperiness[blocksByName.ice.id] = 0.98;
    this.blockSlipperiness[blocksByName.packed_ice.id] = 0.98;

    // 1.9+
    if (blocksByName.frosted_ice) this.blockSlipperiness[blocksByName.frosted_ice.id] = 0.98;

    // 1.13+
    if (blocksByName.blue_ice) this.blockSlipperiness[blocksByName.blue_ice.id] = 0.989;

    this.bedId = blocksByName.bed?.id ?? blocksByName.white_bed?.id ?? -1;
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
    return new AABB(-w, 0, -w, w, entity.height, w).translate(pos.x, pos.y, pos.z);
  }

  setPositionToBB(entity: EPhysicsCtx, bb: AABB, pos: { x: number; y: number; z: number }) {
    const halfWidth = entity.getHalfWidth();
    pos.x = bb.minX + halfWidth;
    pos.y = bb.minY;
    pos.z = bb.minZ + halfWidth;
  }

  getSurroundingBBs(queryBB: AABB, world: World): AABB[] {
    const surroundingBBs = [];
    const cursor = new Vec3(0, 0, 0);
    for (cursor.y = Math.floor(queryBB.minY) - 1; cursor.y <= Math.floor(queryBB.maxY); ++cursor.y) {
      for (cursor.z = Math.floor(queryBB.minZ); cursor.z <= Math.floor(queryBB.maxZ); ++cursor.z) {
        for (cursor.x = Math.floor(queryBB.minX); cursor.x <= Math.floor(queryBB.maxX); ++cursor.x) {
          const block = world.getBlock(cursor);
          if (block) {
            const blockPos = block.position;
            for (const shape of block.shapes) {
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
    if (ignoreLiquid) return this.getSurroundingBBs(bb, world).length === 0;
    else return this.getSurroundingBBs(bb, world).length === 0 && this.getWaterInBB(bb, world).length === 0;
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

    if (ctx.state.elytraFlying) {
      // TODO: entity check for fireworks
      // TODO: check if firework is attached to player
      if (false) {
        // player->speed += player->front_vector * 0.1 + (player->front_vector * 1.5 - player->speed) * 0.5;
      }
    }

    const playerFlag = ctx.entityType.type === "player";

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
    const swimPose = getCollider(PlayerPoses.SWIMMING, player.pos).expand(-1e-7, -1e-7, -1e-7);
    if (this.worldIsFree(world, swimPose, false)) {
      // update poses
      let currentPose: PlayerPoses;
      // player->GetDataSharedFlagsIdImpl(EntitySharedFlagsId::FallFlying)
      if (player.fallFlying) {
        currentPose = PlayerPoses.FALL_FLYING;
      }
      // (player->GetSleepingPosIdImpl()
      // this is based on metadata which I currently do not have access to.
      else if (player.pose === PlayerPoses.SLEEPING) {
        currentPose = PlayerPoses.SLEEPING;
      } else if (this.isSwimmingAndNotFlying(ctx, world)) {
        currentPose = PlayerPoses.SWIMMING;
      }
      // player->GetDataLivingEntityFlagsImpl() & 0x04
      // no clue.
      else if (false) {
        currentPose = PlayerPoses.SPIN_ATTACK;
      } else if (player.control.sneak && !player.flying) {
        currentPose = PlayerPoses.SNEAKING;
      } else {
        currentPose = PlayerPoses.STANDING;
      }

      const poseBB = getCollider(currentPose, player.pos).expand(-1e-7, -1e-7, -1e-7);
      if (player.gameMode === "spectator" || this.worldIsFree(world, poseBB, false)) {
        player.pose = currentPose;
      } else {
        const crouchBB = getCollider(PlayerPoses.SNEAKING, player.pos).expand(-1e-7, -1e-7, -1e-7);
        if (this.worldIsFree(world, crouchBB, false)) {
          player.pose = PlayerPoses.SNEAKING;
        } else {
          player.pose = PlayerPoses.SWIMMING;
        }
      }
    }
  }

  private fluidPhysics(ctx: EPhysicsCtx, world: World, water: boolean) {
    const player = ctx.state as PlayerState;
    const aabb = getCollider(player.pose, player.pos).expand(-1e-3, -1e-3, -1e-3); // -0.001
    if (water) {
      player.isInWater = false;
      player.isUnderWater = false;
    } else {
      player.isInLava = false;
      player.isUnderLava = false;
    }

    const minAABB = aabb.minPoint();
    const maxAABB = aabb.maxPoint();
    const eyeHeight = player.eyeHeight;

    const waterCond = (block: Block) => block.type === this.waterId || this.waterLike.has(block.type) || block.getProperties().waterlogged;
    const lavaCond = (block: Block) => block.type === this.lavaId;

    const push = new Vec3(0, 0, 0);
    const blockPos = new Vec3(0, 0, 0);
    let fluidRelativeHeight = 0.0;
    let numPush = 0;
    for (blockPos.x = Math.floor(minAABB.x); blockPos.x <= Math.floor(maxAABB.x); ++blockPos.x) {
      for (blockPos.y = Math.floor(minAABB.y); blockPos.y <= Math.floor(maxAABB.y); ++blockPos.y) {
        for (blockPos.z = Math.floor(minAABB.z); blockPos.z <= Math.floor(maxAABB.z); ++blockPos.z) {
          const block = world.getBlock(blockPos);
          const waterRes = waterCond(block);
          const lavaRes = lavaCond(block);
          if (block == null || (waterRes && !water) || (lavaRes && water) || (!waterRes && !lavaRes)) {
            continue;
          }

          let fluidHeight = 0.0;
          const blockAbv = world.getBlock(blockPos.offset(0, 1, 0));
          if ((blockAbv != null && waterCond(blockAbv) && waterRes) || (lavaCond(blockAbv) && lavaRes)) {
            fluidHeight = 1.0;
          } else {
            fluidHeight = this.getLiquidHeightPcent(block);
          }

          if (fluidHeight + blockPos.y < minAABB.y) {
            continue;
          }

          if (water) {
            player.isInWater = true;
            if (fluidHeight + blockPos.y > eyeHeight) {
              player.isUnderWater = true;
            }
          } else {
            player.isInLava = true;
            if (fluidHeight + blockPos.y > eyeHeight) {
              player.isUnderLava = true;
            }
          }

          fluidRelativeHeight = Math.max(fluidHeight + blockPos.y - minAABB.y, fluidRelativeHeight);

          if (player.flying) continue;

          const currentPush = this.getFlow(block, world);
          if (fluidRelativeHeight < 0.4) {
            currentPush.scale(fluidRelativeHeight);
          }
          push.add(currentPush);
          numPush++;
        }
      }
    }

    if (push.norm() > 0.0) {
      if (numPush > 0) {
        push.scale(1.0 / numPush);
      }
      if (water) {
        push.scale(0.014);
      } else {
        const worldInUltraWarm = false; // TODO: implement this (bot world relevance)
        push.scale(worldInUltraWarm ? 0.007 : 0.0023333333333333335);
      }
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

  getFlow(block: Block, world: World) {
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

  getLiquidHeightPcent(block: Block) {
    return 1 - (this.getRenderedDepth(block) + 1) / 9;
  }

  getRenderedDepth(block: Block) {
    if (!block) return -1;
    if (this.waterLike.has(block.type)) return 0;
    if (block.getProperties().waterlogged) return 0;
    if (block.type !== this.waterId) return -1;
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

  private localPlayerAIStep(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    const heading = convInpToAxes(player);
    player.heading = heading;

    // moved into AiStep since it's tied to player behavior. Strictly, is Player::updateSwimming.
    this.updateSwimming(player, world);

    this.inputsToCrouch(ctx, heading, world);
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

    // TODO: find a good way to implement this.
    player.prevHeading.forward = heading.forward;
    player.prevHeading.strafe = heading.strafe;
    player.prevControl.jump = player.control.jump;
    player.prevControl.sneak = player.control.sneak;

    // livingEntity::AiStep
    {
      player.jumpTicks = Math.max(0, player.jumpTicks - 1);
      if (Math.abs(player.vel.x) < ctx.worldSettings.negligeableVelocity) {
        player.vel.x = 0;
      }
      if (Math.abs(player.vel.y) < ctx.worldSettings.negligeableVelocity) {
        player.vel.y = 0;
      }
      if (Math.abs(player.vel.z) < ctx.worldSettings.negligeableVelocity) {
        player.vel.z = 0;
      }

      this.inputsToJump(player, world, ctx.worldSettings);

      // TODO: properly implement heading handler. forward-axis is forward, left-axis = strafe. weird naming.
      heading.forward *= 0.98;
      heading.strafe *= 0.98;
      // player->inputs.forward_axis *= 0.98f;
      // player->inputs.left_axis *= 0.98f;

      // Compensate water downward speed depending on looking direction (?)
    
      if (this.isSwimmingAndNotFlying(ctx, world)) {
        const mSinPitch = player.pitch;
        let condition = mSinPitch < 0.0 || player.control.jump;
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

      const velY = player.vel.y;
      this.movePlayer(ctx, world); // TODO: should be in player-specific logic??
      if (player.flying) {
        player.vel.y = 0.6 * velY;
        /* player->SetDataSharedFlagsIdImpl(EntitySharedFlagsId::FallFlying, false); */ player.fallFlying = false;
      }

      player.onClimbable = this.isInClimbable(player, world);
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
  }

  private inputsToCrouch(ctx: EPhysicsCtx, heading: Heading, world: World) {
    const player = ctx.state as PlayerState;
    if (this.verGreaterThan("1.13.2")) {
      const sneakBb = getCollider(PlayerPoses.SNEAKING, player.pos);
      const standBb = getCollider(PlayerPoses.STANDING, player.pos);
      sneakBb.expand(-1e-7, -1e-7, -1e-7);
      standBb.expand(-1e-7, -1e-7, -1e-7);

      player.crouching =
        !this.isSwimmingAndNotFlying(ctx, world) &&
        this.worldIsFree(world, sneakBb, false) &&
        (player.prevControl.sneak || !this.worldIsFree(world, standBb, false));
    } else {
      player.crouching = !this.isSwimmingAndNotFlying(ctx, world) && player.prevControl.sneak;
    }

    // Determine if moving slowly
    let isMovingSlowly: boolean;
    if (this.verGreaterThan("1.13.2")) {
      isMovingSlowly = player.crouching || (player.pose === PlayerPoses.SWIMMING && !player.isInWater);
    } else {
      isMovingSlowly = player.crouching;
    }

    // Handle post-1.21.3 sprinting conditions
    if (this.verGreaterThan("1.21.3")) {
      // TODO: just use stored blindness effect.
      const hasBlindness = this.getEffectLevel(CheapEffects.BLINDNESS, player.effects) > 0;

      // Stop sprinting when crouching fix in 1.21.4+
      if (player.fallFlying || hasBlindness || isMovingSlowly) {
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
        sneakCoefficient = player.attributes?.sneakingSpeed.value ?? 0.3;
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
    const canStartSprinting =
      /* !player->GetDataSharedFlagsIdImpl(EntitySharedFlagsId::Sprinting) */ !player.sprinting &&
      heading.forward >= (player.isInWater ? 1e-5 : 0.8) &&
      (player.mayFly || player.food > 6) &&
      /* !player->GetDataSharedFlagsIdImpl(EntitySharedFlagsId::FallFlying)*/ !player.fallFlying &&
      !player.blindness;

    // TODO: keep track of previous movement values?
    // const couldSprintPrevious = player.prevControl.forward >= (!!player.isUnderWater ? 1e-5 : 0.8); /*  player->previous_forward >= (player->under_water ? 1e-5f : 0.8f); */

    let couldSprintPrevious;
    if (player.isUnderWater) {
      couldSprintPrevious = player.prevHeading.forward >= 1e-5;
    } else {
      couldSprintPrevious = player.prevHeading.forward >= 0.8;
    }
    // start sprinting if possible
    if (
      canStartSprinting &&
      player.control.sprint &&
      ((!player.isInWater ||
        player.isUnderWater) ||
        ((player.onGround || player.isUnderWater) && !player.prevControl.sneak && !couldSprintPrevious))
    ) {
      this.setSprinting(ctx, true);
    }

    // stop sprinting if necessary
    if (player.sprinting) {
      const stopSprintCond = heading.forward <= 1e-5 || (player.food <= 6 && !player.mayFly);
      if (this.isSwimmingAndNotFlying(ctx, world)) {
        if ((!player.onGround && !player.control.sneak && stopSprintCond) || !player.isInWater) {
          this.setSprinting(ctx, false);
        }
      } else if (stopSprintCond || player.isCollidedHorizontally || (player.isInWater && !player.isUnderWater)) {
        this.setSprinting(ctx, false);
      }
    }
  }

  /**
   * TODO: almost certainly unfinished.
   * @param player
   * @param value
   */
  setSprinting(ctx: EPhysicsCtx, value: boolean) {
    const player = ctx.state as PlayerState;
    let attr = player.attributes[this.movementSpeedAttribute];
    if (attr != null) attributes.deleteAttributeModifier(attr, ctx.worldSettings.sprintingUUID);
    else attr = attributes.createAttributeValue(ctx.worldSettings.playerSpeed);
    if (value) {
      attributes.addAttributeModifier(attr, {
        uuid: ctx.worldSettings.sprintingUUID,
        amount: ctx.worldSettings.sprintSpeed,
        operation: 2,
      });
    }

    player.attributes[this.movementSpeedAttribute] = attr;
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
            player.flyJumpTriggerTime = 7;
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
      const hasElytra = player.elytraEquipped;
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

      if (player.control.jump && !player.flying) {
        if (player.isInWater || player.isInLava) {
          player.vel.y += 0.03999999910593033; // magic number
        } else if (player.onGround && player.jumpTicks === 0) {
          let blockJumpFactor = 1.0;
          const jumpBoost = 0.1 * player.jumpBoost; // in mineflayer, level 1 is 1, not 0.

          // get below block
          const blFeet = world.getBlock(new Vec3(player.pos.x, player.pos.y, player.pos.z));
          if (blFeet && this.honeyblockId !== blFeet.type) {
            const blBelow = world.getBlock(this.getBlockBelowAffectingMovement(player, world));
            if (blBelow && this.honeyblockId === blBelow.type) {
              blockJumpFactor = 0.4;
            }
          } else {
            blockJumpFactor = 0.4;
          }

          if (this.verLessThan("1.20.5")) {
            player.vel.y = Math.fround(0.42) * blockJumpFactor + jumpBoost;
            if (player.sprinting) {
              const yawRad = Math.PI - player.yaw; // should already be in yaw. MINEFLAYER SPECIFC CHANGE, MATH.PI -
              // potential inconsistency here. This may not be accurate.
              const offsetX = Math.fround(Math.sin(yawRad)) * 0.2;
              const offsetZ = Math.fround(Math.cos(yawRad)) * 0.2;
              player.vel.x -= offsetX
              player.vel.z += offsetZ
            }
          } else {
            // something about getting an attribute for jump strength?
            const jumpPower = entity.attributes[this.jumpStrengthAttribute].value * blockJumpFactor + jumpBoost;
            if (jumpPower > 1e-5) {
              player.vel.y = jumpPower;
              if (player.sprinting) {
                const yawRad = Math.PI - player.yaw; // should already be in yaw. MINEFLAYER SPECIFC CHANGE, MATH.PI -
                player.vel.x -= Math.sin(yawRad) * 0.2;
                player.vel.z += Math.cos(yawRad) * 0.2;
              }
            }
            player.jumpTicks = worldSettings.autojumpCooldown;
          }
        } else {
          player.jumpTicks = 0;
        }
      }
    }
  }

  private getBlockBelowAffectingMovement(entity: IEntityState, world: World) {
    if (entity.supportingBlockPos != null) {
      return entity.supportingBlockPos.offset(0, -0.500001, 0);
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
    let attribute;
    if (entity.state.attributes && entity.state.attributes[this.movementSpeedAttribute]) {
      // Use server-side player attributes
      attribute = entity.state.attributes[this.movementSpeedAttribute];
    } else {
      // Create an attribute if the player does not have it
      //TODO: Generalize to all entities.
      attribute = attributes.createAttributeValue(entity.worldSettings.playerSpeed);
    }
    // Client-side sprinting (don't rely on server-side sprinting)
    // setSprinting in Livingentity.state.java
    //TODO: Generalize to all entities.
    attribute = attributes.deleteAttributeModifier(attribute, entity.worldSettings.sprintingUUID); // always delete sprinting (if it exists)
    if (entity.state.control.sprint) {
      if (!attributes.checkAttributeModifier(attribute, entity.worldSettings.sprintingUUID)) {
        attribute = attributes.addAttributeModifier(attribute, {
          uuid: entity.worldSettings.sprintingUUID,
          amount: entity.worldSettings.sprintSpeed,
          operation: 2,
        });
      }
    }
    // Calculate what the speed is (0.1 if no modification)
    const attributeSpeed = attributes.getAttributeValue(attribute);
    return attributeSpeed;
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
      let gravity: number;
      if (this.verLessThan("1.20.5")) {
        gravity = goingDown && hasSlowFalling ? 0.01 : ctx.gravity;
      } else {
        gravity = goingDown && hasSlowFalling ? Math.min(0.01, ctx.gravity) : ctx.gravity;
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
          depthStriderMult = player.attributes[this.waterMovementEfficiencyAttribute].value;
        }

        if (!player.onGround) {
          waterSlowDown += (0.54600006 - waterSlowDown) * depthStriderMult; // magic number
          const movementSpeed = player.attributes[this.movementSpeedAttribute].value;
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

        if (!player.sprinting) {
          // this logic does not look entirely correct. I believe this is an attempt at version-agnostic water gravity.
          // originally, the neg. vel value here was hardcoded.
          // if (goingDown &&
          //   Math.abs(player.vel.y - 0.005) >= ectx.worldSettings.negligeableVelocity &&
          //   Math.abs(player.vel.y - gravity / 16) < ectx.worldSettings.negligeableVelocity) {
          //     player.vel.y -= ectx.worldSettings.negligeableVelocity;
          //   } else {
          //     player.vel.y -= gravity / 16
          //   }

          // because of this, I will implement my own version.
          // if (goingDown) {
            player.vel.y -= ctx.waterGravity;
          // }
        }

        const bb = player.getBB().expand(-1e-7, -1e-7, -1e-7);
        bb.translate(0, 0.6000000238418579 - player.pos.y + initY, 0);
        bb.translateVec(player.vel);
        if (player.isCollidedHorizontally && this.worldIsFree(world, bb, true)) {
          player.vel.y = ctx.worldSettings.outOfLiquidImpulse;
        }
      } else if (player.isInLava && !player.flying) {
        const initY = player.pos.y;
        this.applyInputs(0.02, player);
        this.applyMovement(ctx, world);
        player.vel.scale(0.5);
        player.vel.y -= ctx.lavaGravity;

        const bb = player.getBB().expand(-1e-7, -1e-7, -1e-7);
        bb.translate(0, 0.6000000238418579 - player.pos.y + initY, 0); // Math.fround(0.60)
        bb.translateVec(player.vel);
        if (player.isCollidedHorizontally && this.worldIsFree(world, bb, true)) {
          player.vel.y = ctx.worldSettings.outOfLiquidImpulse;
        }
      }
      // elytra flying.
      else if (player.fallFlying) {
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

        if (player.pitch < 0.0 && cosPitchFromLength > 0.0) {
          const deltaSpeed = hVel * -lookDir.y * 0.04;
          player.vel.x += (lookDir.x * deltaSpeed) / cosPitchFromLength;
          player.vel.z += (lookDir.z * deltaSpeed) / cosPitchFromLength;
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

        if (player.onGround) {
          player.fallFlying = false;
        }
      } else {
        const blockBelow = world.getBlock(this.getBlockBelowAffectingMovement(player, world));
        // deviation. using our stores slipperiness values.
        const friction = blockBelow
          ? this.blockSlipperiness[blockBelow.type] ?? ctx.worldSettings.defaultSlipperiness
          : ctx.worldSettings.defaultSlipperiness;
        const inertia = player.onGround ? friction * ctx.airborneInertia : ctx.airborneInertia;

        // deviation, adding additional logic for changing attribute values.
        const movementSpeedAttr = this.getMovementSpeedAttribute(ctx);

        let inputStrength: number;
        if (player.onGround) {
          inputStrength = movementSpeedAttr * (0.21600002 / (friction * friction * friction));
        } else {
          inputStrength = 0.02;

          // DEVIATION: taken from p-physics, fixes motion!
          if (player.control.sprint) {
            const airSprintFactor = ctx.airborneAccel * 0.3
            inputStrength += airSprintFactor
          }
        }
            
        this.applyInputs(inputStrength, player);

        if (player.onClimbable) {
          // LivingEntity::handleOnClimbable
          player.vel.x = math.clamp(-0.15000000596046448, player.vel.x, 0.15000000596046448); // Math.fround(0.15)
          player.vel.z = math.clamp(-0.15000000596046448, player.vel.z, 0.15000000596046448); // Math.fround(0.15)
          player.vel.y = Math.max(-0.15000000596046448, player.vel.y); // Math.fround(0.15)
          const feetBlock = world.getBlock(new Vec3(player.pos.x, player.pos.y, player.pos.z));
          if (feetBlock && (this.scaffoldId === feetBlock.type) !== player.control.sneak) {
            player.vel.y = 0.0;
          }
        }

        this.applyMovement(ctx, world);

        // if colliding and in climbable, go up.
        if ((player.isCollidedHorizontally || player.control.jump) && player.onClimbable) {
          // TODO: or in powder with leather boots.
          player.vel.y = 0.2;
        }

        if (player.levitation > 0) {
          player.vel.y += (0.05 * player.levitation - player.vel.y) * 0.2;
        } else {
          player.vel.y -= gravity;
        }

        player.vel.x *= inertia;
        player.vel.z *= inertia;
        // another magic number that I'm pretty sure is random/hardcoded.
        // this can be generalized.
        player.vel.y *= 0.9800000190734863;
      }
    }
  }

  applyMovement(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    if (player.gameMode === "spectator") {
      player.pos.translate(player.vel.x, player.vel.y, player.vel.z);
      return;
    }

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
      maxUpStep = player.attributes[this.stepHeightAttribute].value;
    }

    // const playerAABB = player.getBB();
    if (!player.flying && movement.y <= 0.0 && player.control.sneak && player.onGround) {
      // Player::maybeBackOffFromEdge
      const step = 0.05;

      // for readability.
      const prepare = (x: number, y: number, z: number) => {
        const bb = player.getBB().translate(x, y, z);
        bb.expand(-1e-7, -1e-7, -1e-7);
        return bb;
      };

      while (movement.x != 0.0 && this.worldIsFree(world, prepare(movement.x, -maxUpStep, 0), false)) {
        movement.x = movement.x < step && movement.x >= -step ? 0.0 : movement.x > 0.0 ? movement.x - step : movement.x + step;
      }

      while (movement.z != 0.0 && this.worldIsFree(world, prepare(0, -maxUpStep, movement.z), false)) {
        movement.z = movement.z < step && movement.z >= -step ? 0.0 : movement.z > 0.0 ? movement.z - step : movement.z + step;
      }

      while ((movement.x != 0.0 && movement.z != 0.0 && prepare(movement.x, -maxUpStep, movement.z), false)) {
        movement.x = movement.x < step && movement.x >= -step ? 0.0 : movement.x > 0.0 ? movement.x - step : movement.x + step;
        movement.z = movement.z < step && movement.z >= -step ? 0.0 : movement.z > 0.0 ? movement.z - step : movement.z + step;
      }
    }

    const movementBeforeCollisions = movement.clone();
    { // Entity::collide
      const playerAABB = player.getBB();
      const hDist = (vec: Vec3) => Math.sqrt(vec.x * vec.x + vec.z * vec.z);
      // const entityCollisions = world.getEntityCollisions(player, playerAABB.expand(movement));
      
      let newMovement = movement.norm() ** 2 === 0 ? movement : this.collideBoundingBox(world, playerAABB, movement);
      
      const collisionX = Math.abs(movement.x - newMovement.x) > 1e-7;
      const collisionY = Math.abs(movement.y - newMovement.y) > 1e-7;
      const collisionZ = Math.abs(movement.z - newMovement.z) > 1e-7;
      const onGround = player.onGround || (collisionY && movement.y < 0);
      
      if (maxUpStep > 0 && onGround && (collisionX || collisionZ)) {
        let stepUpMovement = this.collideBoundingBox(
          world,
          playerAABB,
          new Vec3(movement.x, maxUpStep, movement.z),
        );
        
        const stepOnlyMovement = this.collideBoundingBox(
          world,
          playerAABB.expandTowardsCoords(movement.x, 0, movement.z),
          new Vec3(0, maxUpStep, 0),
        );
        
        if (stepOnlyMovement.y < maxUpStep) {
          const adjustedStepUp = this.collideBoundingBox(
            world,
            
            playerAABB.translateVec(stepOnlyMovement),
            new Vec3(movement.x, 0, movement.z),
          ).add(stepOnlyMovement);
          
          if (hDist(adjustedStepUp) > hDist(stepUpMovement)) {
            stepUpMovement = adjustedStepUp;
          }
        }
        
        if (hDist(stepUpMovement) > hDist(newMovement)) {
          newMovement = stepUpMovement.add(
            this.collideBoundingBox(
              world,     
              playerAABB.translateVec(stepUpMovement),
              new Vec3(0, -stepUpMovement.y + movement.y, 0),
            )
          );
        }
      }
      movement = newMovement
    }

    if (movement.norm() ** 2 > 1e-7) {
      player.pos.add(movement);
    }

    const collisionX = Math.abs(movement.x - movementBeforeCollisions.x) > 1e-7;
    const collisionY = Math.abs(movement.y - movementBeforeCollisions.y) > 1e-7;
    const collisionZ = Math.abs(movement.z - movementBeforeCollisions.z) > 1e-7;

    player.isCollidedHorizontally = collisionX || collisionZ;

    player.isCollidedVertically = collisionY;

    // TODO: add minor horizontal collision check
    {
      // Entity::setOnGroundWithKnownMovement
      player.onGround = movementBeforeCollisions.y < 0.0 && collisionY;
      if (player.onGround) {
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
        if (supportingBlockPos != null || player.onGroundWithoutSupportingBlock) {
          player.supportingBlockPos = supportingBlockPos;
        } else {
          player.supportingBlockPos = this.getSupportingBlockPos(world, feetSliceAABB.translate(-movement.x, 0.0, -movement.z));
        }
        // unnecessary due to it being a getter.
        //  player->on_ground_without_supporting_block = !player->supporting_block_pos.has_value();
      } else {
        // player->on_ground_without_supporting_block = false;
        // player->supporting_block_pos = std::optional<Position>();
        player.supportingBlockPos = null;
      }
    }

    // update speeds
    if (collisionX) {
      player.vel.x = 0.0;
    }
    if (collisionZ) {
      player.vel.z = 0.0;
    }
    if (collisionY) {
      if (player.control.sneak) {
        player.vel.y = 0.0;
      } else {
        const blockBelow = world.getBlock(player.pos.offset(0, -0.2, 0));
        let newSpeed = 0.0;
        if (blockBelow != null) {
          if (this.slimeBlockId === blockBelow.type) {
            newSpeed = -player.vel.y;
          } else if (this.bedId === blockBelow.type) {
            newSpeed = player.vel.y * -0.66;
          }
        }
        player.vel.y = newSpeed;
      }
    }

    this.checkInsideBlocks(player, world);

    let blockSpeedFactor = 1.0;
    if (this.verGreaterThan("1.15.2") && this.verLessThan("1.21")) {
      const soulSpeed = player.soulSpeed;
      const feetBlock = world.getBlock(new Vec3(player.pos.x, player.pos.y, player.pos.z));
      if (feetBlock && (this.honeyblockId === feetBlock.type || (this.soulsandId === feetBlock.type && soulSpeed === 0))) {
        blockSpeedFactor = 0.4;
      }
      if (blockSpeedFactor === 1.0) {
        const blockBelow = world.getBlock(this.getBlockBelowAffectingMovement(player, world));
        if (blockBelow && (this.honeyblockId === blockBelow.type || (this.soulsandId === blockBelow.type && soulSpeed === 0))) {
          blockSpeedFactor = 0.4;
        }
      }
    }

    if (this.verGreaterThan("1.20.6")) {
      blockSpeedFactor = blockSpeedFactor + player.attributes[this.movementEfficiencyAttribute].value * (1 - blockSpeedFactor);
    }

    player.vel.x *= blockSpeedFactor;
    player.vel.z *= blockSpeedFactor;
  }

  checkInsideBlocks(player: PlayerState, world: World) {
    const aabb = player.getBB().expand(-1e-7, -1e-7, -1e-7);
    const [minAABB, maxAABB] = aabb.minAndMaxArrays();
    const blockPos = new Vec3(0, 0, 0);
    for (blockPos.y = Math.floor(minAABB[1]); blockPos.y <= Math.floor(maxAABB[1]); ++blockPos.y) {
      for (blockPos.x = Math.floor(minAABB[0]); blockPos.x <= Math.floor(maxAABB[0]); ++blockPos.x) {
        for (blockPos.z = Math.floor(minAABB[2]); blockPos.z <= Math.floor(maxAABB[2]); ++blockPos.z) {
          const block = world.getBlock(blockPos);
          if (block == null) continue;
          if (this.webId === block.type) {
            // WebBlock::entityInside
            player.stuckSpeedMultiplier = new Vec3(0.25, 0.05000000074505806, 0.25);
          } else if (this.bubblecolumnId === block.type) {
            const aboveBlock = world.getBlock(blockPos.offset(0, 1, 0));
            if (aboveBlock == null || aboveBlock.boundingBox === "empty") {
              // Entity::onAboveBubbleColumn
              player.vel.y = 0.04;
            } else {
              // Entity::onInsideBubbleColumn
            }
          } else if (this.honeyblockId === block.type) {
            // Check if sliding down on the side of the block
            if (
              !player.onGround &&
              player.pos.y <= blockPos.y + 0.9375 - 1e-7 &&
              player.vel.y < -0.08 &&
              (Math.abs(blockPos.x + 0.5 - player.pos.x) + 1e-7 > 0.4375 + player.halfWidth ||
                Math.abs(blockPos.z + 0.5 - player.pos.z) + 1e-7 > 0.4375 + player.halfWidth)
            ) {
              if (player.vel.y < -0.13) {
                const factor = -0.05 / player.vel.y; // magic number.
                player.vel.x *= factor;
                player.vel.z *= factor;
                player.vel.y = -0.05; // magic number.
              } else {
                player.vel.y = -0.05; // magic number.
              }
            }
          } else if (this.berryBushId === block.type) {
            // BerryBushBlock::entityInside
            player.stuckSpeedMultiplier = new Vec3(0.800000011920929, 0.75, 0.800000011920929); // magic number
          } else if (this.powderSnowId === block.type) {
            // PowderSnowBlock::entityInside
            const feetBlock = world.getBlock(new Vec3(player.pos.x, player.pos.y, player.pos.z));
            if (feetBlock && this.powderSnowId === feetBlock.type) {
              player.stuckSpeedMultiplier = new Vec3(0.8999999761581421, 1.5, 0.8999999761581421);
            }
          }
        }
      }
    }
  }

  collideBoundingBox(world: World, bb: AABB, movement: Vec3,  colliders: AABB[] = []): Vec3 {
    const queryBB = bb.clone().expandTowards(movement);
    const combinedColliders = [...colliders];

    const blockCollisions = this.getSurroundingBBs(queryBB, world);
    for (const block of blockCollisions) {
      combinedColliders.push(block);
    }

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
        bb = bb.translate(0, dy, 0);
      }
    }
    
    const prioritizeZ = Math.abs(dx) < Math.abs(dz);
    if (prioritizeZ && dz !== 0.0) {
      dz = this.shapeCollide(2, bb, colliders, dz);
      if (dz !== 0.0) {
        bb = bb.translate(0, 0, dz);
      }
    }
    
    if (dx !== 0.0) {
      dx = this.shapeCollide(0, bb, colliders, dx);
      if (!prioritizeZ && dx !== 0.0) {
        bb = bb.translate(dx, 0, 0);
      }
    }
    
    if (!prioritizeZ && dz !== 0.0) {
      dz = this.shapeCollide(2, bb, colliders, dz);
    }
    
    return new Vec3(dx, dy, dz);
  }

  shapeCollide(axis: number, bb: AABB, colliders: AABB[], movement: number): number {
    if (Math.abs(movement) < 1e-7) {
      return 0.0;
    }

    movement = this.voxelShapeCollide(axis, bb, movement, colliders);
    
    return movement;
  }



  private voxelShapeCollide(axis: number, bb: AABB, movement: number, colliders: AABB[]): number {
    if (Math.abs(movement) < 1e-7) {
      return 0.0;
    }

    const [minBB, maxBB] = bb.minAndMaxArrays();
    
    const maxAxis = axis === 0 ? bb.maxX : axis === 1 ? bb.maxY : bb.maxZ;
    const minAxis = axis === 0 ? bb.minX : axis === 1 ? bb.minY : bb.minZ;

    const offAxis1 = (axis + 1) % 3;
    const offAxis2 = (axis + 2) % 3;


    
    if (movement > 0.0) {
      for (const collider of colliders) {
        const colliderMin = axis === 0 ? collider.minX : axis === 1 ? collider.minY : collider.minZ;
        
        // verify that the other axis are colliding.
        const [minPt, maxPt] = collider.minAndMaxArrays();

        if (
          maxBB[offAxis1] - 1e-7 <= minPt[offAxis1] || minBB[offAxis1] + 1e-7 >= maxPt[offAxis1] ||
          maxBB[offAxis2] - 1e-7 <= minPt[offAxis2] || minBB[offAxis2] + 1e-7 >= maxPt[offAxis2]
        ) {
          continue;
        }
        
        if (colliderMin >= maxAxis) {
          const distance = colliderMin - maxAxis;
          if (distance >= -1e-7) {
            movement = Math.min(movement, distance);
          }
          // return movement;
        }
      }
    } else if (movement < 0.0) {
      for (const collider of colliders) {

 // verify that the other axis are colliding.
 const [minPt, maxPt] = collider.minAndMaxArrays();

 if (
   maxBB[offAxis1] - 1e-7 <= minPt[offAxis1] || minBB[offAxis1] + 1e-7 >= maxPt[offAxis1] ||
   maxBB[offAxis2] - 1e-7 <= minPt[offAxis2] || minBB[offAxis2] + 1e-7 >= maxPt[offAxis2]
 ) {
   continue;
 }

        const colliderMax = axis === 0 ? collider.maxX : axis === 1 ? collider.maxY : collider.maxZ;
        if (colliderMax <= minAxis) {
          const distance = colliderMax - minAxis;
          if (distance <= 1e-7) {
            movement = Math.max(movement, distance);
          }
          // return movement;
        }
      }
    }
    return movement;
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
    // console.log("current input strength of normal movement", inputStrength, player.onGround, player.sprinting, player.control)
    const inputVector = new Vec3(player.heading.strafe, 0, player.heading.forward);
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
    // TODO: if trapdoor AND below block is a ladder with the same facing property
    // as the trapdoor then the trapdoor is a climbable block too

    // TODO: make climbables a set.
    return feetBlock != null && (this.vineId === feetBlock.type || this.ladderId === feetBlock.type || this.scaffoldId === feetBlock.type);
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
          for (const shape of block.shapes) {
            const bb1 = AABB.fromShape(shape).translateVec(blockPos);
            if (aabb.collides(bb1)) {
              const distance = aabb.getCenter().distanceTo(bb1.getCenter());
              if (distance < minDistance) {
                minDistance = distance;
                ret = blockPos;
              }
            }
          }
        }
      }
    }
    return ret;
  }

  simulate(entity: EPhysicsCtx, world: World): IEntityState {
    this.physicsTick(entity, world);
    entity.state.age++;
    return entity.state;
  }
}
