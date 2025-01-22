import { Entity } from "prismarine-entity";
import { PlayerPoses } from "./poses";

export * from "./entityState"
export * from "./playerState"
export * from "./poses"

export function getPose(entity: Entity) {
    const pose = entity.metadata.find((e) => (e as any)?.type === 18);
    return pose ? ((pose as any).value as number) : PlayerPoses.STANDING;
}