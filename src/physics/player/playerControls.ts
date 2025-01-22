import { MathUtils } from "@nxg-org/mineflayer-util-plugin";
import { Bot, ControlState, ControlStateStatus } from "mineflayer";
import { Vec3 } from "vec3";
import { EntityState, PlayerState } from "../states";
;

export class ControlStateHandler implements ControlStateStatus {
    constructor(
        public forward: boolean,
        public back: boolean,
        public left: boolean,
        public right: boolean,
        public jump: boolean,
        public sprint: boolean,
        public sneak: boolean
    ) {}

    public static DEFAULT(): ControlStateHandler {
        return new ControlStateHandler(false, false, false, false, false, false, false);
    }

    public static COPY_BOT(bot: Bot) {
        return new ControlStateHandler(
            bot.getControlState("forward"),
            bot.getControlState("back"),
            bot.getControlState("left"),
            bot.getControlState("right"),
            bot.getControlState("jump"),
            bot.getControlState("sprint"),
            bot.getControlState("sneak")
        );
    }

    public static COPY_STATE(state: EntityState | PlayerState) {
        return new ControlStateHandler(
            state.control.forward,
            state.control.back,
            state.control.left,
            state.control.right,
            state.control.jump,
            state.control.sprint,
            state.control.sneak
        );
    }

    public set(state: ControlState, wanted: boolean) {
        this[state] = wanted;
        return this;
    }

    public get(state: ControlState): boolean {
        return this[state];
    }

    public clear(state: ControlState) {
        this[state] = false;
        return this;
    }

    public reset() {
        this.forward = false;
        this.back = false;
        this.left = false;
        this.right = false;
        this.jump = false;
        this.sprint = false;
        this.sneak = false;
        return this;
    }

    public clone(): ControlStateHandler {
        return new ControlStateHandler(this.forward, this.back, this.left, this.right, this.jump, this.sprint, this.sneak);
    }

    public equals(other: ControlStateHandler) {
        return this.forward == other.forward &&
            this.back == other.back &&
            this.left == other.left &&
            this.right == other.right &&
            this.jump == other.jump &&
            this.sprint == other.sprint &&
            this.sneak == other.sneak;
    }

    public applyControls(bot: Bot): void {
        for (const move of this) {
            bot.setControlState(move[0], move[1]);
        }
    }

    *[Symbol.iterator](): Generator<[state: ControlState, wanted: boolean], void, unknown> {
        yield ["forward", this.forward];
        yield ["back", this.back];
        yield ["left", this.left];
        yield ["right", this.right];
        yield ["jump", this.jump];
        yield ["sprint", this.sprint];
        yield ["sneak", this.sneak];
    }
}
export class PlayerControls extends ControlStateHandler {
    constructor(
        forward: boolean,
        back: boolean,
        left: boolean,
        right: boolean,
        jump: boolean,
        sprint: boolean,
        sneak: boolean,
        public leftClick: boolean,
        public rightClick: boolean,
        public yaw: number,
        public pitch: number,
        public force: boolean = false
    ) {
        super(forward, back, left, right, jump, sprint, sneak);
        this.leftClick = leftClick;
        this.rightClick = rightClick;
    }

    public static DEFAULT(): PlayerControls {
        return new PlayerControls(false, false, false, false, false, false, false, false, false, NaN, NaN);
    }

    public static LOOK(yaw: number, pitch: number, force: boolean) {
        return new PlayerControls(false, false, false, false, false, false, false, false, false, yaw, pitch, force);
    }

    public static LOOKAT(pos: Vec3, force: boolean) {
        const info = MathUtils.dirToYawAndPitch(pos);
        return new PlayerControls(false, false, false, false, false, false, false, false, false, info.yaw, info.pitch, force);
    }

    public static COPY_BOT(bot: Bot) {
        return new PlayerControls(
            bot.controlState.forward,
            bot.controlState.back,
            bot.controlState.left,
            bot.controlState.right,
            bot.controlState.jump,
            bot.controlState.sprint,
            bot.controlState.sneak,
            bot.util.entity.isMainHandActive(),
            bot.util.entity.isOffHandActive(),
            bot.entity.yaw,
            bot.entity.pitch,
            false
        );
    }

    public static COPY_STATE(state: EntityState | PlayerState) {
        return new PlayerControls(
            state.control.forward,
            state.control.back,
            state.control.left,
            state.control.right,
            state.control.jump,
            state.control.sprint,
            state.control.sneak,
            state.isUsingMainHand,
            state.isUsingOffHand,
            state.yaw,
            state.pitch,
            false
        );
    }

    public clone(): PlayerControls {
        return new PlayerControls(
            this.forward,
            this.back,
            this.left,
            this.right,
            this.jump,
            this.sprint,
            this.sneak,
            this.leftClick,
            this.rightClick,
            this.yaw,
            this.pitch,
            this.force
        );
    }

    public setRot(dir: Vec3) {
        const tmp = MathUtils.dirToYawAndPitch(dir);
        this.yaw = tmp.yaw;
        this.pitch = tmp.pitch;
    }

    public setRotRaw(yaw: number, pitch: number) {
        this.yaw = yaw;
        this.pitch = pitch;
    }

    public *movements() {
        yield this.forward;
        yield this.back;
        yield this.left;
        yield this.right;
        yield this.jump;
        yield this.sprint;
        yield this.sneak;
    }

    public *linkedMovements(): Generator<[state: ControlState, wanted: boolean], void, unknown> {
        yield ["forward", this.forward];
        yield ["back", this.back];
        yield ["left", this.left];
        yield ["right", this.right];
        yield ["jump", this.jump];
        yield ["sprint", this.sprint];
        yield ["sneak", this.sneak];
    }
}