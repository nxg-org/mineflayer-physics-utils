
import type { Entity } from "prismarine-entity";
import type { Effect } from "mineflayer";
import { EntityPhysics } from "../physics/engines";
import { EntityState } from "../physics/states";
import { EPhysicsCtx, PhysicsSettings } from "../physics/settings";
import { applyMdToNewEntity } from "../util/physicsUtils";
import { ControlStateHandler } from "../physics/player";
import { Vec3 } from "vec3";
import md from "minecraft-data";
import block from "prismarine-block"
import expect from "expect"

import { initSetup } from "../index";


const mcData = md('1.17.1')
const Block = (block as any)('1.17.1')

const fakeWorld = {
  getBlock: (pos: {x: number, y: number, z: number}) => {
    const type = (pos.y < 60) ? mcData.blocksByName.stone.id : mcData.blocksByName.air.id
    const b = new Block(type, 0, 0)
    b.position = pos
    return b
  }
}

function createFakePlayer (pos: Vec3) {
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
      effects: {} as Effect[]
    } as unknown as Entity,
    jumpTicks: 0,
    jumpQueued: false,
    version: '1.17.1',
    inventory: {
      slots: []
    }
  }
}

//init
initSetup(mcData);


//create fake bot
const playerType = mcData.entitiesByName["player"]
const fakePlayer = createFakePlayer(new Vec3(0, 80, 0))
fakePlayer.entity = applyMdToNewEntity(EPhysicsCtx, playerType, fakePlayer.entity)

// create physics context.
const physics = new EntityPhysics(mcData, playerType)

// create entity-specific physics context.
const playerState = EntityState.CREATE_FROM_ENTITY(physics, fakePlayer.entity)
const playerCtx = EPhysicsCtx.FROM_ENTITY_STATE(physics, playerState, playerType);


// set control state.
playerState.controlState = ControlStateHandler.DEFAULT() //.set("forward", true).set("right", true);

// simulate until on ground.
while (!fakePlayer.entity.onGround) {
  physics.simulatePlayer(playerCtx, fakeWorld).state.applyToBot(fakePlayer as any)
}

expect(fakePlayer.entity.position).toEqual(new Vec3(0, 60, 0))
console.log(fakePlayer.entity.position)
