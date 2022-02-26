// 0: STANDING, 1: FALL_FLYING, 2: SLEEPING, 3: SWIMMING, 4: SPIN_ATTACK, 5: SNEAKING, 6: LONG_JUMPING, 7: DYING
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

export const PlayerPosesByNumber = {
  0: PlayerPoses.STANDING,
  1: PlayerPoses.FALL_FLYING,
  2: PlayerPoses.SLEEPING,
  3: PlayerPoses.SWIMMING,
  4: PlayerPoses.SPIN_ATTACK, // dunno
  5: PlayerPoses.SNEAKING,
  6: PlayerPoses.LONG_JUMPING,
  7: PlayerPoses.DYING
} as const
