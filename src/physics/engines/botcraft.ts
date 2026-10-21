import { AABB } from "@nxg-org/mineflayer-util-plugin";
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
// imported from the defining modules: the "../states" barrel re-exports through getters, which cost on hot paths.
import { PlayerPoses, getCollider } from "../states/poses";
import { PlayerState, convInpToAxes } from "../states/playerState";
import { PhysicsWorldSettings } from "../settings";

import type { world } from "prismarine-world"

type CheapEffectNames = keyof ReturnType<typeof getStatusEffectNamesForVersion>;
type CheapEnchantmentNames = keyof ReturnType<typeof getEnchantmentNamesForVersion>;

type Heading = { forward: number; strafe: number };
type World = {
  getBlock: world.WorldSync["getBlock"];
  /**
   * Optional fast path (prismarine-world's WorldSync has it). Must agree with `getBlock`:
   * the same state id at the same position, and null/undefined where `getBlock` returns null.
   */
  getBlockStateId?: (pos: Vec3) => number | null | undefined;
};

const COLLISION_EPSILON = 1e-7;

const FLOW_DIRECTIONS = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
];

/**
 * The block fields the engine reads. Built from a world Block, and shared per block state
 * when the world exposes state ids.
 */
class BlockInfo {
  public readonly type: number;
  public readonly metadata: number;
  public readonly shapes: number[][];
  public readonly emptyBB: boolean;
  /** state id 0 from getBlockStateId: prismarine-world also returns that for unloaded chunks. */
  public readonly maybeUnloaded: boolean;
  private waterloggedValue: boolean | undefined;

  constructor(private readonly block: Block, fromStateId0 = false) {
    this.type = block.type;
    this.metadata = block.metadata;
    this.shapes = block.shapes;
    this.emptyBB = block.boundingBox === "empty";
    this.maybeUnloaded = fromStateId0;
  }

  get waterlogged(): boolean {
    if (this.waterloggedValue === undefined) this.waterloggedValue = !!this.block.getProperties().waterlogged;
    return this.waterloggedValue;
  }
}

// keyed by registry, so engines built from the same minecraft-data share it.
const blockInfoByStateId = new WeakMap<object, Map<number, BlockInfo>>();

