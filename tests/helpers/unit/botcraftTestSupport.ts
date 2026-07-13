import type { Bot, ControlState } from "mineflayer";
import md from "minecraft-data";
import block, { Block as PBlock } from "prismarine-block";
import { Vec3 } from "vec3";
import { initSetup } from "../../../src";
import { BotcraftPhysics, BoatPhysics, HorsePhysics } from "../../../src/physics/engines";
import { ControlStateHandler } from "../../../src/physics/player";
import { EPhysicsCtx } from "../../../src/physics/settings";
import { BoatState, HorseState, PlayerState } from "../../../src/physics/states";
import { applyMdToNewEntity } from "../../../src/util/physicsUtils";
import type { Entity } from "prismarine-entity";

const initializedVersions = new Set<string>();

export function loadMcData(version: string) {
  const mcData = md(version);
  if (!initializedVersions.has(version)) {
    initSetup(mcData);
    initializedVersions.add(version);
  }

  return {
    mcData,
    Block: block(version) as typeof PBlock,
  };
}

export class FlatWorld {
  private readonly overrideBlocks: Record<string, PBlock> = {};

  constructor(
    private readonly blocksByName: ReturnType<typeof md>["blocksByName"],
    private readonly Block: typeof PBlock,
    private readonly floorY: number,
  ) {}

  setOverrideBlock(pos: Vec3, type: number) {
    const blockPos = pos.floored();
    const block = new this.Block(type, 0, 0);
    block.position = blockPos;
    this.overrideBlocks[this.keyFor(blockPos)] = block;
  }

  clearOverrides() {
    for (const key of Object.keys(this.overrideBlocks)) {
      delete this.overrideBlocks[key];
    }
  }

  getBlock(pos: Vec3) {
    const blockPos = pos.floored();
    const override = this.overrideBlocks[this.keyFor(blockPos)];
    if (override) {
      return override;
    }

    const type = blockPos.y < this.floorY ? this.blocksByName.stone.id : this.blocksByName.air.id;
    const block = new this.Block(type, 0, 0);
    block.position = blockPos;
    return block;
  }

  private keyFor(pos: Vec3) {
    return `${pos.x},${pos.y},${pos.z}`;
  }
}

function createFakePlayer(
  version: string,
  mcData: ReturnType<typeof md>,
  pos: Vec3,
  groundLevel: number,
) {
  const onGround = pos.y === groundLevel;
  const control: Partial<Record<ControlState, boolean>> = {};

  return {
    entity: {
      position: pos,
      velocity: new Vec3(0, onGround ? -0.08 : 0, 0),
      onGround,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: false,
      yaw: 0,
      pitch: 0,
      effects: [],
      attributes: {},
    },
    jumpTicks: 0,
    jumpQueued: false,
    version,
    inventory: { slots: [] },
    equipment: [],
    food: 20,
    game: { gameMode: "survival" },
    registry: mcData,
    setControlState: (name: ControlState, value: boolean) => {
      control[name] = value;
    },
    getControlState: (name: ControlState) => control[name] ?? false,
    getEquipmentDestSlot: () => {},
  };
}

export function createFlatWorld(version: string, floorY: number) {
  const { mcData, Block } = loadMcData(version);
  return new FlatWorld(mcData.blocksByName, Block, floorY);
}

export function createBotcraftPlayerRig(options: {
  version: string;
  position: Vec3;
  groundLevel?: number;
}) {
  const { version, position } = options;
  const groundLevel = options.groundLevel ?? position.y;
  const { mcData } = loadMcData(version);

  const fakePlayer: any = createFakePlayer(version, mcData, position.clone(), groundLevel);
  fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, fakePlayer.entity);

  const physics = new BotcraftPhysics(mcData);
  const playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as Bot);
  const playerState = playerCtx.state as PlayerState;
  playerState.control = ControlStateHandler.DEFAULT();

  return {
    mcData,
    fakePlayer,
    physics,
    playerCtx,
    playerState,
  };
}

export class BoatTestWorld {
  private readonly overrideBlocks: Record<string, PBlock> = {};

  constructor(
    private readonly blocksByName: ReturnType<typeof md>["blocksByName"],
    private readonly Block: typeof PBlock,
    private readonly floorY: number,
  ) {}

