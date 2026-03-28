import { Bot } from "mineflayer";
import {
  buildManagedBot,
  getBotOptionsFromArgs,
  type PhysicsBot,
  type PhysicsSwitcher,
  sleep,
} from "../helpers/manual/botSetup";

type EBounceBot = PhysicsBot & {
  elytraFly: (options?: { assistTakeoff?: boolean } | boolean) => Promise<void>;
  fireworkRocketDuration: number;
};

enum FlightState {
  IDLE = "IDLE",
  PRE_SYNC = "PRE_SYNC",
  EQUIPPING = "EQUIPPING",
  WARMUP = "WARMUP",
  LAUNCHING = "LAUNCHING",
  BOUNCING = "BOUNCING",
}

enum EquipResult {
  FAILED = "FAILED",
  ALREADY_EQUIPPED = "ALREADY_EQUIPPED",
  JUST_SWAPPED = "JUST_SWAPPED",
}

const SYNC_TIMEOUT_TICKS = 30;
const MAX_TELEPORT_DIST = 50.0;
const WARMUP_SPEED_THRESHOLD = 0.08;
const MIN_BOOST_SPEED = 30.0;
const MAX_SPEED = 100.0;
const TARGET_PITCH_DEG = 0;
const TAKEOFF_TIMEOUT_TICKS = 30;
const RETRY_DELAY_TICKS = 0;

let activeBot: Bot;

function getBotOptions() {
  return getBotOptionsFromArgs({
    defaultUsername: "testingbot",
    usernameIndex: 4,
    versionIndex: 5,
    authIndex: 6,
  });
}

function toRadians(degrees: number) {
  return degrees * Math.PI / 180;
}

function toDegrees(radians: number) {
  return radians * 180 / Math.PI;
}

function findInventoryItem(bot: Bot, itemName: string) {
  return bot.inventory.items().find((item) => item.name === itemName) ?? null;
}

function findEquippedItem(bot: Bot, destination: "hand" | "torso" | "off-hand", itemName: string) {
  const slot = (() => {
    switch (destination) {
      case "hand":
        return 0;
      case "off-hand":
        return 1;
      case "torso":
        return 4;
    }
  })();

  const item = bot.entity.equipment[slot];
  return item?.name === itemName ? item : null;
}

function findElytra(bot: Bot) {
  return findInventoryItem(bot, "elytra") ?? findEquippedItem(bot, "torso", "elytra");
}

function findFireworkRocket(bot: Bot) {
  return (
    findInventoryItem(bot, "firework_rocket") ??
    findEquippedItem(bot, "hand", "firework_rocket") ??
    findEquippedItem(bot, "off-hand", "firework_rocket")
  );
}

function isUsableElytra(item: ReturnType<typeof findElytra>) {
  if (!item || item.name !== "elytra") return false;
  if (typeof (item as any).durabilityUsed === "number" && typeof (item as any).maxDurability === "number") {
    return (item as any).durabilityUsed < (item as any).maxDurability - 1;
  }
  return true;
}

async function ensureBounceLoadout(bot: Bot) {
  const elytra = findElytra(bot);
  if (!isUsableElytra(elytra) || !elytra) {
    throw new Error("No usable elytra found in inventory.");
  }

  if (bot.entity.equipment[4]?.name !== "elytra") {
    await bot.equip(elytra, "torso");
  }

  const firework = findFireworkRocket(bot);
  if (firework && bot.heldItem?.name !== "firework_rocket") {
    await bot.equip(firework, "hand");
  }
}

class EBounceController {

  private currentState = FlightState.IDLE;
  private stateTicks = 0;
  private lastPos: Bot["entity"]["position"] | null = null;
  private lastLoggedEntityPos: Bot["entity"]["position"] | null = null;
  private lastLoggedClientPos: { x: number; y: number; z: number } | null = null;
  private lockPitch = true;
  private lockYaw = true;
  private targetYaw: number | null = null;
  private lockedYaw: number | null = null;
  private equipToken = 0;
  private pendingEquip: Promise<void> | null = null;
  private sequenceToken = 0;
  private takeoffInFlight = false;
  private glideRequested = false;
  private takeoffAttemptCount = 0;
  private retryDelayTicks = 0;
  private currentSpeed = 0;
  private lastRetryBlockReason: string | null = null;
  private bounceTicks = 0;
  private bounceGroundTicks = 0;
  private bounceGroundStartTick: number | null = null;
  private lastBounceOnGround: boolean | null = null;
  private lastJumpCommand = false;
  private jumpAttemptCount = 0;

