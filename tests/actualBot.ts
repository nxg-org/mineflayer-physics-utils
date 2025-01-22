import { pathfinder, goals } from "mineflayer-pathfinder";
import { Bot, createBot } from "mineflayer";
import loader, { EntityPhysics, EntityState, EPhysicsCtx } from "../src/index";

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
  bot.chat("rocky1928");
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
    bot.chat("Hit the ground! " + bot.entity.position.toString());
  }
  wasOnGround = bot.entity.onGround;
});

// print whenever another player hits the ground
let lastPositions: Record<string, boolean> = {};
bot.on("entityMoved", (entity) => {
  console.log(entity.username)
  if (entity.username && entity.username !== bot.username) {
    // check by seeing is y value is an integer
    if (Math.floor(entity.position.y) === entity.position.y && !lastPositions[entity.username]) {
      bot.chat(`${entity.username} hit the ground! ${entity.position.toString()}`);
      lastPositions[entity.username] = true;
    } else if (Math.floor(entity.position.y) !== entity.position.y) {
      lastPositions[entity.username] = false;
    }}
});

bot.on("chat", (user, message) => {
  const [cmd, ...args] = message.split(" ");
  const author = bot.nearestEntity((e) => e.username === user);

  switch (cmd) {
    case "control":
      if (args.length !== 2) return bot.chat("Invalid control command!");
      if (args[0] === "clear") return bot.clearControlStates();
      bot.setControlState(args[0] as any, args[1] === "true");
      break;
    case "original":
      bot.physics = new Physics(bot.registry, bot.world);
      bot.chat("Switched to original physics!");
      break;
    case "new":
      const val = new EntityPhysics(bot.registry);
      const oldSim = (bot.physics as any).simulatePlayer;

      (EntityState.prototype as any).apply = function (this: EntityState, bot: Bot) {
        console.log(this.control);
        this.applyToBot(bot);
      };

      // EntityPhysics.prototype.simulate = function (ctx, world) {
      //   bot.physics.simulatePlayer(ctx.state, world);
      // }

      (bot.physics as any).autojumpCooldown = 0;
      // (bot.physics).jumpTicks = 0;

      (bot.physics as any).simulatePlayer = (...args: any[]) => {
        const ctx = EPhysicsCtx.FROM_BOT(val, bot);
        ctx.state.jumpTicks = 0; // allow immediate jumping
        return val.simulate(ctx, bot.world);
        return oldSim(...args);
      };
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
      bot.pathfinder.stop();
      bot.clearControlStates();
      bot.chat("Stopped!");
      break;
  }
});
