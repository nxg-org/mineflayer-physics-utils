import type { Entity } from "prismarine-entity";
import type { Effect } from "mineflayer";
import { EntityPhysics } from "../src/physics/engines";
import { EntityState } from "../src/physics/states";
import { EPhysicsCtx, PhysicsWorldSettings } from "../src/physics/settings";
import { applyMdToNewEntity } from "../src/util/physicsUtils";
import { ControlStateHandler } from "../src/physics/player";
import { Vec3 } from "vec3";
import md from "minecraft-data";
import block from "prismarine-block";
import expect from "expect";

import { initSetup } from "../src/index";

const mcData = md("1.12.2");
const Block = (block as any)("1.12.2");

const groundLevel = 4;

const fakeWorld = {
    getBlock: (pos: { x: number; y: number; z: number }) => {
        const type = pos.y < groundLevel ? mcData.blocksByName.stone.id : mcData.blocksByName.air.id;
        const b = new Block(type, 0, 0);
        b.position = pos;
        return b;
    },
};

function createFakePlayer(pos: Vec3) {
    return {
        entity: {
            position: pos,
            velocity: new Vec3(0, 0, 0),
            onGround: false,
            isInWater: false,
            isInLava: false,
            isInWeb: false,
            isCollidedHorizontally: false,
            isCollidedVertically: false,
            yaw: 0,
            effects: {} as Effect[],
        } as unknown as Entity,
        jumpTicks: 0,
        jumpQueued: false,
        version: "1.17.1",
        inventory: {
            slots: [],
        },

        setControlState: (...args: any) => {}
    };
}


//init (imports mcData to necessary modules).
initSetup(mcData);

//create fake bot
const playerType = mcData.entitiesByName["player"]; // specify type we will be simulating.
const fakePlayer = createFakePlayer(new Vec3(0, groundLevel + 20, 0)); // call function supplied by prismarine-physics
fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, playerType, fakePlayer.entity); // ensure compatibility.

// create physics context.
const physics = new EntityPhysics(mcData); // creates entity physics w/ environments specific to this entity.

// create entity-specific physics context.
const playerState = EntityState.CREATE_FROM_ENTITY(physics, fakePlayer.entity); // creates a simulation-compatible state.
const playerCtx = EPhysicsCtx.FROM_ENTITY_STATE(physics, playerState, playerType); // create wrapper context (supplies AABB, pose info, etc).

// set control state.
playerState.control = ControlStateHandler.DEFAULT(); // specific to players and mobs, specify control scheme to apply.
playerState.control.forward = true;


// simulate until on ground.
while (!playerCtx.state.onGround) {
    physics.simulate(playerCtx, fakeWorld).applyToBot(fakePlayer as any); // (applyToBot since fakePlayer is supposed to be a bot)
    // console.log(fakePlayer.entity.position, fakePlayer.entity.velocity);
}

if (playerState.control.forward) {
    expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel, -3.4508449226731694)); // it works.
} else {
    expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel, 0)); // it works.
}

playerCtx.state.control.set("jump", true);
for (let i = 0; i < 12; i++) {
    physics.simulate(playerCtx, fakeWorld).applyToBot(fakePlayer as any); // (applyToBot since fakePlayer is supposed to be a bot)
    // console.log(fakePlayer.entity.position, fakePlayer.entity.velocity);
}

if (playerState.control.forward) {
    expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel, -5.788782872583908)); // it works.
} else {
    expect(fakePlayer.entity.position).toEqual(new Vec3(0, groundLevel, 0)); // it works.
}


console.log(fakePlayer.entity.position); //manual run.