  constructor(
    private readonly bot: EBounceBot,
    private readonly physicsSwitcher: PhysicsSwitcher,
  ) {}

  public beginBounce() {
    if (this.currentState !== FlightState.IDLE) return;

    this.lockedYaw = null;

    if (this.isElytraEquipped()) {
      this.log("Optimistic Start: usable elytra already equipped. Skipping equip.");
      this.transitionTo(FlightState.WARMUP);
      return;
    }

    this.log("Initiating pre-flight equip.");
    this.transitionTo(FlightState.PRE_SYNC);
  }

  public stopFlight() {
    if (this.currentState === FlightState.IDLE) return;

    this.sequenceToken++;
    this.transitionTo(FlightState.IDLE);
    this.cleanupPhysics();
    this.bot.clearControlStates();
  }

  public resetState() {
    this.log("Forcing state reset.");
    this.sequenceToken++;
    this.currentState = FlightState.IDLE;
    this.stateTicks = 0;
    this.cleanupPhysics();
    this.bot.clearControlStates();
    this.pendingEquip = null;
    this.equipToken++;
  }

  public setLockPitch(enabled: boolean) {
    this.lockPitch = enabled;
  }

  public setLockYaw(enabled: boolean) {
    this.lockYaw = enabled;
    if (!enabled) this.lockedYaw = null;
  }

  public setTargetYawDegrees(degrees: number | null) {
    this.targetYaw = degrees == null ? null : toRadians(degrees);
    if (degrees == null) this.log("Cleared target yaw.");
    else this.log(`Target yaw set to ${degrees.toFixed(1)} deg.`);
  }

  public clearTargetYaw() {
    this.setTargetYawDegrees(null);
  }

  public status() {
    const state = this.physicsSwitcher.getState();
    return [
      `state=${this.currentState}`,
      `ticks=${this.stateTicks}`,
      `pos=${this.bot.entity.position.toString()}`,
      `vel=${this.bot.entity.velocity.toString()}`,
      `entityOnGround=${this.bot.entity.onGround}`,
      `entityElytraFlying=${this.bot.entity.elytraFlying}`,
      `entityFallFlying=${this.getEntityFallFlying()}`,
      `confirmedFallFlying=${this.isConfirmedFallFlying()}`,
      `pendingFlight=${this.isPendingElytraFlight()}`,
      `pendingRequest=${this.isPendingElytraRequest()}`,
      `glideRequested=${this.glideRequested}`,
      `fireworkTicks=${this.bot.fireworkRocketDuration}`,
      `speed=${this.currentSpeed.toFixed(2)}`,
      `takeoffAttempts=${this.takeoffAttemptCount}`,
      `jumpAttempts=${this.jumpAttemptCount}`,
      `bounceTicks=${this.bounceTicks}`,
      `bounceOnGroundTicks=${this.bounceGroundTicks}`,
      `bounceOnGround=${this.lastBounceOnGround}`,
      state ? `clientOnGround=${state.onGround}` : null,
      state ? `clientFallFlying=${state.fallFlying}` : null,
      `sentOnGround=${this.getLastSentOnGround()}`,
      `controlJump=${this.bot.getControlState("jump")}`,
      `jumpTicks=${(this.bot as any).jumpTicks ?? 0}`,
      `targetYaw=${this.targetYaw == null ? "null" : toDegrees(this.targetYaw).toFixed(1)}`,
      `lockedYaw=${this.lockedYaw == null ? "null" : toDegrees(this.lockedYaw).toFixed(1)}`,
      `lockYaw=${this.lockYaw}`,
      `lockPitch=${this.lockPitch}`,
      state ? `pose=${state.pose}` : null,
    ]
      .filter((value): value is string => value != null)
      .join(" ");
  }

