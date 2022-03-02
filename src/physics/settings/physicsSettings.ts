import { Entity } from "prismarine-entity";
import { IPhysics } from "../engines/IPhysics";
import md from "minecraft-data";

type BubbleColumnInfo = {
    down: number;
    maxDown: number;
    up: number;
    maxUp: number;
};

function load(data: md.IndexedData) {
    PhysicsSettings.mcData = data
    PhysicsSettings.entityData = data["entitiesByName"]
    PhysicsSettings.mobData = data["mobs"]
}

export class PhysicsSettings {
    public static loadData: (data: md.IndexedData) => void = load
    public static mcData: md.IndexedData;
    public static entityData: md.IndexedData["entitiesByName"];
    public static mobData:  md.IndexedData["mobs"];


    public static yawSpeed: number = 3.0;
    public static pitchSpeed: number = 3.0;
    public static playerSpeed: number = 0.1;
    public static stepHeight: number = 0.6; // how much height can the bot step on without jump
    public static negligeableVelocity: number = 0.003; // actually 0.005 for 1.8; but seems fine
    public static soulsandSpeed: number = 0.4;
    public static honeyblockSpeed: number = 0.4;
    public static honeyblockJumpSpeed: number = 0.4;
    public static ladderMaxSpeed: number = 0.15;
    public static ladderClimbSpeed: number = 0.2;
    public static waterInertia: number = 0.8;
    public static lavaInertia: number = 0.5;
    public static liquidAcceleration: number = 0.02;
    public static defaultSlipperiness: number = 0.6;
    public static outOfLiquidImpulse: number = 0.3;
    public static autojumpCooldown: number = 10; // ticks (0.5s)
    public static bubbleColumnSurfaceDrag: BubbleColumnInfo = {
        down: 0.03,
        maxDown: -0.9,
        up: 0.1,
        maxUp: 1.8,
    };
    public static bubbleColumnDrag: BubbleColumnInfo = {
        down: 0.03,
        maxDown: -0.3,
        up: 0.06,
        maxUp: 0.7,
    };
    public static slowFalling: number = 0.125;
    public static sprintingUUID: string = "662a6b8d-da3e-4c1c-8813-96ea6097278d"; // SPEED_MODIFIER_SPRINTING_UUID is from LivingEntity.java
    public static jumpHeight: number = Math.fround(0.42);

    public static airborneInertia: number = 0.91;
    public static airborneAcceleration: number = 0.02;

    public static sprintSpeed: number = Math.fround(0.3);
    public static sneakSpeed: number = 0.3;
    public static usingItemSpeed: number = 0.2;
}
