import { ControlStateHandler } from "../physics/player";
import { EPhysicsCtx } from "../physics/settings";
import { EntityState, IEntityState } from "../physics/states";
import { IPhysics } from "../physics/engines";
import { Entity } from "prismarine-entity";
import { Vec3 } from "vec3";

export type SimulationGoal<State extends IEntityState = IEntityState> = (state: State, ticks: number) => boolean | ((state: State) => boolean);
export type OnGoalReachFunction<State extends IEntityState = IEntityState> = (state: State) => void;
export type Controller<State extends IEntityState = IEntityState> = (state: State, ticks: number) => void; // (...any: any[]) => void;

export class BaseSimulator<State extends IEntityState = IEntityState> {
    constructor(public readonly ctx: IPhysics) {}

    *predictGenerator(simCtx: EPhysicsCtx<State>, world: any, ticks: number = 1, controls?: ControlStateHandler) {
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

    predictForwardRaw(simCtx: EPhysicsCtx<State>, world: any, ticks: number = 1, controls?: ControlStateHandler) {
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
        simCtx: EPhysicsCtx<State>,
        world: any,
        ticks = 1
    ): State {
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

    static getReached<State extends IEntityState = IEntityState>(...path: Vec3[]): SimulationGoal<State> {
        return (state: State) => {
            const delta = path[0].minus(state.pos);
            return Math.abs(delta.x) <= 0.35 && Math.abs(delta.z) <= 0.35 && Math.abs(delta.y) < 1 && (state.onGround || state.isInWater);
        };
    }

    static getCleanupPosition<State extends IEntityState = IEntityState>(...path: Vec3[]): OnGoalReachFunction<State> {
        return (state: State) => {
            state.control.reset();
        };
    }

    static buildFullController<State extends IEntityState = IEntityState>(...controllers: Controller<State>[]): Controller<State> {
        return (state: State, ticks: number) => {
            controllers.forEach((control) => control(state, ticks));
        };
    }

    static buildAnyGoal<State extends IEntityState = IEntityState>(...goals: SimulationGoal<State>[]): SimulationGoal<State> {
        return (state, ticks) => goals.map((goal) => goal(state, ticks)).some(g => !!g);
    }

    static buildAllGoal<State extends IEntityState = IEntityState>(...goals: SimulationGoal<State>[]): SimulationGoal<State> {
        return (state, ticks) => goals.map((goal) => goal(state, ticks)).every(g => !!g);
    }
}
