import {pathfinder, goals} from 'mineflayer-pathfinder'
import { Bot, createBot } from 'mineflayer'
import loader, { EntityPhysics, EntityState, EPhysicsCtx } from '../src/index'


const {Physics} = require('prismarine-physics')

const bot: Bot = createBot({
    host: process.argv[2],
    port: Number(process.argv[3]),
    username: "testingbot"
})

bot.once('spawn', () => {
    bot.loadPlugin(loader)
    bot.loadPlugin(pathfinder)
})


bot.on("chat", (user, message) => {
    const [cmd, ...args] = message.split(' ')
    const author = bot.nearestEntity(e=>e.username===user);



    switch (cmd) {
        case "original":
            bot.physics = new Physics(bot.registry, bot.world);
            break;
        case "new":
            // rough patching in custom physics for the time being.
            const fuck0 =  new EntityPhysics(bot.registry)
            bot.physics = fuck0 as any;
            (bot.physics as any).simulatePlayer = (state: EntityState, world: any /* prismarine-world*/) =>  {
                const entity = EPhysicsCtx.FROM_ENTITY_STATE(fuck0, state)
                return fuck0.simulate(entity, world);
            }
            break;
        case "come":
            if (!author) return bot.chat(`Cannot see ${user}!`);
            const goal0 = new goals.GoalNear(author.position.x, author.position.y, author.position.z, 3);
            bot.pathfinder.setGoal(goal0);
            break;
        case "goto":
            if (!author) return bot.chat(`Cannot see ${user}!`);
            const goal1 = new goals.GoalNear(Number(args[0]), Number(args[1]), Number(args[2]), 3);
            bot.pathfinder.setGoal(goal1);
            break;
        case "stop":
            bot.pathfinder.stop();
            bot.chat('Stopped!')
            break;
        




    }


})