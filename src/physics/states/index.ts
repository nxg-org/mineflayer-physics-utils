import type { Effect, Entity } from "prismarine-entity";
import type {Vec3} from "vec3";
import { PlayerPoses } from "./poses";
import { ControlStateHandler } from "../states";

export * from "./entityState"
export * from "./playerState"
export * from "./poses"

export type Heading = {
    forward: number;
    strafe: number;
}

export interface IEntityState {
    age: number;
    height: number;
    halfWidth: number;
    pos: Vec3;
    vel: Vec3;
    pitch: number;
    yaw: number;
    pose: PlayerPoses;
    control: ControlStateHandler;
    onGround: boolean;
    onClimbable: boolean;

    attributes: Entity["attributes"];

    isUsingItem: boolean;
    isInWater: boolean;
    isInLava: boolean;
    isInWeb: boolean;
    elytraFlying: boolean;
    elytraEquipped: boolean;
    fireworkRocketDuration: number;
    sneakCollision: boolean;
    isCollidedHorizontally: boolean;
    isCollidedVertically: boolean;

    effects: Effect[];
    jumpBoost: number;
    speed: number;
    slowness: number;
    dolphinsGrace: number;
    slowFalling: number;
    levitation: number;
    depthStrider: number;

    jumpTicks: number;
    jumpQueued: boolean;

    supportingBlockPos: Vec3 | null;

    clone(): IEntityState;
}

export function getPose(entity: Entity) {
    const pose = entity.metadata.find((e) => (e as any)?.type === 18);
    return pose ? ((pose as any).value as number) : PlayerPoses.STANDING;
}