// the per-tick lookup memo is a 16^3 window centred on the entity's block.
const MEMO_BITS = 4;
const MEMO_SPAN = 1 << MEMO_BITS;
const MEMO_RADIUS = MEMO_SPAN >> 1;
const MEMO_SIZE = MEMO_SPAN * MEMO_SPAN * MEMO_SPAN;


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
  protected airId: number;
  protected waterLike: Set<number>;

  public readonly statusEffectNames: { [type in CheapEffects]: string };
  public readonly enchantmentNames: { [type in CheapEnchantments]: string };

  private readonly stateInfos: Map<number, BlockInfo>;
  private readonly verGreaterCache = new Map<string, boolean>();
  private readonly verLessCache = new Map<string, boolean>();

  // block lookups memoized for the duration of one simulate() call; the world can't change mid-tick.
  // a slot is valid when its stamp equals memoGen (0 = no memo active).
  private readonly memoStamps = new Int32Array(MEMO_SIZE);
  private readonly memoInfos: (BlockInfo | null)[] = new Array(MEMO_SIZE).fill(null);
  private memoGen = 0;
  private lastMemoGen = 0;
  private memoX = 0;
  private memoY = 0;
  private memoZ = 0;

  // flat [minX, minY, minZ, maxX, maxY, maxZ, ...] scratch buffer for collision sweeps.
  private readonly colliderScratch: number[] = [];

  constructor(mcData: md.IndexedData) {
    this.data = mcData;
    let stateInfos = blockInfoByStateId.get(mcData);
    if (stateInfos == null) {
      stateInfos = new Map();
      blockInfoByStateId.set(mcData, stateInfos);
    }
    this.stateInfos = stateInfos;
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
    this.airId = blocksByName.air.id;
    this.waterLike = new Set();
    if (blocksByName.seagrass) this.waterLike.add(blocksByName.seagrass.id); // 1.13+
    if (blocksByName.tall_seagrass) this.waterLike.add(blocksByName.tall_seagrass.id); // 1.13+
    if (blocksByName.kelp) this.waterLike.add(blocksByName.kelp.id); // 1.13+
    if (blocksByName.kelp_plant) this.waterLike.add(blocksByName.kelp_plant.id); // 1.13+
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

  /**
   * Block at the given (unfloored) coordinates, or null where the world has none.
   * An unloaded position may come back as air when the world only reports state ids;
   * use blockOrNullAt where that difference matters.
   */
  private blockAt(world: World, x: number, y: number, z: number): BlockInfo | null {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    const bz = Math.floor(z);
    if (this.memoGen !== 0) {
      const dx = bx - this.memoX + MEMO_RADIUS;
      const dy = by - this.memoY + MEMO_RADIUS;
      const dz = bz - this.memoZ + MEMO_RADIUS;
      if (dx >= 0 && dx < MEMO_SPAN && dy >= 0 && dy < MEMO_SPAN && dz >= 0 && dz < MEMO_SPAN) {
        const slot = (((dx << MEMO_BITS) | dy) << MEMO_BITS) | dz;
        if (this.memoStamps[slot] === this.memoGen) return this.memoInfos[slot];
        const info = this.lookupBlock(world, bx, by, bz);
        this.memoStamps[slot] = this.memoGen;
        this.memoInfos[slot] = info;
        return info;
      }
    }
    return this.lookupBlock(world, bx, by, bz);
  }

  /** blockAt, but tells an unloaded position (getBlock() === null) apart from air. */
  private blockOrNullAt(world: World, x: number, y: number, z: number): BlockInfo | null {
    const info = this.blockAt(world, x, y, z);
    if (info !== null && info.maybeUnloaded && world.getBlock(new Vec3(Math.floor(x), Math.floor(y), Math.floor(z))) == null) {
      return null;
    }
    return info;
  }

  private lookupBlock(world: World, bx: number, by: number, bz: number): BlockInfo | null {
    const pos = new Vec3(bx, by, bz);
    if (typeof world.getBlockStateId === "function") {
      const stateId = world.getBlockStateId(pos);
      if (stateId == null) return null;
      const cached = this.stateInfos.get(stateId);
      if (cached !== undefined) return cached;

      const block = world.getBlock(pos) as Block | null;
      if (block == null) return null;
      const info = new BlockInfo(block, stateId === 0);
      if (block.stateId === stateId) this.stateInfos.set(stateId, info);
      return info;
    }
    const block = world.getBlock(pos) as Block | null;
    return block == null ? null : new BlockInfo(block);
  }

  private isWaterBlock(info: BlockInfo) {
    return info.type === this.waterId || this.waterLike.has(info.type) || info.waterlogged;
  }

  getSurroundingBBs(queryBB: AABB, world: World, underlying = true): AABB[] {
    const surroundingBBs = [];
    for (let y = Math.floor(queryBB.minY) - Number(underlying); y <= Math.floor(queryBB.maxY); ++y) {
      for (let z = Math.floor(queryBB.minZ); z <= Math.floor(queryBB.maxZ); ++z) {
        for (let x = Math.floor(queryBB.minX); x <= Math.floor(queryBB.maxX); ++x) {
          const block = this.blockAt(world, x, y, z);
          if (block != null) {
            for (const shape of block.shapes) {
              const blockBB = new AABB(shape[0], shape[1], shape[2], shape[3], shape[4], shape[5]);
              blockBB.translate(x, y, z);
              surroundingBBs.push(blockBB);
            }
          }
        }
      }
    }
    return surroundingBBs;
  }

  /**
   * getSurroundingBBs, written into a flat scratch array instead of AABBs.
   * @returns number of values written (6 per box)
   */
  private collectSurroundingShapes(
    world: World,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    underlying: boolean,
    out: number[],
    start: number,
  ): number {
    let n = start;
    for (let y = Math.floor(minY) - Number(underlying); y <= Math.floor(maxY); ++y) {
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ); ++z) {
        for (let x = Math.floor(minX); x <= Math.floor(maxX); ++x) {
          const block = this.blockAt(world, x, y, z);
          if (block == null) continue;
          const shapes = block.shapes;
          for (let i = 0; i < shapes.length; i++) {
            const shape = shapes[i];
            out[n++] = shape[0] + x;
            out[n++] = shape[1] + y;
            out[n++] = shape[2] + z;
            out[n++] = shape[3] + x;
            out[n++] = shape[4] + y;
            out[n++] = shape[5] + z;
          }
        }
      }
    }
    return n;
  }

  getWaterInBBs(bb: AABB, world: World) {
    const bbs = [];
    for (let y = Math.floor(bb.minY); y <= Math.floor(bb.maxY); y++) {
      for (let z = Math.floor(bb.minZ); z <= Math.floor(bb.maxZ); z++) {
        for (let x = Math.floor(bb.minX); x <= Math.floor(bb.maxX); x++) {
          const block = this.blockAt(world, x, y, z);
          if (block && this.isWaterBlock(block)) {
            const waterLevel = y + 1 - this.liquidHeightPcentOf(block);
            if (Math.ceil(bb.maxY) >= waterLevel) {
              bbs.push(new AABB(x, y, z, x + 1, y + 1, z + 1));
            }
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
    let res = this.verGreaterCache.get(ver);
    if (res === undefined) {
      res = this.data.version[">"](ver);
      this.verGreaterCache.set(ver, res);
    }
    return res;
  }

  private verLessThan(ver: string) {
    let res = this.verLessCache.get(ver);
    if (res === undefined) {
      res = this.data.version["<"](ver);
      this.verLessCache.set(ver, res);
    }
    return res;
  }

  private worldIsFree(world: World, bb: AABB, ignoreLiquid: boolean) {
    const { minX, minY, minZ, maxX, maxY, maxZ } = bb;

    // same as AABB.intersects against every block shape from getSurroundingBBs(bb, world, false)
    for (let y = Math.floor(minY); y <= Math.floor(maxY); ++y) {
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ); ++z) {
        for (let x = Math.floor(minX); x <= Math.floor(maxX); ++x) {
          const block = this.blockAt(world, x, y, z);
          if (block == null) continue;
          for (const shape of block.shapes) {
            if (
              shape[0] + x < maxX &&
              shape[3] + x > minX &&
              shape[1] + y < maxY &&
              shape[4] + y > minY &&
              shape[2] + z < maxZ &&
              shape[5] + z > minZ
            ) {
              return false;
            }
          }
        }
      }
    }

    if (ignoreLiquid) return true;

    // and against every box from getWaterInBBs(bb, world)
    for (let y = Math.floor(minY); y <= Math.floor(maxY); y++) {
      for (let z = Math.floor(minZ); z <= Math.floor(maxZ); z++) {
        for (let x = Math.floor(minX); x <= Math.floor(maxX); x++) {
          const block = this.blockAt(world, x, y, z);
          if (block && this.isWaterBlock(block)) {
            const waterLevel = y + 1 - this.liquidHeightPcentOf(block);
            if (Math.ceil(maxY) >= waterLevel && x < maxX && x + 1 > minX && y < maxY && y + 1 > minY && z < maxZ && z + 1 > minZ) {
              return false;
            }
          }
        }
      }
    }
    return true;
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
    if (this.worldIsFree(world, swimPose, true)) {
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
      if (player.gameMode === "spectator" || this.worldIsFree(world, poseBB, true)) {
        player.pose = currentPose;
      } else {
        const crouchBB = getCollider(PlayerPoses.SNEAKING, player.pos).expand(-1e-7, -1e-7, -1e-7);
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
    const aabb = getCollider(player.pose, player.pos).expand(-1e-3, -1e-3, -1e-3); // -0.001
    if (water) {
      player.isInWater = false;
      player.isUnderWater = false;
    } else {
      player.isInLava = false;
      player.isUnderLava = false;
    }

    const { minX, minY, minZ, maxX, maxY, maxZ } = aabb;
    const eyeHeight = player.eyeHeight + player.pos.y;

    const push = new Vec3(0, 0, 0);
    let fluidRelativeHeight = 0.0;
    let numPush = 0;
    for (let x = Math.floor(minX); x <= Math.floor(maxX); ++x) {
      for (let y = Math.floor(minY); y <= Math.floor(maxY); ++y) {
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ); ++z) {
          const block = this.blockAt(world, x, y, z);
          if (block == null) continue;

          const waterRes = this.isWaterBlock(block);
          const lavaRes = block.type === this.lavaId;
          if ((waterRes && !water) || (lavaRes && water) || (!waterRes && !lavaRes)) {
            continue;
          }

          let fluidHeight = 0.0;
          const blockAbv = this.blockOrNullAt(world, x, y + 1, z);
          // (a null blockAbv throws on .type, as before)
          if ((blockAbv != null && this.isWaterBlock(blockAbv) && waterRes) || (blockAbv!.type === this.lavaId && lavaRes)) {
            fluidHeight = 1.0;
          } else {
            fluidHeight = this.liquidHeightPcentOf(block);
          }

          if (fluidHeight + y < minY) {
            continue;
          }

          if (water) {
            player.isInWater = true;
            if (fluidHeight + y > eyeHeight) {
              player.isUnderWater = true;
            }
          } else {
            player.isInLava = true;
            if (fluidHeight + y > eyeHeight) {
              player.isUnderLava = true;
            }
          }

          fluidRelativeHeight = Math.max(fluidHeight + y - minY, fluidRelativeHeight);

          if (player.flying) continue;

          const currentPush = this.flowAt(block, x, y, z, world);
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
    const pos = block.position;
    return this.flowAt(new BlockInfo(block), pos.x, pos.y, pos.z, world);
  }

  private flowAt(block: BlockInfo, x: number, y: number, z: number, world: World) {
    const curlevel = this.renderedDepthOf(block);
    const flow = new Vec3(0, 0, 0);
    for (const [dx, dz] of FLOW_DIRECTIONS) {
      const adjBlock = this.blockOrNullAt(world, x + dx, y, z + dz);
      const adjLevel = this.renderedDepthOf(adjBlock);
      if (adjLevel < 0) {
        if (adjBlock && adjBlock.emptyBB) {
          const adjLevel = this.renderedDepthOf(this.blockAt(world, x + dx, y - 1, z + dz));
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

    // Match Grim's FluidTypeFlowing: only actual water/lava block states carry
    // a falling fluid level. Waterlogged and source-like blocks use unrelated metadata.
    const hasFluidLevel = block.type === this.waterId || block.type === this.lavaId;
    if (hasFluidLevel && block.metadata >= 8) {
      for (const [dx, dz] of FLOW_DIRECTIONS) {
        const adjBlock = this.blockAt(world, x + dx, y, z + dz);
        const adjUpBlock = this.blockAt(world, x + dx, y + 1, z + dz);
        if ((adjBlock && !adjBlock.emptyBB) || (adjUpBlock && !adjUpBlock.emptyBB)) {
          flow.normalize().translate(0, -6, 0);
          break;
        }
      }
    }

    return flow.normalize();
  }

  getLiquidHeightPcent(block: Block) {
    return this.liquidHeightPcentOf(block ? new BlockInfo(block) : null);
  }

  private liquidHeightPcentOf(block: BlockInfo | null) {
    return 1 - (this.renderedDepthOf(block) + 1) / 9;
  }

  getRenderedDepth(block: Block) {
    return this.renderedDepthOf(block ? new BlockInfo(block) : null);
  }

  private renderedDepthOf(block: BlockInfo | null) {
    if (!block) return -1;
    if (this.waterLike.has(block.type)) return 0;
    if (block.waterlogged) return 0;
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
      const block = this.blockAt(world, player.pos.x, player.pos.y, player.pos.z);
      player.swimming = player.sprinting && player.isUnderWater && block != null && this.isWaterBlock(block);
    }
  }

  private isMovingSlowly(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    if (this.verGreaterThan("1.13.2")) {
      const visuallyCrawling =
        (player.pose === PlayerPoses.SWIMMING || (!player.fallFlying && player.pose === PlayerPoses.FALL_FLYING)) &&
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

    // livingEntity::AiStep
    {
      player.jumpTicks = Math.max(0, player.jumpTicks - 1);
      if (this.verGreaterThan("1.21.4")) {
        const horizontalVelocitySqr = player.vel.x * player.vel.x + player.vel.z * player.vel.z;
        const movementThresholdSqr = ctx.worldSettings.negligeableVelocity * ctx.worldSettings.negligeableVelocity;
        if (horizontalVelocitySqr < movementThresholdSqr) {
          player.vel.x = 0;
          player.vel.z = 0;
        }
      } else {
        if (Math.abs(player.vel.x) < ctx.worldSettings.negligeableVelocity) {
          player.vel.x = 0;
        }
        if (Math.abs(player.vel.z) < ctx.worldSettings.negligeableVelocity) {
          player.vel.z = 0;
        }
      }
      if (Math.abs(player.vel.y) < ctx.worldSettings.negligeableVelocity) {
        player.vel.y = 0;
      }

      this.inputsToJump(player, world, ctx.worldSettings);

      // TODO: properly implement heading handler. forward-axis is forward, left-axis = strafe. weird naming.
      heading.forward *= 0.98;
      heading.strafe *= 0.98;
      // player->inputs.forward_axis *= 0.98f;
      // player->inputs.left_axis *= 0.98f;

      // Compensate water downward speed depending on looking direction (?)

      this.applySwimmingVerticalSteering(ctx, world);


      // Refresh pose before movement so the first fall-flying tick uses the
      // correct collider instead of the standing bounding box.
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
      const sneakBb = getCollider(PlayerPoses.SNEAKING, player.pos);
      const standBb = getCollider(PlayerPoses.STANDING, player.pos);
      sneakBb.expand(-1e-7, -1e-7, -1e-7);
      standBb.expand(-1e-7, -1e-7, -1e-7);

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

      // Stop sprinting when crouching fix in 1.21.4+
      if (hasBlindness || isMovingSlowly) {
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
        sneakCoefficient = player.attributes?.sneakingSpeed?.value ?? 0.3; // TODO: this shouldn't be happening!
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

  private applySwimmingVerticalSteering(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    if (!this.isSwimmingAndNotFlying(ctx, world)) return;

    const lookY = getLookingVector(player).lookY;
    let shouldAdjust = lookY < 0.0 || player.control.jump;
    if (!shouldAdjust) {
      const blockAbove = this.blockAt(world, player.pos.x, player.pos.y + 1.0 - 0.1, player.pos.z);
      shouldAdjust = blockAbove != null && (this.waterId === blockAbove.type || this.waterLike.has(blockAbove.type));
    }

    if (shouldAdjust) {
      player.vel.y += (lookY - player.vel.y) * (lookY < -0.2 ? 0.085 : 0.06);
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
      heading.forward >= (player.isInWater ? 1e-5 : 0.8) &&
      this.hasEnoughFoodToSprint(ctx) &&
      !player.isUsingItem &&
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
    if (attr != null) attributes.deleteAttributeModifier(attr, ctx.worldSettings.sprintingUUID);
    attr = attributes.createAttributeValue(ctx.worldSettings.playerSpeed);
    if (value) {
      attributes.addAttributeModifier(attr, {
        uuid: ctx.worldSettings.sprintingUUID,
        amount: ctx.worldSettings.sprintSpeed,
        operation: 2,
      });
    }

    // potential deviation from vanilla.
    // if (value != player.sprinting) {
    //   player.sprintTriggerTime = ctx.worldSettings.sprintTimeTriggerCooldown;
    // }

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

      if (player.isInWater || player.isInLava) {
        player.vel.y += 0.03999999910593033; // magic number
      } else if (player.onGround && player.jumpTicks === 0) {
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
          const value = Math.fround(entity.attributes[this.jumpStrengthAttribute]?.value ?? Math.fround(0.42));
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
    const feetBlock = this.blockAt(world, entity.pos.x, entity.pos.y, entity.pos.z);
    const feetJumpFactor = this.getKnownJumpFactor(feetBlock?.type, worldSettings);
    if (feetJumpFactor !== 1.0) return feetJumpFactor;

    const below = this.getBlockBelowAffectingMovement(entity, world);
    const supportBlock = this.blockAt(world, below.x, below.y, below.z);
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
      return entity.supportingBlockPos //.offset(0, -0.500001, 0);
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
    attribute = attributes.deleteAttributeModifier(attribute, entity.worldSettings.sprintingUUID);
    if (isSprinting) {
      attribute = attributes.addAttributeModifier(attribute, {
        uuid: entity.worldSettings.sprintingUUID,
        // Math.fround(0.3) perfectly resolves to 0.30000001192092896
        amount: Math.fround(0.3), 
        operation: 2,
      });
    }

    // --- SPEED EFFECT ---
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

    // --- SLOWNESS EFFECT ---
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

    // Calculate the final speed and cast the entire result to a 32-bit float
    const attributeSpeed = Math.fround(attributes.getAttributeValue(attribute));
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
        let waterSlowDown = Math.fround(player.sprinting ? ctx.sprintWaterInertia : ctx.waterInertia);
        let inputStrength = 0.02;
        let depthStriderMult;
        if (this.verLessThan("1.21")) {
          const depthStrider = player.depthStrider;
          depthStriderMult = Math.min(depthStrider, 3) / 3;
        } else {
          depthStriderMult = player.attributes[this.waterMovementEfficiencyAttribute]?.value ?? 0; // random value as default
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

        if (!player.sprinting) {
          if (this.verGreaterThan("1.12.2")) {
            if (gravity !== 0.0) {
              if (
                goingDown &&
                Math.abs(player.vel.y - 0.005) >= 0.003 &&
                Math.abs(player.vel.y - gravity / 16.0) < 0.003
              ) {
                player.vel.y = -0.003;
              } else {
                player.vel.y -= gravity / 16.0;
              }
            }
          } else {
            player.vel.y -= ctx.waterGravity;
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
        player.vel.scale(0.5);
        player.vel.y -= ctx.lavaGravity;

        const bb = player.getBB().expand(-1e-7, -1e-7, -1e-7);
        bb.translate(0, 0.6000000238418579 - player.pos.y + initY, 0); // Math.fround(0.60)
        bb.translateVec(player.vel);
        if (player.isCollidedHorizontally && this.worldIsFree(world, bb, false)) {
          player.vel.y = ctx.worldSettings.outOfLiquidImpulse;
        }
      }
      // elytra flying.
      else if (player.fallFlying) {
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
        const below = this.getBlockBelowAffectingMovement(player, world);
        let blockBelow = this.blockAt(world, below.x, below.y, below.z);
        // only an unloaded position (null) can tell apart from air here, if air has a slipperiness entry.
        if (blockBelow !== null && blockBelow.maybeUnloaded && this.blockSlipperiness[blockBelow.type] !== undefined) {
          blockBelow = this.blockOrNullAt(world, below.x, below.y, below.z);
        }

        // deviation. using our stores slipperiness values.
        const blockSlipperiness = blockBelow ? this.blockSlipperiness[blockBelow.type] : undefined;
        const friction = blockSlipperiness ?? ctx.worldSettings.defaultSlipperiness;

        // console.log(blockBelow.name, blockBelow.position, player.supportingBlockPos, friction)
        const inertia = player.lastOnGround
          // ponytail: preserve legacy default-block rounding until those baselines are updated.
          ? blockSlipperiness == null
            ? friction * ctx.airborneInertia
            : Math.fround(Math.fround(friction) * Math.fround(ctx.airborneInertia))
          : ctx.airborneInertia;

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
          const feetBlock = this.blockOrNullAt(world, player.pos.x, player.pos.y, player.pos.z);
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

      this.applyFireworkBoost(player);
    }
  }

  applyMovement(ctx: EPhysicsCtx, world: World) {
    const player = ctx.state as PlayerState;
    if (player.gameMode === "spectator") {
      player.pos.translate(player.vel.x, player.vel.y, player.vel.z);
      if (!player.isInWater && this.data.version.minecraftVersion !== "1.21.4") this.fluidPhysics(ctx, world, true);
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
      maxUpStep = player.attributes[this.stepHeightAttribute]?.value ?? ctx.stepHeight;
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

      while (movement.x != 0.0 && this.worldIsFree(world, prepare(movement.x, -maxUpStep, 0), true)) {
        // console.log('x', movement.x, step, this.worldIsFree(world, prepare(movement.x, -maxUpStep, 0), true))
        movement.x = movement.x < step && movement.x >= -step ? 0.0 : movement.x > 0.0 ? movement.x - step : movement.x + step;
      }

      while (movement.z != 0.0 && this.worldIsFree(world, prepare(0, -maxUpStep, movement.z), true)) {
        movement.z = movement.z < step && movement.z >= -step ? 0.0 : movement.z > 0.0 ? movement.z - step : movement.z + step;
      }

      // this code is almost certainly bugged, but it works right now so hey we take it.
      while ((movement.x != 0.0 && movement.z != 0.0 && prepare(movement.x, -maxUpStep, movement.z), false)) {
        movement.x = movement.x < step && movement.x >= -step ? 0.0 : movement.x > 0.0 ? movement.x - step : movement.x + step;
        movement.z = movement.z < step && movement.z >= -step ? 0.0 : movement.z > 0.0 ? movement.z - step : movement.z + step;
      }
    }

    // 1.20.5: this is var2 in entity::move
    const movementBeforeCollisions = movement.clone();

    { // Entity::collide
      const playerAABB = player.getBB();
      const fuck = playerAABB.clone();
      const hDist = (vec: Vec3) => Math.sqrt(vec.x * vec.x + vec.z * vec.z);
      // const entityCollisions = world.getEntityCollisions(player, playerAABB.expand(movement));

      let newMovement = movement.norm() ** 2 === 0 ? movement : this.collideBoundingBox(world, playerAABB, movement);


      const collisionX = Math.abs(movement.x - newMovement.x) > 1e-7;
      const collisionY = Math.abs(movement.y - newMovement.y) > 1e-7;
      const collisionZ = Math.abs(movement.z - newMovement.z) > 1e-7;
      // console.log('internal collisions', collisionX, collisionY, collisionZ);
      const onGround = player.onGround || (collisionY && movement.y < 0);


      if (maxUpStep > 0 && onGround && (collisionX || collisionZ)) {
        let stepUpMovement = this.collideBoundingBox(
          world,
          playerAABB,
          new Vec3(movement.x, maxUpStep, movement.z),
        );

        const expand = playerAABB.expandTowardsCoords(movement.x, 0, movement.z)
        const stepOnlyMovement = this.collideBoundingBox(
          world,
          expand,
          new Vec3(0, maxUpStep, 0),
        );

        if (stepOnlyMovement.y < maxUpStep) {
          const adjustedStepUp = this.collideBoundingBox(
            world,

            playerAABB.move(stepOnlyMovement),
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
              playerAABB.move(stepUpMovement),
              new Vec3(0, -stepUpMovement.y + movement.y, 0),
            )
          );
        }
      }
      movement = newMovement
    }
    // console.log('after all collision', movement)
    if (movement.norm() ** 2 > 1e-7) {
      player.pos.add(movement);
    }

    // 1.20.5: movement is now considered var4.

    const collisionX = Math.abs(movement.x - movementBeforeCollisions.x) > 1e-7;
    const collisionY = Math.abs(movement.y - movementBeforeCollisions.y) > 1e-7;
    const collisionZ = Math.abs(movement.z - movementBeforeCollisions.z) > 1e-7;

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

        if (!player.onGround && player.supportingBlockPos != null) {
          player.onGround = true;
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
        const blockBelow = this.blockAt(world, player.pos.x, player.pos.y + -0.2, player.pos.z);
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

    // Vanilla refreshes water contact here, before travel applies friction, except in 1.21.4.
    // https://github.com/GrimAnticheat/Grim/blob/2fe3b3e5ab9bd4ea692d712712645cf38209378b/common/src/main/java/ac/grim/grimac/predictionengine/movementtick/MovementTicker.java#L172-L184
    if (!player.isInWater && this.data.version.minecraftVersion !== "1.21.4") this.fluidPhysics(ctx, world, true);

    // Rough fix for now: ignore this if we are flying.
    if (!player.flying) {
      this.checkInsideBlocks(player, world, ctx.worldSettings);
    }

    let blockSpeedFactor = 1.0;
    if (this.verGreaterThan("1.15.2") && this.verLessThan("1.21")) {
      const soulSpeed = player.soulSpeed;
      const feetBlock = this.blockAt(world, player.pos.x, player.pos.y, player.pos.z);
      if (feetBlock && (this.honeyblockId === feetBlock.type || (this.soulsandId === feetBlock.type && soulSpeed === 0))) {
        blockSpeedFactor = 0.4;
      }
      if (blockSpeedFactor === 1.0) {
        const below = this.getBlockBelowAffectingMovement(player, world);
        const blockBelow = this.blockAt(world, below.x, below.y, below.z);
        if (blockBelow && (this.honeyblockId === blockBelow.type || (this.soulsandId === blockBelow.type && soulSpeed === 0))) {
          blockSpeedFactor = 0.4;
        }
      }
    }

    if (this.verGreaterThan("1.20.6")) {
      const factor = player.attributes[this.movementEfficiencyAttribute]?.value ?? 1
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

  checkInsideBlocks(player: PlayerState, world: World, worldSettings = new PhysicsWorldSettings(this.data)) {
    const aabb = player.getBB().expand(-1e-7, -1e-7, -1e-7);
    for (let y = Math.floor(aabb.minY); y <= Math.floor(aabb.maxY); ++y) {
      for (let x = Math.floor(aabb.minX); x <= Math.floor(aabb.maxX); ++x) {
        for (let z = Math.floor(aabb.minZ); z <= Math.floor(aabb.maxZ); ++z) {
          const block = this.blockAt(world, x, y, z);
          if (block == null) continue;
          if (this.webId === block.type) {
            // WebBlock::entityInside
            player.stuckSpeedMultiplier = new Vec3(0.25, 0.05000000074505806, 0.25);
          } else if (this.bubblecolumnId === block.type) {
            const down = !block.metadata;
            const aboveBlock = this.blockOrNullAt(world, x, y + 1, z);
            const bubbleDrag =
              aboveBlock?.type === this.airId
                ? worldSettings.bubbleColumnSurfaceDrag
                : worldSettings.bubbleColumnDrag;
            if (down) {
              player.vel.y = Math.max(bubbleDrag.maxDown, player.vel.y - bubbleDrag.down);
            } else {
              player.vel.y = Math.min(bubbleDrag.maxUp, player.vel.y + bubbleDrag.up);
            }
          } else if (this.honeyblockId === block.type) {
            // Check if sliding down on the side of the block
            if (
              !player.onGround &&
              player.pos.y <= y + 0.9375 - 1e-7 &&
              player.vel.y < -0.08 &&
              (Math.abs(x + 0.5 - player.pos.x) + 1e-7 > 0.4375 + player.halfWidth ||
                Math.abs(z + 0.5 - player.pos.z) + 1e-7 > 0.4375 + player.halfWidth)
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
            const feetBlock = this.blockAt(world, player.pos.x, player.pos.y, player.pos.z);
            if (feetBlock && this.powderSnowId === feetBlock.type) {
              player.stuckSpeedMultiplier = new Vec3(0.8999999761581421, 1.5, 0.8999999761581421);
            }
          }
        }
      }
    }
  }

  collideBoundingBox(world: World, bb: AABB, movement: Vec3, colliders: AABB[] = []): Vec3 {
    // same box as bb.expandTowards(movement)
    let qMinX = bb.minX;
    let qMinY = bb.minY;
    let qMinZ = bb.minZ;
    let qMaxX = bb.maxX;
    let qMaxY = bb.maxY;
    let qMaxZ = bb.maxZ;
    if (movement.x < 0.0) qMinX += movement.x;
    else if (movement.x > 0.0) qMaxX += movement.x;
    if (movement.y < 0.0) qMinY += movement.y;
    else if (movement.y > 0.0) qMaxY += movement.y;
    if (movement.z < 0.0) qMinZ += movement.z;
    else if (movement.z > 0.0) qMaxZ += movement.z;

    // passed colliders first, then block shapes, as flat [minX, minY, minZ, maxX, maxY, maxZ] runs.
    const flat = this.colliderScratch;
    let n = 0;
    for (const c of colliders) {
      flat[n++] = c.minX;
      flat[n++] = c.minY;
      flat[n++] = c.minZ;
      flat[n++] = c.maxX;
      flat[n++] = c.maxY;
      flat[n++] = c.maxZ;
    }
    n = this.collectSurroundingShapes(world, qMinX, qMinY, qMinZ, qMaxX, qMaxY, qMaxZ, true, flat, n);

    if (n === 0) {
      return movement;
    }
    return this.collideWithFlatShapes(movement, bb, flat, n);
  }

  /** Entity::collide axis order (y, then the larger of x/z, then the other) over a flat collider buffer holding `n` values. */
  private collideWithFlatShapes(movement: Vec3, bb: AABB, flat: number[], n: number): Vec3 {
    let dx = movement.x;
    let dy = movement.y;
    let dz = movement.z;

    let minX = bb.minX;
    let minY = bb.minY;
    let minZ = bb.minZ;
    let maxX = bb.maxX;
    let maxY = bb.maxY;
    let maxZ = bb.maxZ;

    if (dy !== 0.0) {
      dy = this.flatShapeCollide(1, minX, minY, minZ, maxX, maxY, maxZ, flat, n, dy);
      if (dy !== 0.0) {
        minY += dy;
        maxY += dy;
      }
    }

    const prioritizeZ = Math.abs(dx) < Math.abs(dz);
    if (prioritizeZ && dz !== 0.0) {
      dz = this.flatShapeCollide(2, minX, minY, minZ, maxX, maxY, maxZ, flat, n, dz);
      if (dz !== 0.0) {
        minZ += dz;
        maxZ += dz;
      }
    }

    if (dx !== 0.0) {
      dx = this.flatShapeCollide(0, minX, minY, minZ, maxX, maxY, maxZ, flat, n, dx);
      if (!prioritizeZ && dx !== 0.0) {
        minX += dx;
        maxX += dx;
      }
    }

    if (!prioritizeZ && dz !== 0.0) {
      dz = this.flatShapeCollide(2, minX, minY, minZ, maxX, maxY, maxZ, flat, n, dz);
    }

    return new Vec3(dx, dy, dz);
  }

  /** shapeCollide + voxelShapeCollide over a flat collider buffer. */
  private flatShapeCollide(
    axis: number,
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    flat: number[],
    n: number,
    movement: number,
  ): number {
    if (Math.abs(movement) < COLLISION_EPSILON) {
      return 0.0;
    }

    // bb extents on the swept axis (a0) and the two others (a1, a2), and the matching buffer offsets.
    let min0: number, max0: number, min1: number, max1: number, min2: number, max2: number;
    let o0: number, o1: number, o2: number;
    if (axis === 0) {
      min0 = minX; max0 = maxX; min1 = minY; max1 = maxY; min2 = minZ; max2 = maxZ;
      o0 = 0; o1 = 1; o2 = 2;
    } else if (axis === 1) {
      min0 = minY; max0 = maxY; min1 = minZ; max1 = maxZ; min2 = minX; max2 = maxX;
      o0 = 1; o1 = 2; o2 = 0;
    } else {
      min0 = minZ; max0 = maxZ; min1 = minX; max1 = maxX; min2 = minY; max2 = maxY;
      o0 = 2; o1 = 0; o2 = 1;
    }

    let adjustedMovement = movement;
    for (let i = 0; i < n; i += 6) {
      const overlapsAxis1 = max1 - COLLISION_EPSILON > flat[i + o1] && min1 + COLLISION_EPSILON < flat[i + 3 + o1];
      const overlapsAxis2 = max2 - COLLISION_EPSILON > flat[i + o2] && min2 + COLLISION_EPSILON < flat[i + 3 + o2];
      if (!overlapsAxis1 || !overlapsAxis2) {
        continue;
      }

      if (movement > 0) {
        const gap = flat[i + o0] - max0;
        if (gap >= -COLLISION_EPSILON) {
          adjustedMovement = Math.min(adjustedMovement, gap);
        }
      } else {
        const gap = flat[i + 3 + o0] - min0;
        if (gap <= COLLISION_EPSILON) {
          adjustedMovement = Math.max(adjustedMovement, gap);
        }
      }
    }

    return adjustedMovement;
  }


  shapeCollide(axis: number, bb: AABB, colliders: AABB[], movement: number): number {
    if (Math.abs(movement) < COLLISION_EPSILON) {
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
  /**
   * Handles collision detection and response along a single axis.
   * @param axis The axis to check for collision (0 = X, 1 = Y, 2 = Z)
   * @param bb The bounding box that's moving
   * @param movement The proposed movement amount along the specified axis
   * @param colliders Array of AABBs to check for collisions with
   * @returns The adjusted movement amount that prevents collisions
   */
  private voxelShapeCollide(axis: number, bb: AABB, movement: number, colliders: AABB[]): number {
    if (Math.abs(movement) < COLLISION_EPSILON) {
      return 0;
    }
    if (colliders.length === 0) {
      return movement;
    }

    let adjustedMovement = movement;
    const axis1 = (axis + 1) % 3;
    const axis2 = (axis + 2) % 3;

    const getMin = (aabb: AABB, ax: number) => {
      if (ax === 0) return aabb.minX;
      if (ax === 1) return aabb.minY;
      return aabb.minZ;
    };
    const getMax = (aabb: AABB, ax: number) => {
      if (ax === 0) return aabb.maxX;
      if (ax === 1) return aabb.maxY;
      return aabb.maxZ;
    };

    for (const collider of colliders) {
      const overlapsAxis1 =
        getMax(bb, axis1) - COLLISION_EPSILON > getMin(collider, axis1) &&
        getMin(bb, axis1) + COLLISION_EPSILON < getMax(collider, axis1);
      const overlapsAxis2 =
        getMax(bb, axis2) - COLLISION_EPSILON > getMin(collider, axis2) &&
        getMin(bb, axis2) + COLLISION_EPSILON < getMax(collider, axis2);

      if (!overlapsAxis1 || !overlapsAxis2) {
        continue;
      }

      if (movement > 0) {
        const gap = getMin(collider, axis) - getMax(bb, axis);
        if (gap >= -COLLISION_EPSILON) {
          adjustedMovement = Math.min(adjustedMovement, gap);
        }
      } else {
        const gap = getMax(collider, axis) - getMin(bb, axis);
        if (gap <= COLLISION_EPSILON) {
          adjustedMovement = Math.max(adjustedMovement, gap);
        }
      }
    }

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
    // Add slowdown when using items (like food)
    if (player.isUsingItem) {
      inputStrength *= Math.fround(0.2);
    }

    // Use flySpeed for horizontal movement when flying
    if (player.flying) {
      inputStrength *= player.flySpeed * 40;
    }

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

    const feetBlock = this.blockAt(world, player.pos.x, player.pos.y, player.pos.z);
    // TODO: if trapdoor AND below block is a ladder with the same facing property
    // as the trapdoor then the trapdoor is a climbable block too

    // TODO: make climbables a set.
    return feetBlock != null && (this.vineId === feetBlock.type || this.ladderId === feetBlock.type || this.scaffoldId === feetBlock.type);
  }

  getSupportingBlockPos(world: World, feetSliceAABB: AABB): Vec3 | null {
    const { minX, minY, minZ, maxX, maxY, maxZ } = feetSliceAABB;
    // AABB.getCenter() of the slice, then of each colliding shape: lerp(0.5, min, max)
    const centerX = minX + 0.5 * (maxX - minX);
    const centerY = minY + 0.5 * (maxY - minY);
    const centerZ = minZ + 0.5 * (maxZ - minZ);
    let minDistance = Infinity;
    let ret = null;
    for (let y = Math.floor(minY - 1); y <= Math.floor(maxY); ++y) {
      for (let x = Math.floor(minX); x <= Math.floor(maxX); ++x) {
        for (let z = Math.floor(minZ); z <= Math.floor(maxZ); ++z) {
          const block = this.blockAt(world, x, y, z);
          if (block == null || block.emptyBB) continue;
          for (const shape of block.shapes) {
            const sMinX = shape[0] + x;
            const sMinY = shape[1] + y;
            const sMinZ = shape[2] + z;
            const sMaxX = shape[3] + x;
            const sMaxY = shape[4] + y;
            const sMaxZ = shape[5] + z;
            // AABB.collides
            if (minX <= sMaxX && maxX >= sMinX && minY <= sMaxY && maxY >= sMinY && minZ <= sMaxZ && maxZ >= sMinZ) {
              const dx = sMinX + 0.5 * (sMaxX - sMinX) - centerX;
              const dy = sMinY + 0.5 * (sMaxY - sMinY) - centerY;
              const dz = sMinZ + 0.5 * (sMaxZ - sMinZ) - centerZ;
              const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
              if (distance < minDistance) {
                minDistance = distance;
                ret = new Vec3(x, y, z);
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
    const { memoGen, memoX, memoY, memoZ } = this;
    if (this.lastMemoGen === 0x7fffffff) {
      this.memoStamps.fill(0);
      this.lastMemoGen = 0;
    }
    this.memoGen = ++this.lastMemoGen;
    this.memoX = Math.floor(entity.state.pos.x);
    this.memoY = Math.floor(entity.state.pos.y);
    this.memoZ = Math.floor(entity.state.pos.z);
    try {
      this.physicsTick(entity, world);
    } finally {
      this.memoGen = memoGen;
      this.memoX = memoX;
      this.memoY = memoY;
      this.memoZ = memoZ;
    }
    entity.state.age++;
    return entity.state;
  }
}
