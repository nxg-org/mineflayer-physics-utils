import {pathfinder, goals} from 'mineflayer-pathfinder'
import { Bot, createBot } from 'mineflayer'
import loader, { EntityPhysics, EntityState, EPhysicsCtx } from '../src/index'


const {Physics} = require('prismarine-physics')

const bot: Bot = createBot({
    host: process.argv[2],
    port: Number(process.argv[3]),
    username: "testingbot"
})

bot.once('spawn', async () => {
    bot.loadPlugin(loader)
    bot.loadPlugin(pathfinder)
    await bot.waitForTicks(20)
    bot.chat('rocky1928')
})


const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout

})

rl.on('line', (line: any) => bot.chat(line))

bot.on("chat", (user, message) => {
    const [cmd, ...args] = message.split(' ')
    const author = bot.nearestEntity(e=>e.username===user);



    switch (cmd) {
        case "original":
            bot.physics = new Physics(bot.registry, bot.world);
            break;
        case "new":
            const val = new EntityPhysics(bot.registry)
            const oldSim = (bot.physics as any).simulatePlayer;

            (EntityState.prototype as any).apply = function (bot: Bot) {
                this.applyToBot(bot);
              };
            (bot.physics as any).simulatePlayer = (...args: any[]) => {
            //   bot.jumpTicks = 0
              const ctx = EPhysicsCtx.FROM_BOT(val, bot)
              ctx.state.jumpTicks = 0; // allow immediate jumping
              // ctx.state.control.set('sneak', true)
              return val.simulate(ctx, bot.world);
              return oldSim(...args);
            };
            break;
        case "jump":
            bot.setControlState('jump', true)
            break
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
            bot.clearControlStates();
            bot.chat('Stopped!')
            break;
        




    }


})