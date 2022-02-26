
import { Entity } from "prismarine-entity";
import { Bot } from "mineflayer";
import { Physics } from "../engines/physics";
import { ControlStateHandler } from "../player/playerControls";
import { EntityState } from "../states/entityState";
import { PlayerState } from "../states/playerState";
import { Vec3 } from "vec3";

const BasicMoves = [
    ControlStateHandler.DEFAULT(),
    ControlStateHandler.DEFAULT().set("forward", true),
    ControlStateHandler.DEFAULT().set("forward", true).set("right", true),
    ControlStateHandler.DEFAULT().set("forward", true).set("left", true),
    ControlStateHandler.DEFAULT().set("back", true),
    ControlStateHandler.DEFAULT().set("back", true).set("left", true),
    ControlStateHandler.DEFAULT().set("back", true).set("right", true),
    ControlStateHandler.DEFAULT().set("left", true),
    ControlStateHandler.DEFAULT().set("right", true),
]


export interface MovementSimOptions {
    sprintFirst: boolean;
    jumpFirst: boolean;
}

/**
 * To be used once per movement.
 *
 * Provide state that will serve as a base. The state itself will not be modified/consumed unless called for.
 */
export class MovementSimulations {
   
    constructor(public bot: Bot, public readonly ctx: Physics) {}

    *predictGenerator(state: EntityState, world: any, ticks: number = 1, controls?: ControlStateHandler) {
        state.controlState = controls ?? ControlStateHandler.DEFAULT();
        for (let current = 0; current < ticks; current++) {
            yield this.ctx.simulatePlayer(state, world) as EntityState
        }
        return state;
    }
  
    predictForward(target: Entity, world: any, ticks: number = 1, controls?: ControlStateHandler) {
        const state = EntityState.CREATE_FROM_ENTITY(this.ctx, target);
        state.controlState = controls ?? ControlStateHandler.DEFAULT();
        for (let current = 0; current < ticks; current++) {
            this.ctx.simulatePlayer(state, world)
        }
        return state;
    }



    findCorrectMovements(lastState: EntityState, world: any, wantedPos: Vec3) {
      
        // console.log("TEST\n===========================\ndelta pos:",wantedPos.minus(lastState.position), '\nstate\'s vel:', lastState.velocity, '\nstate\'s position:', lastState.position, '\nwanted position:', wantedPos)
        const defaultState = lastState.clone();
        const destinations: [Vec3, ControlStateHandler][] = [];
        for (const move of BasicMoves) {
            const testState = defaultState.clone();
            testState.controlState = move.clone();
            
            this.ctx.simulatePlayer(testState, world)
            destinations.push([testState.position, testState.controlState])
        }

        const flag = !defaultState.isUsingItem
        const flag2 = defaultState.onGround || defaultState.isInWater || defaultState.isInLava
        const flag3 = flag && flag2

      
        // Apply sprint tests.
        // Only apply if moving forward AND not sneaking AND state not using item.
        if (flag) {
            for (const move of BasicMoves.filter(ctrl => ctrl.forward === true && ctrl.sneak === false && ctrl.back === false)) {
                const testState = defaultState.clone();
                testState.controlState = move.clone().set("sprint", true);
                this.ctx.simulatePlayer(testState, world)
                destinations.push([testState.position, testState.controlState])
            }
        }
       

        // Apply jump, sneak, and jump-sneak tests.
        // Only test this if jump is relevant. Otherwise, ignore.
        if (flag2) { 
            for (const move of BasicMoves) {
                const testState = defaultState.clone();
                testState.controlState = move.clone().set("jump", true);
                this.ctx.simulatePlayer(testState, world)
                destinations.push([testState.position, testState.controlState])
            }
            for (const move of BasicMoves) {
                const testState1 = defaultState.clone();
                testState1.controlState = move.clone().set("sneak", true);
                this.ctx.simulatePlayer(testState1, world)
                destinations.push([testState1.position, testState1.controlState])
            }
            for (const move of BasicMoves) {
                const testState2 = defaultState.clone();
                testState2.controlState = move.clone().set("jump", true).set("sneak", true);
                this.ctx.simulatePlayer(testState2, world)
                destinations.push([testState2.position, testState2.controlState])
            }
        }

    


        // Apply sprint-jump tests.
        // Only apply if entity is on the ground, NOT shifting, and NOT holding backward.
        if (flag3) {
            for (const move of BasicMoves.filter(ctrl => ctrl.forward === true && ctrl.sneak === false && ctrl.back === false)) {
                const testState = defaultState.clone();
                testState.controlState = move.clone().set("sprint", true).set("jump", true);
                this.ctx.simulatePlayer(testState, world)
                destinations.push([testState.position, testState.controlState])
            }
        }
        const closestControls = destinations.sort((a, b) => a[0].distanceTo(wantedPos) - b[0].distanceTo(wantedPos))
    
        return closestControls[0][1];
    }
}
