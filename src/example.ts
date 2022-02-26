import { createBot } from "mineflayer";
import physics from "./index"
import { PlayerPoses } from "./physics/states/poses";

console.log(PlayerPoses[1])
const bot = createBot({
    username: "bruh",
    host: "localhost",
    version: "1.8.9"
})

bot.loadPlugin(physics)



