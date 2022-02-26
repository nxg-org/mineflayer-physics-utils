import { Entity } from "prismarine-entity";
import { Physics } from "../physics/engines/physics";
import { EntityState } from "../physics/states/entityState";

export class StateStorage {
    private _internal: {[tick: number]: EntityState};

    constructor() {
        this._internal = {}
    }

    public get length(): number {
        return Object.keys(this._internal).length
    }

    public get latestTick(): number{
        return Number(Object.keys(this._internal).sort((a, b) => Number(b) - Number(a))[0]);
    }

    public get oldestTick(): number {
        return Number(Object.keys(this._internal).sort((a, b) => Number(a) - Number(b))[0]);
    }


    public get(tick: number) {
        return this._internal[tick]
    }

    public getOldest() {
        return this._internal[this.oldestTick]
    }

    public getLatest() {
        return this._internal[this.latestTick]
    }

    public getPrevious() {
        
    }

    public push(tick: number, entity: Entity, ctx: Physics) {
        this._internal[tick] = EntityState.CREATE_FROM_ENTITY(ctx, entity);
        return this
    }


    public pushRaw(tick: number, entityState: EntityState) {
        this._internal[tick] = entityState
        return this
    }

    //I dislike this, but what can you do.
    public removeOldest() {
        delete this._internal[this.oldestTick]
        return this
    }

    //Same as above.
    public removeNewest() {
        delete this._internal[this.latestTick]
        return this
    }


}