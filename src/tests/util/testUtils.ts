import { Effect } from "mineflayer";
import { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";
import md from "minecraft-data";
import block from "prismarine-block";
import entity from "prismarine-entity"

export default function load(version: string) {

    const mcData = md(version);
    const Block = (block as any)(version);
    const Entity = (entity as any)(version)


    const fakeWorld = {
        getBlock: (pos: { x: number; y: number; z: number }) => {
            const type = pos.y < 60 ? mcData.blocksByName.stone.id : mcData.blocksByName.air.id;
            const b = new Block(type, 0, 0);
            b.position = pos;
            return b;
        },
    };

    const createFakeEntity = (name: string, pos: Vec3) => {
        if (!mcData.entitiesByName[name!]) throw "invalid name"
        const tmp = mcData.entitiesByName[name!]
        return {
                name: name,
                type: tmp.type,
                height:tmp.height,
                width: tmp.width,
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
                metadata: [],
                equipment: new Array(6)
            } as unknown as Entity
    }

    const modifyEntity = (name: string, entity: Entity) => {
        if (!mcData.entitiesByName[name!]) throw "invalid name"
        const tmp = mcData.entitiesByName[name!]
        entity.height = tmp.height ?? 0
        entity.width = tmp.width ?? 0
    }
    
    const createFakePlayer =  (pos: Vec3) => {
        return {
            entity: createFakeEntity("player", pos),
            jumpTicks: 0,
            jumpQueued: false,
            version: "1.17.1",
            inventory: {
                slots: [],
            },
            world: fakeWorld
        };
    }

    return {mcData, Block, Entity, fakeWorld, createFakePlayer, createFakeEntity, modifyEntity};
}
