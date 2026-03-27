import type { Bot, ControlState } from "mineflayer";
import { Vec3 } from "vec3";
import { BotcraftPhysics } from "../../../src/physics/engines";
import { ControlStateHandler } from "../../../src/physics/player";
import { EPhysicsCtx } from "../../../src/physics/settings";
import { PlayerState } from "../../../src/physics/states";
import { applyMdToNewEntity } from "../../../src/util/physicsUtils";
import { createFlatWorld, loadMcData } from "./botcraftTestSupport";

const defaultVersion = "1.21.4";
const defaultGroundLevel = 67;
const control: Partial<Record<ControlState, boolean>> = {};

export type MovementDeltaSample = {
  x: number;
  y: number;
  z: number;
  onGround: boolean;
  fallFlying: boolean;
  velX: number;
  velY: number;
  velZ: number;
};

export function collectMovementDeltas(options: {
  version?: string;
  groundY?: number;
  ticks: number;
  startFallFlyingTick?: number;
  holdJump?: boolean;
  releaseJumpTick?: number;
  holdForward?: boolean;
  yaw?: number;
  pitch?: number;
}) {
  for (const key of Object.keys(control)) {
    delete control[key as ControlState];
  }

  const version = options.version ?? defaultVersion;
  const baseY = options.groundY ?? defaultGroundLevel;
  const { mcData } = loadMcData(version);
  const fakePlayer: any = {
    entity: {
      position: new Vec3(0, baseY, 0),
      velocity: new Vec3(0, 0, 0),
      onGround: true,
      isInWater: false,
      isInLava: false,
      isInWeb: false,
      isCollidedHorizontally: false,
      isCollidedVertically: false,
      yaw: options.yaw ?? 0,
      pitch: options.pitch ?? 0,
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
    getEquipmentDestSlot: () => 6,
  };

  fakePlayer.inventory.slots[6] = { name: "elytra" };
  fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, mcData.entitiesByName.player, fakePlayer.entity);

  const physics = new BotcraftPhysics(mcData);
  const playerCtx = EPhysicsCtx.FROM_BOT(physics, fakePlayer as Bot);
  const playerState = playerCtx.state as PlayerState;
  const fakeWorld = createFlatWorld(version, baseY) as any;

  playerState.control = ControlStateHandler.DEFAULT();
  playerState.control.jump = options.holdJump ?? true;
  playerState.control.forward = options.holdForward ?? false;
  playerState.yaw = options.yaw ?? 0;
  playerState.pitch = options.pitch ?? 0;

  const deltas: MovementDeltaSample[] = [];
  for (let i = 0; i < options.ticks; i++) {
    if (options.releaseJumpTick != null && i === options.releaseJumpTick) {
      playerState.control.jump = false;
    }

    if (options.startFallFlyingTick != null && i === options.startFallFlyingTick) {
      playerState.fallFlying = true;
      fakePlayer.entity.fallFlying = true;
    }

    const previousPos = playerState.pos.clone();
    physics.simulate(playerCtx, fakeWorld);
    playerState.apply(fakePlayer);
    deltas.push({
      x: playerState.pos.x - previousPos.x,
      y: playerState.pos.y - previousPos.y,
      z: playerState.pos.z - previousPos.z,
      onGround: playerState.onGround,
      fallFlying: playerState.fallFlying,
      velX: playerState.vel.x,
      velY: playerState.vel.y,
      velZ: playerState.vel.z,
    });
  }

  return deltas;
}
