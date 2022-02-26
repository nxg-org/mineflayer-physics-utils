import { AABB } from "@nxg-org/mineflayer-util-plugin";
import { IndexedData } from "minecraft-data";
import { Effect } from "mineflayer";
import { Block } from "prismarine-block";
import { Entity } from "prismarine-entity";
import { PhysicsSettings } from "../settings/physicsSettings";
import { EPhysicsCtx } from "../settings/entityPhysicsCtx";
import { CheapEffects, CheapEnchantments, makeSupportFeature } from "../settings/physicsUtils";

export type MobsByName = { [mobName: string]: Entity };
export interface IPhysics {
    settings: PhysicsSettings;
    data: IndexedData;
    supportFeature: ReturnType<typeof makeSupportFeature>;
    getEffectLevel: (effect: string, effects: Effect[]) => number;
    getEnchantmentLevel: (effect: string, enchantments: any[]) => number;
    getEffectLevelCustom: (effect: CheapEffects, effects: Effect[]) => number;
    getEnchantmentLevelCustom: (effect: CheapEnchantments, enchantments: any[]) => number;
    getUnderlyingBlockBBs(queryBB: AABB, world: any): AABB[];
    getSurroundingBBs(queryBB: AABB, world: any): AABB[];
    simulatePlayer(simCtx: EPhysicsCtx, world: any): EPhysicsCtx;

    readonly statusEffectNames: { [type in CheapEffects]: string };
    readonly enchantmentNames: { [type in CheapEnchantments]: string };
}
