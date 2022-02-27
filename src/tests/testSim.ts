import { EntityPhysics } from "../physics/engines";
import { EntityState } from "../physics/states";
import { EPhysicsCtx, PhysicsSettings } from "../physics/settings";
import { applyMdToNewEntity } from "../util/physicsUtils";
import { ControlStateHandler } from "../physics/player";
import { Vec3 } from "vec3";
import expect from "expect";
import { initSetup } from "../index";
import { BasicSim } from "../simulators";
import testInit from "./util/testUtils";


//init (imports mcData to necessary modules).
const {mcData, Block, fakeWorld, createFakePlayer} = testInit("1.17.1");
initSetup(mcData);

//create fake bot
const playerType = mcData.entitiesByName["player"]; // specify type we will be simulating.
const fakePlayer = createFakePlayer(new Vec3(0, 80, 0)); // call function supplied by prismarine-physics
fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, playerType, fakePlayer.entity); // ensure compatibility.

// create physics context.
const physics = new EntityPhysics(mcData, playerType); // creates entity physics w/ environments specific to this entity.
const simulator = new BasicSim(physics); // creates a wrapper around physics supplying basic simulation info.

// create entity-specific physics context.
const playerState = EntityState.CREATE_FROM_ENTITY(physics, fakePlayer.entity); // creates a simulation-compatible state.
const playerCtx = EPhysicsCtx.FROM_ENTITY_STATE(physics, playerState, playerType); // create wrapper context (supplies AABB, pose info, etc).

// set control state.
playerState.controlState = ControlStateHandler.DEFAULT(); // specific to players and mobs, specify control scheme to apply.


(async () => {
    const result = await simulator.simUntilOnGround(playerCtx, fakeWorld, 50) // get resulting state (same as original)
    result.applyToBot(fakePlayer as any); // apply to fake bot

    expect(fakePlayer.entity.position).toEqual(new Vec3(0, 60, 0)); // it works.
    console.log(fakePlayer.entity.position); //manual run.
})();
