import { Entity } from "prismarine-entity";
import { Bot } from "mineflayer";
import { ControlStateHandler } from "../player/playerControls";
import { EntityState } from "../states/entityState";
import { PlayerState } from "../states/playerState";
import { Vec3 } from "vec3";
import { IPhysics } from "../engines/IPhysics";
import { EPhysicsCtx } from "../settings/entityPhysicsCtx";

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
];

export interface MovementSimOptions {
    sprintFirst: boolean;
    jumpFirst: boolean;
}

export class MovementSimulations {
    constructor(public bot: Bot, public readonly ctx: IPhysics) {}

    *predictGenerator(simCtx: EPhysicsCtx, world: any, ticks: number = 1, controls?: ControlStateHandler) {
        simCtx.state.controlState = controls ?? ControlStateHandler.DEFAULT();
        for (let current = 0; current < ticks; current++) {
            yield this.ctx.simulatePlayer(simCtx, world).state;
        }
        return simCtx;
    }

    predictForward(target: Entity, world: any, ticks: number = 1, controls?: ControlStateHandler) {
        const simCtx = EPhysicsCtx.FROM_ENTITY(this.ctx, target);
        simCtx.state.controlState = controls ?? ControlStateHandler.DEFAULT();
        for (let current = 0; current < ticks; current++) {
            this.ctx.simulatePlayer(simCtx, world);
        }
        return simCtx;
    }

    findCorrectMovements(lastState: EPhysicsCtx, world: any, wantedPos: Vec3) {
        // console.log("TEST\n===========================\ndelta pos:",wantedPos.minus(lastState.position), '\nstate\'s vel:', lastState.velocity, '\nstate\'s position:', lastState.position, '\nwanted position:', wantedPos)
        const defaultState = lastState.clone();
        const destinations: [Vec3, ControlStateHandler][] = [];
        for (const move of BasicMoves) {
            const testState = defaultState.clone();
            testState.state.controlState = move.clone();

            this.ctx.simulatePlayer(testState, world);
            destinations.push([testState.position, testState.state.controlState]);
        }

        const flag = !defaultState.state.isUsingItem;
        const flag2 = defaultState.state.onGround || defaultState.state.isInWater || defaultState.state.isInLava;
        const flag3 = flag && flag2;

        // Apply sprint tests.
        // Only apply if moving forward AND not sneaking AND state not using item.
        if (flag) {
            for (const move of BasicMoves.filter((ctrl) => ctrl.forward === true && ctrl.sneak === false && ctrl.back === false)) {
                const testState = defaultState.clone();
                testState.state.controlState = move.clone().set("sprint", true);
                this.ctx.simulatePlayer(testState, world);
                destinations.push([testState.position, testState.state.controlState]);
            }
        }

        // Apply jump, sneak, and jump-sneak tests.
        // Only test this if jump is relevant. Otherwise, ignore.
        if (flag2) {
            for (const move of BasicMoves) {
                const testState = defaultState.clone();
                testState.state.controlState = move.clone().set("jump", true);
                this.ctx.simulatePlayer(testState, world);
                destinations.push([testState.position, testState.state.controlState]);
            }
            for (const move of BasicMoves) {
                const testState1 = defaultState.clone();
                testState1.state.controlState = move.clone().set("sneak", true);
                this.ctx.simulatePlayer(testState1, world);
                destinations.push([testState1.position, testState1.state.controlState]);
            }
            for (const move of BasicMoves) {
                const testState2 = defaultState.clone();
                testState2.state.controlState = move.clone().set("jump", true).set("sneak", true);
                this.ctx.simulatePlayer(testState2, world);
                destinations.push([testState2.position, testState2.state.controlState]);
            }
        }

        // Apply sprint-jump tests.
        // Only apply if entity is on the ground, NOT shifting, and NOT holding backward.
        if (flag3) {
            for (const move of BasicMoves.filter((ctrl) => ctrl.forward === true && ctrl.sneak === false && ctrl.back === false)) {
                const testState = defaultState.clone();
                testState.state.controlState = move.clone().set("sprint", true).set("jump", true);
                this.ctx.simulatePlayer(testState, world);
                destinations.push([testState.position, testState.state.controlState]);
            }
        }
        const closestControls = destinations.sort((a, b) => a[0].distanceTo(wantedPos) - b[0].distanceTo(wantedPos));

        return closestControls[0][1];
    }
}
