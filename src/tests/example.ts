import { createBot, Effect } from "mineflayer";
import physics from "../index"

const bot = createBot({
    username: "bruh",
    host: "minecraft.next-gen.dev",
    version: "1.17.1"
})

bot.loadPlugin(physics)

// expect(player.entity.position).toEqual(new Vec3(0, 60, 0))