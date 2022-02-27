import testInit from "./util/testUtils";
import expect from "expect";

import physicsLoader, { EntityState, EPhysicsCtx, initSetup } from "../index";
import { applyMdToNewEntity } from "../util/physicsUtils";
import { Vec3 } from "vec3";
import { EntityPhysics } from "../physics/engines";
import { BasicSim } from "../simulators";
import { ControlStateHandler } from "../physics/player";
import { PhysicsUtilWrapper, SimulationTypes } from "../wrapper";

const { mcData, Block, fakeWorld, createFakePlayer } = testInit("1.17.1");

//create fake bot
const bot: any = createFakePlayer(new Vec3(0, 60, 0)); // call function supplied by prismarine-physics
const physicsUtil = new PhysicsUtilWrapper(bot);

const fakePlayer = createFakePlayer(new Vec3(0, 80, 0)).entity;

(async () => {
    const result = await physicsUtil.exampleSim(fakePlayer, SimulationTypes.UNTIL_GROUND, 50);
    result.applyToEntity(fakePlayer);

    expect(fakePlayer.position).toEqual(new Vec3(0, 60, 0)); // it works.
    console.log(fakePlayer.position); //manual run.
})();