  public onPhysicsTick() {
    if (!this.physicsSwitcher.isEnabled()) {
      this.physicsSwitcher.enable();
    }

    this.stateTicks++;
    if (this.retryDelayTicks > 0) {
      this.retryDelayTicks--;
    }
    const speedBps = this.calculateSpeed();
    this.currentSpeed = speedBps;

    switch (this.currentState) {
      case FlightState.PRE_SYNC:
        this.handlePreSync();
        return;
      case FlightState.EQUIPPING:
        this.handleEquipping();
        return;
      case FlightState.WARMUP:
        this.handleWarmup();
        return;
      case FlightState.LAUNCHING:
        this.handleLaunching();
        return;
      case FlightState.BOUNCING:
        this.handleBouncing(speedBps);
        return;
      case FlightState.IDLE:
        return;
    }
  }

  public onDeathLikeEvent() {
    this.log("Resetting state after disconnect/death-like event.");
    this.resetState();
  }

  private transitionTo(newState: FlightState) {
    if (this.currentState === newState) return;
    const previousState = this.currentState;
    if (previousState === FlightState.BOUNCING && newState !== FlightState.BOUNCING) {
      this.logBounceGroundSummary();
    }

    this.log(`State: ${previousState} -> ${newState}`);
    this.currentState = newState;
    this.stateTicks = 0;

    if (newState === FlightState.BOUNCING) {
      this.lockedYaw = this.bot.entity.yaw;
      this.resetBounceGroundReport();
    }

    if (newState === FlightState.IDLE) {
      this.pendingEquip = null;
      this.takeoffInFlight = false;
      this.glideRequested = false;
    }
  }

  private handlePreSync() {
    this.resetInputs();

    if (this.stateTicks > SYNC_TIMEOUT_TICKS) {
      this.log("WARN: equip preparation timed out.");
      this.stopFlight();
      return;
    }

    if (this.pendingEquip) return;

    const myToken = ++this.equipToken;
    this.pendingEquip = (async () => {
      try {
        const result = await this.ensureElytraEquipped();
        if (myToken !== this.equipToken || this.currentState !== FlightState.PRE_SYNC) return;
        this.processEquipResult(result);
      } catch (error) {
        if (myToken !== this.equipToken || this.currentState !== FlightState.PRE_SYNC) return;
        this.log(`FAIL: ${String(error)}`);
        this.stopFlight();
      } finally {
        if (myToken === this.equipToken) {
          this.pendingEquip = null;
        }
      }
    })();
  }

  private handleEquipping() {
    this.resetInputs();

    if (this.stateTicks > SYNC_TIMEOUT_TICKS) {
      this.log("FAIL: equip confirmation timed out.");
      this.stopFlight();
      return;
    }

    if (this.isElytraEquipped()) {
      this.log("Equip confirmed. Moving to warmup.");
      this.transitionTo(FlightState.WARMUP);
    }
  }

  private handleWarmup() {
    const vel = this.bot.entity.velocity;
    const yaw = this.getLockedYaw();
    const pitch = this.getLockedPitch();
    const yawRad = yaw ?? 0;
    const lookX = -Math.sin(yawRad);
    const lookZ = Math.cos(yawRad);
    const speedInDirection = Math.abs((vel.x * lookX) + (vel.z * lookZ));
    if (speedInDirection > WARMUP_SPEED_THRESHOLD || !this.bot.entity.onGround) {
      this.log(`Warmup Complete (DirSpeed: ${speedInDirection.toFixed(2)}). Launching.`);
      this.transitionTo(FlightState.LAUNCHING);
    } else {
      this.submitInput(true, true, false, yaw, pitch);
    }
  }

  private handleLaunching() {
    if (this.stateTicks > TAKEOFF_TIMEOUT_TICKS) {
      this.log("FAIL: takeoff timed out.");
      this.stopFlight();
      return;
    }

    if (this.takeoffInFlight) return;

    const yaw = this.getLockedYaw() ?? this.bot.entity.yaw;
    const pitch = this.getLockedPitch() ?? this.bot.entity.pitch;
    void this.runTakeoffSequence(yaw, pitch);
  }

