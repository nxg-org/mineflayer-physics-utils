import { Effect } from "mineflayer";
import { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import md from "minecraft-data";
import block from "prismarine-block";

export default function load(version: string) {

    const mcData = md(version);
    const Block = (block as any)(version);


    const fakeWorld = {
        getBlock: (pos: { x: number; y: number; z: number }) => {
            const type = pos.y < 60 ? mcData.blocksByName.stone.id : mcData.blocksByName.air.id;
            const b = new Block(type, 0, 0);
            b.position = pos;
            return b;
        },
    };
    
    const createFakePlayer =  (pos: Vec3) => {
        return {
            entity: {
                type: "player",
                name: "player",
                position: pos,
                velocity: new Vec3(0, 0, 0),
                onGround: false,
                isInWater: false,
                isInLava: false,
                isInWeb: false,
                isCollidedHorizontally: false,
                isCollidedVertically: false,
                yaw: 0,
                effects: {} as Effect[],
            } as unknown as Entity,
            jumpTicks: 0,
            jumpQueued: false,
            version: "1.17.1",
            inventory: {
                slots: [],
            },
        };
    }

    return {mcData, Block, fakeWorld, createFakePlayer};
}
