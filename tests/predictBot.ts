import { createBot } from "mineflayer";
import { InterceptFunctions } from "@nxg-org/mineflayer-util-plugin";
import { Vec3 } from "vec3";
import loader, { EntityPhysics, EntityState, EPhysicsCtx } from '../src/index'


const bot = createBot({
  username: "shot-testing",
  host: process.argv[2] ?? "localhost",
  port: Number(process.argv[3]) ?? 25565,
  version: process.argv[4],
});

bot.loadPlugin(loader); 


const checkedEntities: Record<number, Vec3[]> = {}
const emptyVec = new Vec3(0, 0, 0);


// this code shows the trajectory of a projectile and whether it may hit people.




bot.on("entityMoved", async (ent) => {
const physics = new EntityPhysics(bot.registry);


  if (checkedEntities[ent.id]) return;
  if (ent.velocity.equals(emptyVec)) return;

  checkedEntities[ent.id] = [];

  console.log(ent.velocity, ent.name)
  if (["arrow", "firework_rocket", "ender_pearl", "egg", "experience_bottle", "fishing_bobber", "trident", "potion"].includes(ent.name!)) {
    const ectx = EPhysicsCtx.FROM_ENTITY(physics, ent);
    for (let i = 0; i < 300; i++) {
        let state = ectx.state;
        state = physics.simulate(ectx, bot.world);
        const {x,y, z} = state.pos;
        const {x: vx, y: vy, z: vz} = state.vel;

        if (state.onGround) {
            console.log("Hit ground at", state.pos);
            checkedEntities[ent.id].push(state.pos.clone());
            break;
        }
  
        // bot.chat(`/particle flame ${x} ${y} ${z} 0 0 0 0 1 force`);
        checkedEntities[ent.id].push(state.pos.clone());
    }

    for (let i = 0; i < 3; i++) {
        let j = 0;
        for (const pos of checkedEntities[ent.id]) {
            j++;
            if (j === checkedEntities[ent.id].length) bot.chat(`/particle heart ${pos.x} ${pos.y} ${pos.z} 0 0 0 0 1 force`);
            bot.chat(`/particle flame ${pos.x} ${pos.y} ${pos.z} 0 0 0 0 1 force`);
        }

        await bot.waitForTicks(20);
    }

    
 
  }

  // console.log(ent)


});