  private handleBouncing(speedBps: number) {
    const isOnGround = this.bot.entity.onGround;
    this.recordBounceGroundState(speedBps);

    if (isOnGround && speedBps < MAX_SPEED && speedBps > MIN_BOOST_SPEED) {
      this.bot.entity.velocity.y = 0;
    }

    if (isOnGround && this.hasActiveGlideRequest()) {
      this.log(`Clearing glide request on ground contact. retryDelay=${RETRY_DELAY_TICKS}`);
      this.glideRequested = false;
      this.retryDelayTicks = RETRY_DELAY_TICKS;
    }

    if (isOnGround && !this.hasActiveGlideRequest() && !this.takeoffInFlight && this.retryDelayTicks === 0) {
      this.lastRetryBlockReason = null;
      this.log("Retrying grounded glide request.");
      void this.requestGlide(true).catch(() => {
        this.log("WARN: grounded bounce glide request failed.");
      });
    } else if (!isOnGround && !this.hasActiveGlideRequest() && !this.takeoffInFlight && this.retryDelayTicks === 0) {
      this.lastRetryBlockReason = null;
      this.log("Retrying glide request.");
      void this.requestGlide(false).catch(() => {
        this.log("WARN: bounce glide request failed.");
      });
    } else {
      const blockParts = [
        isOnGround ? "onGround" : null,
        this.glideRequested ? "glideRequested=true" : null,
        this.isPendingElytraRequest() ? "pendingRequest=true" : null,
        this.isPendingElytraFlight() ? "pendingFlight=true" : null,
        this.isConfirmedFallFlying() ? "confirmedFallFlying=true" : null,
        this.getEntityFallFlying() && !this.isConfirmedFallFlying() ? "entityFallFlying=speculative" : null,
        this.takeoffInFlight ? "takeoffInFlight=true" : null,
        this.retryDelayTicks > 0 ? `retryDelay=${this.retryDelayTicks}` : null,
      ].filter((value): value is string => value != null);
      const blockReason = blockParts.length > 0 ? blockParts.join(", ") : null;

      if (blockReason && blockReason !== this.lastRetryBlockReason) {
        this.lastRetryBlockReason = blockReason;
        this.log(`Retry blocked: ${blockReason}`);
      }
    }

    this.submitInput(true, true, isOnGround, this.getLockedYaw(), this.getLockedPitch());
    this.logBounceCommand(speedBps, isOnGround, isOnGround);
  }

  private async ensureElytraEquipped(): Promise<EquipResult> {
    const equipped = findEquippedItem(this.bot, "torso", "elytra");
    if (isUsableElytra(equipped)) return EquipResult.ALREADY_EQUIPPED;

    const elytra = findInventoryItem(this.bot, "elytra");
    if (!isUsableElytra(elytra) || !elytra) return EquipResult.FAILED;

    await this.bot.equip(elytra, "torso");
    return EquipResult.JUST_SWAPPED;
  }

  private processEquipResult(result: EquipResult) {
    this.log(`Equipment Check Result: ${result}`);
    switch (result) {
      case EquipResult.ALREADY_EQUIPPED:
        this.transitionTo(FlightState.WARMUP);
        return;
      case EquipResult.JUST_SWAPPED:
        this.transitionTo(FlightState.EQUIPPING);
        return;
      case EquipResult.FAILED:
        this.log("FAIL: usable elytra not found.");
        this.stopFlight();
        return;
    }
  }

  private cleanupPhysics() {
    this.lastPos = null;
    this.lastLoggedEntityPos = null;
    this.lastLoggedClientPos = null;
    this.lockedYaw = null;
    this.targetYaw = null;
    this.currentSpeed = 0;
    this.takeoffInFlight = false;
    this.glideRequested = false;
    this.takeoffAttemptCount = 0;
    this.retryDelayTicks = 0;
    this.lastRetryBlockReason = null;
    this.lastJumpCommand = false;
    this.jumpAttemptCount = 0;
    this.resetBounceGroundReport();
  }

  private resetBounceGroundReport() {
    this.bounceTicks = 0;
    this.bounceGroundTicks = 0;
    this.bounceGroundStartTick = null;
    this.lastBounceOnGround = null;
  }

