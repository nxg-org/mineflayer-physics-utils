import { ControlStateHandler } from "../physics/player";
import { EPhysicsCtx } from "../physics/settings";
import { EntityState, IEntityState } from "../physics/states";
import { IPhysics } from "../physics/engines";
import { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";

export type SimulationGoal = (state: IEntityState, ticks: number) => boolean | ((state: IEntityState) => boolean);
export type OnGoalReachFunction = (state: IEntityState) => void;
export type Controller = (state: IEntityState, ticks: number) => void; // (...any: any[]) => void;

export class BaseSimulator {
    constructor(public readonly ctx: IPhysics) {}

    *predictGenerator(simCtx: EPhysicsCtx, world: any, ticks: number = 1, controls?: ControlStateHandler) {
        simCtx.state.control = controls ?? simCtx.state.control;
        for (let current = 0; current < ticks; current++) {
            yield this.ctx.simulate(simCtx, world);
        }
        return simCtx;
    }

    predictForward(target: Entity, world: any, ticks: number = 1, controls?: ControlStateHandler) {
        const simCtx = EPhysicsCtx.FROM_ENTITY(this.ctx, target);
        simCtx.state.control = controls ?? simCtx.state.control;
        for (let current = 0; current < ticks; current++) {
            this.ctx.simulate(simCtx, world);
        }
        return simCtx.state;
    }

    predictForwardRaw(simCtx: EPhysicsCtx, world: any, ticks: number = 1, controls?: ControlStateHandler) {
        simCtx.state.control = controls ?? simCtx.state.control;
        for (let current = 0; current < ticks; current++) {
            this.ctx.simulate(simCtx, world);
        }
        return simCtx.state;
    }

    simulateUntil(
        goal: SimulationGoal,
        onGoalReach: OnGoalReachFunction,
        controller: Controller,
        simCtx: EPhysicsCtx,
        world: any,
        ticks = 1
    ): IEntityState {
        for (let i = 0; i < ticks; i++) {
            if (goal(simCtx.state, i)) {
                onGoalReach(simCtx.state);
                break;
            }
            controller(simCtx.state, i);
            this.ctx.simulate(simCtx, world);
            simCtx.state.age++;
        }
        return simCtx.state;
    }

    static getReached(...path: Vec3[]): SimulationGoal {
        return (state: IEntityState) => {
            const delta = path[0].minus(state.pos);
            return Math.abs(delta.x) <= 0.35 && Math.abs(delta.z) <= 0.35 && Math.abs(delta.y) < 1 && (state.onGround || state.isInWater);
        };
    }

    static getCleanupPosition(...path: Vec3[]): OnGoalReachFunction {
        return (state: IEntityState) => {
            state.control.reset();
        };
    }

    static buildFullController(...controllers: Controller[]): Controller {
        return (state: IEntityState, ticks: number) => {
            controllers.forEach((control) => control(state, ticks));
        };
    }

    static buildAnyGoal(...goals: SimulationGoal[]): SimulationGoal {
        return (state, ticks) => goals.map((goal) => goal(state, ticks)).some(g => !!g);
    }

    static buildAllGoal(...goals: SimulationGoal[]): SimulationGoal {
        return (state, ticks) => goals.map((goal) => goal(state, ticks)).every(g => !!g);
    }
}
