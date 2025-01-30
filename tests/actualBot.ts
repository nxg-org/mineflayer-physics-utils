import { pathfinder, goals } from "mineflayer-pathfinder";
import { Bot, createBot } from "mineflayer";
const physicsInject = require("mineflayer/lib/plugins/physics")
import loader, { BotcraftPhysics, EntityPhysics, EntityState, EPhysicsCtx } from "../src/index";
import { PlayerState } from "../src/physics/states";

const { Physics } = require("prismarine-physics");

const bot: Bot = createBot({
  host: process.argv[2],
  port: Number(process.argv[3]),
  username: "testingbot",
  version: process.argv[4],
});

bot.once("spawn", async () => {
  bot.loadPlugin(loader);
  bot.loadPlugin(pathfinder);
  await bot.waitForTicks(20);
  (bot as any).physics.yawSpeed = 50;
  (bot as any).physics.pitchSpeed = 50;
  // setupNewPhysics(bot);
});

const rl = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on("line", (line: any) => bot.chat(line));

// print whenever bot hits the ground

let wasOnGround = false;
let printNextPos = false;
bot.on("move", (pos) => {
  if (bot.entity.onGround && !wasOnGround) {
    // bot.chat("Hit the ground! " + bot.entity.position.toString());
  }
  wasOnGround = bot.entity.onGround;
});

// print whenever another player hits the ground
let lastPositions: Record<string, boolean> = {};
bot.on("entityMoved", (entity) => {
  if (entity.username && entity.username !== bot.username) {
    // check by seeing is y value is an integer
    if (Math.floor(entity.position.y) === entity.position.y && !lastPositions[entity.username]) {

      // check if in liquid
      const block = bot.blockAt(entity.position);
      if (block && (block.type === bot.registry.blocksByName.water.id || block.type === bot.registry.blocksByName.lava.id)) return;

      bot.chat(`${entity.username} hit the ground! ${entity.position.toString()}`);
      lastPositions[entity.username] = true;
    } else if (Math.floor(entity.position.y) !== entity.position.y) {
      lastPositions[entity.username] = false;
    }}
});

function setupNewPhysics(bot: Bot) {
  const val = new BotcraftPhysics(bot.registry);

      (EntityState.prototype as any).apply = function (this: EntityState, bot: Bot) {
        // console.log(this.control, this.isUsingItem);
        this.applyToBot(bot);
      };

      const ctx = EPhysicsCtx.FROM_BOT(val, bot);
      const state = ctx.state as PlayerState

      // EntityPhysics.prototype.simulate = function (ctx, world) {
      //   bot.physics.simulatePlayer(ctx.state, world);
      // }

      (bot.physics as any).autojumpCooldown = 0;
      // (bot.physics).jumpTicks = 0;

      (bot.physics as any).simulatePlayer = (...args: any[]) => {
        state.update(bot);
        ctx.state.jumpTicks = 0; // allow immediate jumping
        return val.simulate(ctx, bot.world);
      };
}

bot.on("chat", (user, message) => {
  const [cmd, ...args] = message.split(" ");
  const author = bot.nearestEntity((e) => e.username === user);

  switch (cmd) {
    case "lookatme":
      if (!author) return bot.chat("I can't see you!");
      bot.lookAt(author.position.offset(0, author.height, 0));
      break;
    case "status":
      const str = `onGround: ${bot.entity.onGround}, hCol:${(bot.entity as any).isCollidedHorizontally}, vCol:${(bot.entity as any).isCollidedVertically}, inWater:${(bot.entity as any).isInWater}, inLava:${(bot.entity as any).isInLava}`;
      bot.chat(str);
      break
    case "use":
      if (bot.usingHeldItem) bot.deactivateItem();
      else bot.activateItem();
      break;
    case "useoff":
      bot.deactivateItem()
      bot.activateItem(true)
      break
    case "control":
     
      if (args[0] === "clear") return bot.clearControlStates();
      if (args.length !== 2) return bot.chat("Invalid control command!");
      bot.setControlState(args[0] as any, args[1] === "true");
      break;
    case "original":
      bot.loadPlugin(physicsInject);
      bot.chat("Switched to original physics!");
      break;
    case "new":
      setupNewPhysics(bot);
      bot.chat("Switched to new physics!");
      break;
    case "jump":
      bot.setControlState("jump", true);
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
      bot.deactivateItem();
      bot.pathfinder.stop();
      bot.clearControlStates();
      bot.chat("Stopped!");
      break;
  }
});