  private recordBounceGroundState(speedBps: number) {
    const clientState = this.physicsSwitcher.getState();
    const entityOnGround = this.bot.entity.onGround;
    const entityFallFlying = this.getEntityFallFlying();
    const confirmedFallFlying = this.isConfirmedFallFlying();
    const clientOnGround = clientState?.onGround ?? null;
    const clientFallFlying = clientState?.fallFlying ?? null;

    this.bounceTicks++;
    if (entityOnGround) {
      this.bounceGroundTicks++;
    }

    if (this.lastBounceOnGround == null) {
      this.lastBounceOnGround = entityOnGround;
      this.bounceGroundStartTick = entityOnGround ? this.bounceTicks : null;
    } else if (this.lastBounceOnGround !== entityOnGround) {
      this.lastBounceOnGround = entityOnGround;
      this.bounceGroundStartTick = entityOnGround ? this.bounceTicks : null;
    }

    this.log(
      `Bounce preInput tick=${this.bounceTicks} speed=${speedBps.toFixed(2)} ` +
      `entity.onGround=${entityOnGround} entity.fallFlying=${entityFallFlying} ` +
      `confirmed.fallFlying=${confirmedFallFlying} pendingRequest=${this.isPendingElytraRequest()} ` +
      `pendingFlight=${this.isPendingElytraFlight()} control.jump=${this.bot.getControlState("jump")} ` +
      `sentOnGround=${this.getLastSentOnGround()} jumpTicks=${(this.bot as any).jumpTicks ?? 0} ` +
      `entity.pos=${this.formatVec3(this.bot.entity.position)} entity.dPos=${this.formatDelta(this.lastLoggedEntityPos, this.bot.entity.position)} ` +
      `entity.vel=${this.formatVec3(this.bot.entity.velocity)} ` +
      `client.onGround=${clientOnGround == null ? "null" : clientOnGround} ` +
      `client.fallFlying=${clientFallFlying == null ? "null" : clientFallFlying} ` +
      `client.pos=${this.formatOptionalVec3(clientState?.pos)} client.dPos=${this.formatDelta(this.lastLoggedClientPos, clientState?.pos ?? null)} ` +
      `client.vel=${this.formatOptionalVec3(clientState?.vel)}`,
    );
  }

  private logBounceCommand(speedBps: number, tickStartedOnGround: boolean, jump: boolean) {
    const clientState = this.physicsSwitcher.getState();
    this.log(
      `Bounce command tick=${this.bounceTicks} speed=${speedBps.toFixed(2)} ` +
      `tickStartedOnGround=${tickStartedOnGround} desired.jump=${jump} ` +
      `control.jump=${this.bot.getControlState("jump")} sentOnGround=${this.getLastSentOnGround()} jumpTicks=${(this.bot as any).jumpTicks ?? 0} ` +
      `entity.onGround=${this.bot.entity.onGround} entity.fallFlying=${this.getEntityFallFlying()} ` +
      `confirmed.fallFlying=${this.isConfirmedFallFlying()} pendingRequest=${this.isPendingElytraRequest()} ` +
      `pendingFlight=${this.isPendingElytraFlight()} entity.pos=${this.formatVec3(this.bot.entity.position)} ` +
      `entity.vel=${this.formatVec3(this.bot.entity.velocity)} client.onGround=${clientState?.onGround ?? "null"} ` +
      `client.fallFlying=${clientState?.fallFlying ?? "null"} client.pos=${this.formatOptionalVec3(clientState?.pos)} ` +
      `client.vel=${this.formatOptionalVec3(clientState?.vel)}`,
    );

    this.lastLoggedEntityPos = this.bot.entity.position.clone();
    this.lastLoggedClientPos = clientState?.pos == null ? null : { ...clientState.pos };
  }

  private logBounceGroundSummary() {
    if (this.bounceTicks === 0) return;
    this.log(
      `Bounce ground report: onGroundTicks=${this.bounceGroundTicks}/${this.bounceTicks} finalOnGround=${this.lastBounceOnGround ?? false}`,
    );
  }

  private calculateSpeed() {
    const currentPos = this.bot.entity.position.clone();
    let speed = 0;

    if (this.lastPos) {
      const dx = currentPos.x - this.lastPos.x;
      const dz = currentPos.z - this.lastPos.z;
      const dist = Math.sqrt((dx * dx) + (dz * dz));
      if (dist > MAX_TELEPORT_DIST) {
        this.lastPos = currentPos;
        return 0;
      }
      speed = dist * 20;
    }

    this.lastPos = currentPos;
    return speed;
  }

  private resetInputs() {
    this.submitInput(false, false, false, null, null);
  }

  private submitMovementInput(forward: boolean, sprint: boolean, yaw: number | null, pitch: number | null) {
    this.bot.setControlState("forward", forward);
    this.bot.setControlState("back", false);
    this.bot.setControlState("left", false);
    this.bot.setControlState("right", false);
    this.bot.setControlState("sprint", sprint);
    this.bot.setControlState("sneak", false);

    if (yaw != null || pitch != null) {
      const nextYaw = yaw ?? this.bot.entity.yaw;
      const nextPitch = pitch ?? this.bot.entity.pitch;
      this.applyLook(nextYaw, nextPitch);
    }
  }

