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
import * as attributes from "../info/attributes";
import * as math from "../info/math";
import { EPhysicsCtx } from "../settings/entityPhysicsCtx";
import { EntityState, IEntityState } from "../states/entityState";
import { IPhysics } from "./IPhysics";
import { PlayerPoses, PlayerState, getCollider } from "../states";

type CheapEffectNames = keyof ReturnType<typeof getStatusEffectNamesForVersion>;
type CheapEnchantmentNames = keyof ReturnType<typeof getEnchantmentNamesForVersion>;

type Heading = { forward: number; strafe: number };

/**
 * Looking at this code, it's too specified towards players.
 *
 * I will eventually split this code into PlayerState and bot.entityState, where bot.entityState contains fewer controls.
 */

export class BotcraftPhysics implements IPhysics {
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
    return new AABB(-w, 0, -w, w, entity.height, w).translate(pos.x, pos.y, pos.z);
  }

  setPositionToBB(entity: EPhysicsCtx, bb: AABB, pos: { x: number; y: number; z: number }) {
    const halfWidth = entity.getHalfWidth();
    pos.x = bb.minX + halfWidth;
    pos.y = bb.minY;
    pos.z = bb.minZ + halfWidth;
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
            blockBB.translate(blockPos.x, blockPos.y, blockPos.z);
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
              blockBB.translate(blockPos.x, blockPos.y, blockPos.z);
              surroundingBBs.push(blockBB);
            }
          }
        }
      }
    }
    return surroundingBBs;
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

  private worldIsFree(world: any /* prismarine-world */, bb: AABB, ignoreLiquid: boolean) {
    return this.getSurroundingBBs(bb, world).length === 0;
  }

  /**
   * 1:1 copy of the original physicsTick function from botcraft
   * https://github.com/adepierre/Botcraft/blob/6c572071b0237c27a85211a246ce10565ef4d80f/botcraft/src/Game/Physics/PhysicsManager.cpp#L277
   *
   *
   * @param ectx
   * @param world
   */
  private physicsTick(ectx: EPhysicsCtx, world: any /*prismarine-world*/) {
    // Check for rocket boosting if currently in elytra flying mode
    if (ectx.state.elytraFlying) {
      // TODO: entity check for fireworks
      // TODO: check if firework is attached to player
      if (false) {
        // player->speed += player->front_vector * 0.1 + (player->front_vector * 1.5 - player->speed) * 0.5;
      }
    }

    const playerFlag = ectx.entityType.type === "player";

    // if world is currently loaded at player position
    if (playerFlag) {
      // TODO: check if spectator mode
    }

    this.fluidPhysics(true);
    this.fluidPhysics(false);
    this.updateSwimming();

    // separation into a new function
    // originally: https://github.com/adepierre/Botcraft/blob/6c572071b0237c27a85211a246ce10565ef4d80f/botcraft/src/Game/Physics/PhysicsManager.cpp#L325
    if (playerFlag) {
      this.localPlayerAIStep(ectx.state as PlayerState, world);
    }

    // If sneaking in water, add downward speed
    if ()
  }

  private fluidPhysics(val: boolean) {}

  private updateSwimming() {}

  private isFallFlying(pState: PlayerState): boolean {
    return pState.flying && pState.pose === PlayerPoses.FALL_FLYING;
  }

  private localPlayerAIStep(pState: PlayerState, world: any /*prismarine-world*/) {
    const heading = this.convInpToAxes(pState);
    this.inputsToCrouch(pState, heading, world);
    this.inputsToSprint(pState, heading, world);
    this.inputsToFly(pState, heading, world);

    // If sneaking in water, add downward speed
    if (pState.isInWater && pState.control.sneak /* TODO: flying check */) {
    }
  }

  private inputsToCrouch(pState: PlayerState, heading: Heading, world: any /*prismarine-world*/) {
    if (this.verGreaterThan("1.13.2")) {
      const sneakBb = getCollider(PlayerPoses.SNEAKING, pState.pos);
      const standBb = getCollider(PlayerPoses.STANDING, pState.pos);
      sneakBb.expand(-1e-7, -1e-7, -1e-7);
      standBb.expand(-1e-7, -1e-7, -1e-7);

      pState.crouching =
        !this.isSwimmingAndNotFlying(pState, world) &&
        this.worldIsFree(world, sneakBb, false) &&
         ( pState.prevControl.sneak || !this.worldIsFree(world, standBb, false));
    } else {
      pState.crouching = !this.isSwimmingAndNotFlying(pState, world) && pState.prevControl.sneak
    }

    // Determine if moving slowly
    let isMovingSlowly: boolean;
    if (this.verGreaterThan("1.13.2")) {
      isMovingSlowly = pState.crouching || (pState.pose === PlayerPoses.SWIMMING && !pState.isInWater);
    } else {
      isMovingSlowly = pState.crouching;
    }

    // Handle post-1.21.3 sprinting conditions
    if (this.verGreaterThan("1.21.3")) {
      // TODO: just use stored blindness effect.
      const hasBlindness = this.getEffectLevel(CheapEffects.BLINDNESS, pState.effects) > 0;

      // Stop sprinting when crouching fix in 1.21.4+
      if (this.isFallFlying(pState) || hasBlindness || isMovingSlowly) {
        this.setSprinting(false);
      }
    }

    // Apply slow down to player inputs when moving slowly
    if (isMovingSlowly) {
      let sneakCoefficient: number;

      if (this.verLessThan("1.19")) {
        sneakCoefficient = 0.3;
      } else if (this.verLessThan("1.21")) {
        sneakCoefficient = 0.3 + pState.swiftSneak * 0.15;
        sneakCoefficient = Math.min(Math.max(0.0, sneakCoefficient), 1.0);
      } else {
        sneakCoefficient = pState.attributes?.sneakingSpeed.value ?? 0.3;
      }

      heading.forward *= sneakCoefficient;
      heading.strafe *= sneakCoefficient;
    }
  }

  private isSwimmingAndNotFlying(pState: PlayerState, world: any /*prismarine-world*/): boolean {
    //  return !player->flying &&
    // player->game_mode != GameType::Spectator &&
    // player->GetDataSharedFlagsIdImpl(EntitySharedFlagsId::Swimming);
    return !pState.flying && pState.gameMode !== "spectator" && pState.swimming;
  }

  private inputsToSprint(pState: PlayerState, heading: Heading, world: any /*prismarine-world*/) {
    const canStartSprinting =
      /* !player->GetDataSharedFlagsIdImpl(EntitySharedFlagsId::Sprinting) */ true &&
      heading.forward >= (pState.isInWater ? 1e-5 : 0.8) &&
      /* player->may_fly || */ pState.food > 6 &&
      !this.isFallFlying(pState) &&
      !pState.blindness;

    // TODO: keep track of previous movement values?
    const couldSprintPrevious = true; /*  player->previous_forward >= (player->under_water ? 1e-5f : 0.8f); */

    // start sprinting if possible
    if (
      canStartSprinting &&
      pState.control.sprint &&
      (!pState.isInWater /*|| pState.isUnderWater*/ ||
        pState.onGround /* || pState.isUnderWater*/) /* && !player->previous_sneak &&  !couldSprintPrevious */
    ) {
      this.setSprinting(true);
    }

    // stop sprinting if necessary
    if (/* pState.sprinting */ false) {
      const stopSprintCond = heading.forward <= 1e-5 || pState.food <= 6 /* && player->may_fly */;
      if (this.isSwimmingAndNotFlying(pState, world)) {
        if ((!pState.onGround && !pState.control.sneak && stopSprintCond) || !pState.isInWater) {
          this.setSprinting(false);
        }
      } else if (stopSprintCond /* || player->horizontal_collision */ || pState.isInWater /* && !player.isUnderWater */) {
        this.setSprinting(false);
      }
    }
  }

  setSprinting(value: boolean) {
    throw new Error("Method not implemented.");
  }

  private inputsToFly(pState: PlayerState, heading: Heading, world: any /*prismarine-world*/) {
    let flyChanged = false;
    if (pState.m)
  }

  simulate(entity: EPhysicsCtx, world: any /*prismarine-world*/): EntityState {
    return entity.state;
  }
}