  setBlock(pos: Vec3, type: number, metadata = 0) {
    const blockPos = pos.floored();
    const blockInstance = new this.Block(type, 0, metadata);
    blockInstance.position = blockPos;
    this.overrideBlocks[this.keyFor(blockPos)] = blockInstance;
  }

  setWater(pos: Vec3, metadata = 0) {
    this.setBlock(pos, this.blocksByName.water.id, metadata);
  }

  setStone(pos: Vec3) {
    this.setBlock(pos, this.blocksByName.stone.id, 0);
  }

  setIce(pos: Vec3) {
    this.setBlock(pos, this.blocksByName.ice.id, 0);
  }

  clearOverrides() {
    for (const key of Object.keys(this.overrideBlocks)) {
      delete this.overrideBlocks[key];
    }
  }

  getBlock(pos: Vec3): PBlock | null {
    const blockPos = pos.floored();
    const override = this.overrideBlocks[this.keyFor(blockPos)];
    if (override) {
      return override;
    }

    const type = blockPos.y <= this.floorY ? this.blocksByName.stone.id : this.blocksByName.air.id;
    const blockInstance = new this.Block(type, 0, 0);
    blockInstance.position = blockPos;
    return blockInstance;
  }

  private keyFor(pos: Vec3) {
    return `${pos.x},${pos.y},${pos.z}`;
  }
}

export function createBoatTestWorld(version: string, floorY: number) {
  const { mcData, Block } = loadMcData(version);
  return new BoatTestWorld(mcData.blocksByName, Block, floorY);
}

export function createBoatRig(options: {
  version: string;
  position: Vec3;
  floorY?: number;
}) {
  const { version, position } = options;
  const floorY = options.floorY ?? Math.floor(position.y) - 1;
  const { mcData } = loadMcData(version);

  const physics = new BoatPhysics(mcData);
  const boatEntityType = mcData.entitiesByName.boat;
  const boatState = BoatState.CREATE_FROM_ENTITY(physics, {
    position: position.clone(),
    velocity: new Vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    height: 0.5625,
    width: 1.375,
    onGround: false,
    name: "boat",
  } as unknown as Entity);
  boatState.control = ControlStateHandler.DEFAULT();

  const boatCtx = EPhysicsCtx.FROM_ENTITY_STATE(physics, boatState, boatEntityType);
  const world = createBoatTestWorld(version, floorY);

  return {
    mcData,
    physics,
    boatState,
    boatCtx,
    world,
  };
}

export function simulateBoatTick(rig: ReturnType<typeof createBoatRig>) {
  rig.physics.simulate(rig.boatCtx, rig.world);
}

export function createHorseRig(options: {
  version: string;
  position: Vec3;
  floorY?: number;
  attributes?: Record<string, { value: number; modifiers: Array<{ uuid: string; operation: number; amount: number }> }>;
}) {
  const { version, position } = options;
  const floorY = options.floorY ?? Math.floor(position.y) - 1;
  const { mcData } = loadMcData(version);

  const physics = new HorsePhysics(mcData);
  const horseEntityType = mcData.entitiesByName.horse;
  const horseState = HorseState.CREATE_FROM_ENTITY(physics, {
    position: position.clone(),
    velocity: new Vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    height: 1.6,
    width: 1.3964844,
    onGround: true,
    name: "horse",
    attributes: options.attributes,
    metadata: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x04],
  } as unknown as Entity);
  horseState.control = ControlStateHandler.DEFAULT();
  horseState.saddled = true;

  const horseCtx = EPhysicsCtx.FROM_ENTITY_STATE(physics, horseState, horseEntityType);
  horseCtx.stepHeight = 1.0;
  const world = createBoatTestWorld(version, floorY);

  return {
    mcData,
    physics,
    horseState,
    horseCtx,
    world,
  };
}

export function simulateHorseTick(rig: ReturnType<typeof createHorseRig>) {
  rig.physics.simulate(rig.horseCtx, rig.world);
}

export function fillWaterColumn(world: BoatTestWorld, x: number, z: number, fromY: number, toY: number, metadata = 0) {
  for (let y = fromY; y <= toY; y++) {
    world.setWater(new Vec3(x, y, z), metadata);
  }
}