  private submitInput(forward: boolean, sprint: boolean, jump: boolean, yaw: number | null, pitch: number | null) {
    this.submitMovementInput(forward, sprint, yaw, pitch);
    this.bot.setControlState("jump", jump);
    this.recordJumpAttempt(jump);
  }

  private applyLook(yaw: number, pitch: number) {
    void this.bot.look(yaw, pitch);
  }

  private getLockedYaw() {
    if (this.targetYaw != null) return this.targetYaw;
    if (!this.lockYaw) return null;
    if (this.lockedYaw == null) {
      this.lockedYaw = this.bot.entity.yaw;
    }
    return this.lockedYaw;
  }

  private getLockedPitch() {
    return this.lockPitch ? toRadians(TARGET_PITCH_DEG) : null;
  }

  private getEntityFallFlying() {
    return (this.bot.entity as any).fallFlying ?? this.bot.entity.elytraFlying ?? false;
  }

  private isConfirmedFallFlying() {
    return this.getEntityFallFlying() && !this.isPendingElytraFlight();
  }

  private recordJumpAttempt(jump: boolean) {
    if (jump && !this.lastJumpCommand) {
      const clientState = this.physicsSwitcher.getState();
      this.jumpAttemptCount++;
      this.log(
        `Jump attempt=${this.jumpAttemptCount} state=${this.currentState} tick=${this.stateTicks} phase=commandEdge ` +
        `entity.onGround=${this.bot.entity.onGround} entity.fallFlying=${this.getEntityFallFlying()} ` +
        `confirmed.fallFlying=${this.isConfirmedFallFlying()} pendingRequest=${this.isPendingElytraRequest()} ` +
        `pendingFlight=${this.isPendingElytraFlight()} sentOnGround=${this.getLastSentOnGround()} jumpTicks=${(this.bot as any).jumpTicks ?? 0} ` +
        `entity.pos=${this.formatVec3(this.bot.entity.position)} entity.vel=${this.formatVec3(this.bot.entity.velocity)} ` +
        `client.onGround=${clientState?.onGround ?? "null"} client.fallFlying=${clientState?.fallFlying ?? "null"} ` +
        `client.pos=${this.formatOptionalVec3(clientState?.pos)} client.vel=${this.formatOptionalVec3(clientState?.vel)}`,
      );
    }
    this.lastJumpCommand = jump;
  }

  private formatVec3(vec: { x: number; y: number; z: number }) {
    return `${vec.x.toFixed(3)},${vec.y.toFixed(3)},${vec.z.toFixed(3)}`;
  }

  private formatOptionalVec3(vec: { x: number; y: number; z: number } | null | undefined) {
    if (vec == null) return "null";
    return this.formatVec3(vec);
  }

  private formatDelta(
    previous: { x: number; y: number; z: number } | null,
    current: { x: number; y: number; z: number } | null | undefined,
  ) {
    if (previous == null || current == null) return "null";
    return `${(current.x - previous.x).toFixed(3)},${(current.y - previous.y).toFixed(3)},${(current.z - previous.z).toFixed(3)}`;
  }

  private getLastSentOnGround() {
    return (this.bot as any)._lastSent?.onGround ?? "null";
  }

  private isPendingElytraFlight() {
    return (this.bot.entity as any)._pendingElytraFlightConfirmation ?? false;
  }

  private isPendingElytraRequest() {
    return (this.bot.entity as any)._pendingElytraFlyRequest ?? false;
  }

  private hasActiveGlideRequest() {
    return this.glideRequested || this.isPendingElytraRequest() || this.isPendingElytraFlight() || this.isConfirmedFallFlying();
  }

  private async runTakeoffSequence(yaw: number, pitch: number) {
    const myToken = this.sequenceToken;
    this.takeoffInFlight = true;

    try {
      await this.bot.look(yaw, pitch);
      await this.requestGlide(this.bot.entity.onGround);
      if (myToken !== this.sequenceToken || this.currentState !== FlightState.LAUNCHING) return;

      this.log("Takeoff sequence sent. Entering bounce state.");
      this.transitionTo(FlightState.BOUNCING);
    } catch (error) {
      if (myToken !== this.sequenceToken || this.currentState !== FlightState.LAUNCHING) return;
      this.log(`FAIL: ${String(error)}`);
      this.stopFlight();
    } finally {
      this.takeoffInFlight = false;
    }
  }

