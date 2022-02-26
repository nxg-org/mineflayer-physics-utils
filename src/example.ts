import { createBot } from 'mineflayer'
import e, { Entity } from 'prismarine-entity'
import physics from './index'
import { PlayerPoses } from './physics/states/poses'

const bot = createBot({
  username: 'bruh',
  host: 'minecraft.next-gen.dev',
  version: '1.17.1'
})

bot.loadPlugin(physics)

console.log(new bot.physicsUtil.ePhysicsCtx.entityConstructor(1))
