import testInit from "./util/testUtils";
import expect from "expect";

import physicsLoader, { EntityState, EPhysicsCtx, initSetup } from "../index";
import { applyMdToNewEntity } from "../util/physicsUtils";
import { Vec3 } from "vec3";
import { EntityPhysics } from "../physics/engines";
import { BasicSim } from "../simulators";
import { ControlStateHandler } from "../physics/player";
import { PhysicsUtilWrapper, SimulationTypes } from "../wrapper";

const { mcData, Block, Entity, fakeWorld, createFakePlayer, createFakeEntity, modifyEntity} = testInit("1.17.1");

//create fake bot
const bot: any = createFakePlayer(new Vec3(0, 60, 0)); // call function supplied by prismarine-physics
const physicsUtil = new PhysicsUtilWrapper(bot);


const fakeEntity = createFakeEntity("player", new Vec3(0, 80, 0))

physicsUtil.exampleSim(fakeEntity, SimulationTypes.UNTIL_GROUND, 40).applyToEntity(fakeEntity);


expect(fakeEntity.position).toEqual(new Vec3(0, 60, 0)); // it works.
console.log(fakeEntity.position); //manual run.


modifyEntity("cat", fakeEntity)
const ctx = physicsUtil.getPhysicsCtx(physicsUtil.engine, fakeEntity);
ctx.state.controlState.set("forward", true)

physicsUtil.advancedExample(ctx, SimulationTypes.FOR_X_TICKS, 40).applyToEntity(fakeEntity);
console.log(fakeEntity.position); //manual run.