  private async requestGlide(assistTakeoff = true) {
    const myToken = this.sequenceToken;
    this.takeoffAttemptCount++;
    this.retryDelayTicks = RETRY_DELAY_TICKS;
    this.glideRequested = true;
    this.log(`Requesting glide. attempt=${this.takeoffAttemptCount} assistTakeoff=${assistTakeoff}`);

    try {
      await this.bot.elytraFly({ assistTakeoff });
      if (myToken !== this.sequenceToken) return;
      this.log("Glide request accepted.");
    } catch (error) {
      if (myToken !== this.sequenceToken) return;
      this.log(`Glide request failed: ${String(error)}`);
      throw error;
    } finally {
      this.glideRequested = false;
    }
  }

  private isElytraEquipped() {
    return isUsableElytra(findEquippedItem(this.bot, "torso", "elytra"));
  }

  private log(message: string) {
    console.log(`[ebounce] ${message}`);
  }
}

async function handleChatCommand(bot: EBounceBot, username: string, message: string, controller: EBounceController) {
  if (username === bot.username) return;

  const [command, ...args] = message.split(" ");

  switch (command) {
    case "prep":
      try {
        await ensureBounceLoadout(bot);
        bot.chat("Bounce loadout equipped.");
      } catch (error) {
        bot.chat(`Prep failed: ${String(error)}`);
      }
      return;
    case "bounce":
    case "start":
      if (args[0] != null) {
        const yaw = Number(args[0]);
        if (!Number.isNaN(yaw)) controller.setTargetYawDegrees(yaw);
      }
      controller.beginBounce();
      bot.chat("Bounce sequence started.");
      return;
    case "boost":
      bot.activateItem();
      return;
    case "stop":
      controller.stopFlight();
      bot.chat("Bounce sequence stopped.");
      return;
    case "status":
      bot.chat(controller.status());
      return;
    case "yaw":
      if (args[0] === "clear") {
        controller.clearTargetYaw();
        bot.chat("Target yaw cleared.");
        return;
      }

      if (args[0] != null) {
        const yaw = Number(args[0]);
        if (!Number.isNaN(yaw)) {
          controller.setTargetYawDegrees(yaw);
          bot.chat(`Target yaw set to ${yaw.toFixed(1)}.`);
        }
      }
      return;
    case "lockyaw":
      controller.setLockYaw(args[0] !== "false");
      bot.chat(`lockYaw=${args[0] !== "false"}`);
      return;
    case "lockpitch":
      controller.setLockPitch(args[0] !== "false");
      bot.chat(`lockPitch=${args[0] !== "false"}`);
      return;
    case "reset":
      controller.resetState();
      bot.quit();
      await sleep(3000);
      activeBot = buildBot();
      return;
    default:
      return;
  }
}

function registerLogging(bot: EBounceBot, controller: EBounceController) {
  bot.on("entityElytraFlew", (entity) => {
    if (entity.id !== bot.entity.id) return;
    console.log("[ebounce] entityElytraFlew", controller.status());
  });

  bot.on("usedFirework", () => {
    console.log("[ebounce] usedFirework", {
      fireworkRocketDuration: bot.fireworkRocketDuration,
    });
  });

  bot.on("end", () => {
    controller.onDeathLikeEvent();
  });
}

function buildBot() {
  let controller: EBounceController;

  return buildManagedBot<EBounceBot>(getBotOptions, {
    afterCreate: (bot, helpers) => {
      controller = new EBounceController(bot, helpers.physicsSwitcher);
      registerLogging(bot, controller);
      bot.on("physicsTickBegin", () => {
        controller.onPhysicsTick();
      });
    },
    onSpawn: async (bot, helpers) => {
      helpers.physicsSwitcher.enable();
      console.log("[ebounce] new engine enabled");
      console.log("[ebounce] chat commands: prep | bounce [yawDeg] | boost | stop | status | yaw <deg|clear> | lockyaw <true|false> | lockpitch <true|false> | reset");
      await ensureBounceLoadout(bot).catch(() => {});
    },
    onChat: async (bot, username, message) => {
      await handleChatCommand(bot, username, message, controller);
    },
  });
}

activeBot = buildBot();
