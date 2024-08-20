import { createBot } from "mineflayer";
import { Vec3 } from "vec3";
import loader, { EntityPhysics, EPhysicsCtx } from "../src/index";
import { SimulationTypes } from "../src/wrapper";
import { Entity } from "prismarine-entity";

const bot = createBot({
  username: "shot-testing",
  host: process.argv[2] ?? "localhost",
  port: Number(process.argv[3]) ?? 25565,
  version: process.argv[4],
});

bot.loadPlugin(loader);

const checkedEntities: Record<number, Vec3[]> = {};
const emptyVec = new Vec3(0, 0, 0);

// this code shows the trajectory of a projectile and whether it may hit people.

const lastPrintedEntities: Record<number, number> = {};
async function showSim(entity: Entity) {
  if (lastPrintedEntities[entity.id] - performance.now() < 3000) return;
  lastPrintedEntities[entity.id] = performance.now();
  checkedEntities[entity.id] = [];

  const physics = new EntityPhysics(bot.registry);
  const ectx = EPhysicsCtx.FROM_ENTITY(physics, entity);

  for (let i = 0; i < 300; i++) {
    let state = ectx.state;
    state = physics.simulate(ectx, bot.world);

    if (state.onGround) {
      console.log("Hit ground at", state.pos);
      checkedEntities[entity.id].push(state.pos.clone());
      break;
    }

    // bot.chat(`/particle flame ${x} ${y} ${z} 0 0 0 0 1 force`);
    checkedEntities[entity.id].push(state.pos.clone());
  }

  for (let i = 0; i < 5; i++) {
    let j = 0;
    for (const pos of checkedEntities[entity.id]) {
      j++;
      if (j === checkedEntities[entity.id].length) bot.chat(`/particle heart ${pos.x} ${pos.y} ${pos.z} 0 0 0 0 1 force`);
      bot.chat(`/particle flame ${pos.x} ${pos.y} ${pos.z} 0 0 0 0 1 force`);
    }

    await bot.waitForTicks(20);
  }

  delete checkedEntities[entity.id];
  delete lastPrintedEntities[entity.id];
}

bot.on("entityMoved", async (ent) => {
  const physics = new EntityPhysics(bot.registry);

  if (ent.velocity.equals(emptyVec)) return;



  if (ent.type === "projectile") {
    console.log(ent.velocity, ent.name);
    showSim(ent as Entity);
  }
 

  // console.log(ent)
});
