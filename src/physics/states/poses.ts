import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { Vec3 } from "vec3";

//0: STANDING, 1: FALL_FLYING, 2: SLEEPING, 3: SWIMMING, 4: SPIN_ATTACK, 5: SNEAKING, 6: LONG_JUMPING, 7: DYING
export enum PlayerPoses {
  STANDING,
  FALL_FLYING,
  SLEEPING,
  SWIMMING,
  SPIN_ATTACK, // dunno
  SNEAKING,
  LONG_JUMPING,
  DYING,
}

/**
 * From minecraft's Player.java file.
 */

type PlayerPoseContext = { [key in PlayerPoses]: { width: number; height: number } };

export const playerPoseCtx: PlayerPoseContext = {
  0: { width: 0.6, height: 1.8 },
  1: { width: 0.6, height: 0.6 },
  2: { width: 0.2, height: 0.2 },
  3: { width: 0.6, height: 0.6 },
  4: { width: 0.6, height: 0.6 },
  5: { width: 0.6, height: 1.5 },
  6: { width: 0.6, height: 1.8 },
  7: { width: 0.2, height: 0.2 },
};

export function getCollider(entityPose: PlayerPoses, middleBottomPos: Vec3, scale: number = 1.0): AABB {
  let { width, height } = playerPoseCtx[entityPose];
  if (scale !== 1.0 && entityPose !== PlayerPoses.SLEEPING && entityPose !== PlayerPoses.DYING) {
    width *= scale;
    height *= scale;
  }
  return new AABB(-width / 2, 0, -width / 2, width / 2, height, width / 2).translate(
    middleBottomPos.x,
    middleBottomPos.y,
    middleBottomPos.z
  );
}
