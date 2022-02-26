import { IPhysics } from "../engines/IPhysics";
import { Physics } from "../engines/physics";

type BubbleColumnInfo = {
    down: number;
    maxDown: number;
    up: number;
    maxUp: number;
};

export class PhysicsSettings {
    public gravity: number = 0.08;
    public airdrag: number = Math.fround(1 - 0.02);
    public yawSpeed: number = 3.0;
    public pitchSpeed: number = 3.0;
    public playerSpeed: number = 0.1;
    public sprintSpeed: number = 0.3;
    public sneakSpeed: number = 0.3;
    public usingItemSpeed: number = 0.2;
    public stepHeight: number = 0.6; // how much height can the bot step on without jump
    public negligeableVelocity: number = 0.003; // actually 0.005 for 1.8; but seems fine
    public soulsandSpeed: number = 0.4;
    public honeyblockSpeed: number = 0.4;
    public honeyblockJumpSpeed: number = 0.4;
    public ladderMaxSpeed: number = 0.15;
    public ladderClimbSpeed: number = 0.2;
    public playerHalfWidth: number = 0.3;
    public playerHeight: number = 1.8;
    public waterInertia: number = 0.8;
    public waterGravity: number;
    public lavaInertia: number = 0.5;
    public lavaGravity: number;
    public liquidAcceleration: number = 0.02;
    public airborneInertia: number = 0.91
    public airborneAcceleration: number = 0.02;
    public defaultSlipperiness: number = 0.6;
    public outOfLiquidImpulse: number = 0.3;
    public autojumpCooldown: number = 10; // ticks (0.5s)
    public bubbleColumnSurfaceDrag: BubbleColumnInfo = {
        down: 0.03,
        maxDown: -0.9,
        up: 0.1,
        maxUp: 1.8,
    };
    public bubbleColumnDrag: BubbleColumnInfo = {
        down: 0.03,
        maxDown: -0.3,
        up: 0.06,
        maxUp: 0.7,
    };
    public slowFalling: number = 0.125;
    public movementSpeedAttribute: any; //dunno yet
    public sprintingUUID: string = "662a6b8d-da3e-4c1c-8813-96ea6097278d"; // SPEED_MODIFIER_SPRINTING_UUID is from LivingEntity.java

    constructor(ctx: IPhysics) {
        // this.waterGravity = 0.02;
        // this.lavaGravity = 0.02;
        this.movementSpeedAttribute = (ctx.data.attributesByName.movementSpeed as any).resource;

        if (ctx.supportFeature("independentLiquidGravity")) {
            this.waterGravity = 0.02;
            this.lavaGravity = 0.02;
        } else if (ctx.supportFeature("proportionalLiquidGravity")) {
            this.waterGravity = this.gravity / 16;
            this.lavaGravity = this.gravity / 4;
        } else {
            this.waterGravity = 0.005;
            this.lavaGravity = 0.02;
        }
    }


    // May move this later.

    public getHeight(obj: {}) {
        this.bubbleColumnDrag
    }
}