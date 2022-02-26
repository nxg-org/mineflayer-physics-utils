import { ControlStateHandler } from "../physics/player";
import { EPhysicsCtx } from "../physics/settings";
import { EntityState } from "../physics/states";
import { IPhysics } from "../physics/engines";
import { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";

type SimulationGoal = (state: EntityState) => boolean;
type OnGoalReachFunction = (state: EntityState) => void;
type Controller = (state: EntityState, ticks: number) => void; // (...any: any[]) => void;

export abstract class BaseSimulator {
    constructor(public readonly ctx: IPhysics) {}

    async *predictGenerator(simCtx: EPhysicsCtx, world: any, ticks: number = 1, controls?: ControlStateHandler) {
        simCtx.state.controlState = controls ?? simCtx.state.controlState;
        for (let current = 0; current < ticks; current++) {
            yield this.ctx.simulatePlayer(simCtx, world);
        }
        return simCtx;
    }

    async predictForward(target: Entity, world: any, ticks: number = 1, controls?: ControlStateHandler) {
        const simCtx = EPhysicsCtx.FROM_ENTITY(this.ctx, target);
        simCtx.state.controlState = controls ?? simCtx.state.controlState;
        for (let current = 0; current < ticks; current++) {
            await this.ctx.simulatePlayer(simCtx, world);
        }
        return simCtx.state;
    }

    async simulateUntil(
        goal: SimulationGoal,
        onGoalReach: OnGoalReachFunction,
        controller: Controller,
        simCtx: EPhysicsCtx,
        world: any,
        ticks = 1
    ): Promise<EntityState> {
        for (let i = 0; i < ticks; i++) {
            if (goal(simCtx.state)) {
                onGoalReach(simCtx.state);
                break;
            }
            if (simCtx.state.isInLava) break;

            controller(simCtx.state, ticks);
            await this.ctx.simulatePlayer(simCtx, world);
        }
        return simCtx.state;
    }

    static getReached(...path: Vec3[]): SimulationGoal {
        return (state: EntityState) => {
            const delta = path[0].minus(state.position);
            return Math.abs(delta.x) <= 0.35 && Math.abs(delta.z) <= 0.35 && Math.abs(delta.y) < 1 && (state.onGround || state.isInWater);
        };
    }

    static getCleanupPosition(...path: Vec3[]): OnGoalReachFunction {
        return (state: EntityState) => {
            state.clearControlStates();
        };
    }

    static buildFullController(...controllers: Controller[]): Controller {
        return (state: EntityState, ticks: number) => {
            controllers.forEach((control) => control(state, ticks));
        };
    }
}
