import { Bot } from "mineflayer";
import {
  buildManagedBot,
  getBotOptionsFromArgs,
  type PhysicsBot,
  type PhysicsSwitcher,
  sleep,
} from "../helpers/manual/botSetup";

type EBounceBot = PhysicsBot & {
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
const TARGET_PITCH_DEG = -72.4;
const TAKEOFF_TIMEOUT_TICKS = 30;

let activeBot: Bot;

function getBotOptions() {
  return getBotOptionsFromArgs({
    defaultUsername: "testingbot",
    versionIndex: 4,
    usernameIndex: 5,
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

type BounceVector = { x: number; y: number; z: number };

type BounceInput = {
  forward: boolean;
  sprint: boolean;
  jump: boolean;
  yaw: number | null;
  pitch: number | null;
};

type BounceSnapshot = {
  position: BounceVector;
  velocity: BounceVector;
  yaw: number;
  pitch: number;
  onGround: boolean;
  sprinting: boolean;
  rawFallFlying: boolean;
  pendingFlight: boolean;
  pendingRequest: boolean;
  controlJump: boolean;
  jumpTicks: number;
  lastSentOnGround: boolean | "null";
  fireworkTicks: number;
  clientOnGround: boolean | null;
  clientFallFlying: boolean | null;
  clientSprinting: boolean | null;
  pose: string | null;
};

type EBounceOptions = {
  syncTimeoutTicks: number;
  maxTeleportDistance: number;
  warmupSpeedThreshold: number;
  minBoostSpeed: number;
  maxBoostSpeed: number;
  takeoffTimeoutTicks: number;
  targetPitchDeg: number;
};

const DEFAULT_EBOUNCE_OPTIONS: EBounceOptions = {
  syncTimeoutTicks: SYNC_TIMEOUT_TICKS,
  maxTeleportDistance: MAX_TELEPORT_DIST,
  warmupSpeedThreshold: WARMUP_SPEED_THRESHOLD,
  minBoostSpeed: MIN_BOOST_SPEED,
  maxBoostSpeed: MAX_SPEED,
  takeoffTimeoutTicks: TAKEOFF_TIMEOUT_TICKS,
  targetPitchDeg: TARGET_PITCH_DEG,
};

interface EBouncePort {
  getSnapshot(): BounceSnapshot;
  isElytraEquipped(): boolean;
  ensureElytraEquipped(): Promise<EquipResult>;
  setInput(input: BounceInput): void;
  clearInputs(): void;
  setVerticalVelocity(y: number): void;
  sendStartFlyingPacket(): void;
  setClientSideFallFlying(enabled: boolean): void;
  setClientSideSprinting(enabled: boolean): void;
  activateItem(): void;
  log(message: string): void;
}

class MineflayerEBouncePort implements EBouncePort {
  constructor(
    private readonly bot: EBounceBot,
    private readonly physicsSwitcher: PhysicsSwitcher,
  ) {}

  public getSnapshot(): BounceSnapshot {
    const clientState = this.physicsSwitcher.getState();
    const rawFallFlying = (this.bot.entity as any).fallFlying ?? this.bot.entity.elytraFlying ?? false;
    const pendingFlight = (this.bot.entity as any)._pendingElytraFlightConfirmation ?? false;
    return {
      position: this.bot.entity.position,
      velocity: this.bot.entity.velocity,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      onGround: this.bot.entity.onGround,
      sprinting: (this.bot.entity as any).sprinting ?? false,
      rawFallFlying,
      pendingFlight,
      pendingRequest: (this.bot.entity as any)._pendingElytraFlyRequest ?? false,
      controlJump: this.bot.getControlState("jump"),
      jumpTicks: (this.bot as any).jumpTicks ?? 0,
      lastSentOnGround: (this.bot as any)._lastSent?.onGround ?? "null",
      fireworkTicks: this.bot.fireworkRocketDuration,
      clientOnGround: clientState?.onGround ?? null,
      clientFallFlying: clientState?.fallFlying ?? null,
      clientSprinting: clientState?.sprinting ?? null,
      pose: clientState?.pose != null ? String(clientState.pose) : null,
    };
  }

  public isElytraEquipped() {
    return isUsableElytra(findEquippedItem(this.bot, "torso", "elytra"));
  }

  public async ensureElytraEquipped(): Promise<EquipResult> {
    const equipped = findEquippedItem(this.bot, "torso", "elytra");
    if (isUsableElytra(equipped)) return EquipResult.ALREADY_EQUIPPED;

    const elytra = findInventoryItem(this.bot, "elytra");
    if (!isUsableElytra(elytra) || !elytra) return EquipResult.FAILED;

    await this.bot.equip(elytra, "torso");
    return EquipResult.JUST_SWAPPED;
  }

  public setInput(input: BounceInput) {
    this.bot.setControlState("forward", input.forward);
    this.bot.setControlState("back", false);
    this.bot.setControlState("left", false);
    this.bot.setControlState("right", false);
    this.bot.setControlState("sprint", input.sprint);
    this.bot.setControlState("sneak", false);
    this.bot.setControlState("jump", input.jump);

    if (input.yaw != null || input.pitch != null) {
      const nextYaw = input.yaw ?? this.bot.entity.yaw;
      const nextPitch = input.pitch ?? this.bot.entity.pitch;
      void this.bot.look(nextYaw, nextPitch);
    }
  }

  public clearInputs() {
    this.bot.clearControlStates();
  }

  public setVerticalVelocity(y: number) {
    this.bot.entity.velocity.y = y;
  }

  public sendStartFlyingPacket() {
    (this.bot as any)._client.write("entity_action", {
      entityId: this.bot.entity.id,
      actionId: this.bot.supportFeature("entityActionUsesStringMapper") ? "start_elytra_flying" : 8,
      jumpBoost: 0,
    });
  }

  public setClientSideFallFlying(enabled: boolean) {
    this.applyClientSideFallFlying(enabled);
  }

  public setClientSideSprinting(enabled: boolean) {
    this.applyClientSideSprinting(enabled);
  }

  public activateItem() {
    this.bot.activateItem();
  }

  public log(message: string) {
    console.log(`[ebounce] ${message}`);
  }

  private applyClientSideFallFlying(enabled: boolean) {
    const applyState = (state: any) => {
      if (state == null) return;
      if ("fallFlying" in state) state.fallFlying = enabled;
      if ("elytraFlying" in state) state.elytraFlying = enabled;
    };

    if (this.bot.entity) {
  (this.bot.entity as any).fallFlying = enabled;
    this.bot.entity.elytraFlying = enabled;
    (this.bot.entity as any)._pendingElytraFlightConfirmation = false;

    }
  
    applyState((this.bot as any).physicsEngineCtx?.state);
    applyState(this.physicsSwitcher.getState());
  }

  private applyClientSideSprinting(enabled: boolean) {
    const applyState = (state: any) => {
      if (state == null) return;
      if ("sprinting" in state) state.sprinting = enabled;
    };

    (this.bot.entity as any).sprinting = enabled;
    applyState((this.bot as any).physicsEngineCtx?.state);
    applyState(this.physicsSwitcher.getState());
  }
}

class EBounceController {
  private currentState = FlightState.IDLE;
  private stateTicks = 0;
  private lastPos: BounceVector | null = null;
  private lockPitch = true;
  private lockYaw = true;
  private targetYaw: number | null = null;
  private targetPitch: number | null = null;
  private lockedYaw: number | null = null;
  private equipToken = 0;
  private pendingEquip: Promise<void> | null = null;
  private startFlyingPacketCount = 0;
  private currentSpeed = 0;
  private bounceTicks = 0;
  private bounceGroundTicks = 0;
  private bounceFallFlyingTicks = 0;
  private bounceSprintingTicks = 0;
  private lastBounceOnGround = false;
  private lastJumpCommand = false;
  private jumpAttemptCount = 0;
  private lastObservedOnGround: boolean | null = null;
  private lastObservedFallFlying: boolean | null = null;
  private lastObservedClientFallFlying: boolean | null = null;
  private readonly options: EBounceOptions;

  constructor(
    private readonly port: EBouncePort,
    options: Partial<EBounceOptions> = {},
  ) {
    this.options = { ...DEFAULT_EBOUNCE_OPTIONS, ...options };
  }

  public beginBounce() {
    if (this.currentState !== FlightState.IDLE) return;

    this.lockedYaw = null;

    if (this.port.isElytraEquipped()) {
      this.port.log("Optimistic Start: usable elytra already equipped. Skipping equip.");
      this.transitionTo(FlightState.WARMUP);
      return;
    }

    this.port.log("Initiating pre-flight equip.");
    this.transitionTo(FlightState.PRE_SYNC);
  }

  public stopFlight() {
    if (this.currentState === FlightState.IDLE) return;

    this.transitionTo(FlightState.IDLE);
    this.cleanup();
    this.port.clearInputs();
  }

  public resetState() {
    this.port.log("Forcing state reset.");
    this.currentState = FlightState.IDLE;
    this.stateTicks = 0;
    this.pendingEquip = null;
    this.equipToken++;
    this.cleanup();
    this.port.clearInputs();
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
    if (degrees == null) this.port.log("Cleared target yaw.");
    else this.port.log(`Target yaw set to ${degrees.toFixed(1)} deg.`);
  }

  public clearTargetYaw() {
    this.setTargetYawDegrees(null);
  }

  public setTargetPitchDegrees(degrees: number | null) {
    this.targetPitch = degrees == null ? null : toRadians(degrees);
    if (degrees == null) this.port.log("Cleared target pitch.");
    else this.port.log(`Target pitch set to ${degrees.toFixed(1)} deg.`);
  }

  public clearTargetPitch() {
    this.setTargetPitchDegrees(null);
  }

  public status() {
    const snapshot = this.port.getSnapshot();
    return [
      `state=${this.currentState}`,
      `ticks=${this.stateTicks}`,
      `pos=${this.formatVec3(snapshot.position)}`,
      `vel=${this.formatVec3(snapshot.velocity)}`,
      `speed=${this.currentSpeed.toFixed(2)}`,
      `onGround=${snapshot.onGround}`,
      `sprinting=${snapshot.sprinting}`,
      `sentOnGround=${snapshot.lastSentOnGround}`,
      `fallFlying=${snapshot.rawFallFlying}`,
      `confirmedFallFlying=${this.isConfirmedFallFlying(snapshot)}`,
      `pendingFlight=${snapshot.pendingFlight}`,
      `pendingRequest=${snapshot.pendingRequest}`,
      `controlJump=${snapshot.controlJump}`,
      `jumpTicks=${snapshot.jumpTicks}`,
      `fireworkTicks=${snapshot.fireworkTicks}`,
      `startFlyingPackets=${this.startFlyingPacketCount}`,
      `jumpAttempts=${this.jumpAttemptCount}`,
      `bounceTicks=${this.bounceTicks}`,
      `bounceOnGroundTicks=${this.bounceGroundTicks}`,
      `bounceFallFlyingTicks=${this.bounceFallFlyingTicks}`,
      `bounceSprintingTicks=${this.bounceSprintingTicks}`,
      snapshot.clientOnGround == null ? null : `clientOnGround=${snapshot.clientOnGround}`,
      snapshot.clientFallFlying == null ? null : `clientFallFlying=${snapshot.clientFallFlying}`,
      snapshot.clientSprinting == null ? null : `clientSprinting=${snapshot.clientSprinting}`,
      snapshot.pose == null ? null : `pose=${snapshot.pose}`,
      `targetYaw=${this.targetYaw == null ? "null" : toDegrees(this.targetYaw).toFixed(1)}`,
      `targetPitch=${this.targetPitch == null ? "null" : toDegrees(this.targetPitch).toFixed(1)}`,
      `lockedYaw=${this.lockedYaw == null ? "null" : toDegrees(this.lockedYaw).toFixed(1)}`,
      `lockYaw=${this.lockYaw}`,
      `lockPitch=${this.lockPitch}`,
    ]
      .filter((value): value is string => value != null)
      .join(" ");
  }

  public tick() {
    this.stateTicks++;
    const snapshot = this.port.getSnapshot();
    this.currentSpeed = this.calculateSpeed(snapshot.position);
    this.logStateEdges(snapshot);

    switch (this.currentState) {
      case FlightState.PRE_SYNC:
        this.handlePreSync();
        return;
      case FlightState.EQUIPPING:
        this.handleEquipping();
        return;
      case FlightState.WARMUP:
        this.handleWarmup(snapshot);
        return;
      case FlightState.LAUNCHING:
        this.handleLaunching(snapshot);
        return;
      case FlightState.BOUNCING:
        this.handleBouncing(snapshot, this.currentSpeed);
        return;
      case FlightState.IDLE:
        return;
    }
  }

  public onDeathLikeEvent() {
    this.port.log("Resetting state after disconnect/death-like event.");
    this.resetState();
  }

  private transitionTo(newState: FlightState) {
    if (this.currentState === newState) return;

    if (this.currentState === FlightState.BOUNCING && newState !== FlightState.BOUNCING && this.bounceTicks > 0) {
      this.port.log(
        `Bounce summary: onGroundTicks=${this.bounceGroundTicks}/${this.bounceTicks} ` +
        `fallFlyingTicks=${this.bounceFallFlyingTicks}/${this.bounceTicks} ` +
        `sprintingTicks=${this.bounceSprintingTicks}/${this.bounceTicks}`,
      );
    }

    this.port.log(`State: ${this.currentState} -> ${newState}`);
    this.currentState = newState;
    this.stateTicks = 0;

    if (newState === FlightState.BOUNCING) {
      this.lockedYaw = this.port.getSnapshot().yaw;
      this.bounceTicks = 0;
      this.bounceGroundTicks = 0;
      this.bounceFallFlyingTicks = 0;
      this.bounceSprintingTicks = 0;
      this.lastBounceOnGround = false;
    }

    if (newState === FlightState.IDLE) {
      this.pendingEquip = null;
    }
  }

  private handlePreSync() {
    this.resetInputs();

    if (this.stateTicks > this.options.syncTimeoutTicks) {
      this.port.log("WARN: equip preparation timed out.");
      this.stopFlight();
      return;
    }

    if (this.pendingEquip) return;

    const token = ++this.equipToken;
    this.pendingEquip = (async () => {
      try {
        const result = await this.port.ensureElytraEquipped();
        if (token !== this.equipToken || this.currentState !== FlightState.PRE_SYNC) return;
        this.processEquipResult(result);
      } catch (error) {
        if (token !== this.equipToken || this.currentState !== FlightState.PRE_SYNC) return;
        this.port.log(`FAIL: ${String(error)}`);
        this.stopFlight();
      } finally {
        if (token === this.equipToken) {
          this.pendingEquip = null;
        }
      }
    })();
  }

  private handleEquipping() {
    this.resetInputs();

    if (this.stateTicks > this.options.syncTimeoutTicks) {
      this.port.log("FAIL: equip confirmation timed out.");
      this.stopFlight();
      return;
    }

    if (this.port.isElytraEquipped()) {
      this.port.log("Equip confirmed. Moving to warmup.");
      this.transitionTo(FlightState.WARMUP);
    }
  }

  private handleWarmup(snapshot: BounceSnapshot) {
    const yaw = this.getLockedYaw(snapshot);
    const speedInDirection = this.getForwardSpeed(snapshot.velocity, yaw ?? snapshot.yaw);

    if (speedInDirection > this.options.warmupSpeedThreshold || !snapshot.onGround) {
      this.port.log(`Warmup Complete (DirSpeed: ${speedInDirection.toFixed(2)}). Launching.`);
      this.transitionTo(FlightState.LAUNCHING);
      return;
    }

    this.submitInput({ forward: true, sprint: true, jump: false, yaw, pitch: null }, snapshot);
  }

  private handleLaunching(snapshot: BounceSnapshot) {
    if (this.stateTicks > this.options.takeoffTimeoutTicks) {
      this.port.log("FAIL: takeoff timed out.");
      this.stopFlight();
      return;
    }

    const yaw = this.getLockedYaw(snapshot);

    // This intentionally mirrors the provided Java ebounce sequence rather than
    // mineflayer's assistTakeoff helper: settle the jump edges ourselves, send
    // START_FLYING_WITH_ELYTRA on the launch window, then carry that local
    // fall-flying bit forward through rebounces for anticheat experiments.
    switch (this.stateTicks) {
      case 1:
        this.port.setClientSideSprinting(true);
        this.submitInput({ forward: true, sprint: true, jump: true, yaw, pitch: null }, snapshot);
        return;
      case 2:
        this.submitInput({ forward: true, sprint: true, jump: false, yaw, pitch: null }, snapshot);
        return;
      case 5:
        if (!snapshot.onGround) {
          this.sendStartFlyingPacket("launch");
          this.port.setClientSideFallFlying(true);
        } else {
          this.stateTicks--;
        }
        this.port.setClientSideSprinting(true);
        this.submitInput({ forward: true, sprint: true, jump: true, yaw, pitch: null }, snapshot);
        return;
      case 6:
        this.submitInput({ forward: true, sprint: true, jump: false, yaw, pitch: null }, snapshot);
        this.transitionTo(FlightState.BOUNCING);
        return;
      default:
        this.submitInput({ forward: true, sprint: true, jump: false, yaw, pitch: null }, snapshot);
        return;
    }
  }

  private handleBouncing(snapshot: BounceSnapshot, speedBps: number) {
    this.bounceTicks++;
    this.lastBounceOnGround = snapshot.onGround;
    const jumpThisTick = snapshot.onGround;
    if (snapshot.onGround) {
      this.bounceGroundTicks++;
    }
    if (snapshot.rawFallFlying) {
      this.bounceFallFlyingTicks++;
    }
    if (snapshot.sprinting) {
      this.bounceSprintingTicks++;
    }

    this.port.log(
      `Bounce tick=${this.bounceTicks} onGround=${snapshot.onGround} ` +
      `jump=${jumpThisTick} controlJump=${snapshot.controlJump} ` +
      `fallFlying=${snapshot.rawFallFlying} sprinting=${snapshot.sprinting}` +
      (snapshot.clientOnGround == null ? "" : ` clientOnGround=${snapshot.clientOnGround}`) +
      (snapshot.clientFallFlying == null ? "" : ` clientFallFlying=${snapshot.clientFallFlying}`) +
      (snapshot.clientSprinting == null ? "" : ` clientSprinting=${snapshot.clientSprinting}`),
    );

    if (snapshot.onGround && speedBps < this.options.maxBoostSpeed && speedBps > this.options.minBoostSpeed) {
      this.port.setVerticalVelocity(0);
    }

    if (snapshot.onGround) {
      this.port.setClientSideSprinting(true);
    } else if (!snapshot.rawFallFlying) {
      this.port.log("State correction: resending START_FLYING_WITH_ELYTRA.");
      this.sendStartFlyingPacket("state_correction");
    }

    this.submitInput({
      forward: true,
      sprint: true,
      jump: jumpThisTick,
      yaw: this.getLockedYaw(snapshot),
      pitch: this.getLockedPitch(),
    }, snapshot);
    if (!snapshot.onGround) {
      this.port.setClientSideFallFlying(true);
    }
  }

  private processEquipResult(result: EquipResult) {
    this.port.log(`Equipment Check Result: ${result}`);
    switch (result) {
      case EquipResult.ALREADY_EQUIPPED:
        this.transitionTo(FlightState.WARMUP);
        return;
      case EquipResult.JUST_SWAPPED:
        this.transitionTo(FlightState.EQUIPPING);
        return;
      case EquipResult.FAILED:
        this.port.log("FAIL: usable elytra not found.");
        this.stopFlight();
        return;
    }
  }

  private cleanup() {
    this.lastPos = null;
    this.lockedYaw = null;
    this.targetYaw = null;
    this.targetPitch = null;
    this.currentSpeed = 0;
    this.startFlyingPacketCount = 0;
    this.lastJumpCommand = false;
    this.jumpAttemptCount = 0;
    this.lastObservedOnGround = null;
    this.lastObservedFallFlying = null;
    this.lastObservedClientFallFlying = null;
    this.bounceTicks = 0;
    this.bounceGroundTicks = 0;
    this.bounceFallFlyingTicks = 0;
    this.bounceSprintingTicks = 0;
    this.lastBounceOnGround = false;
  }

  private calculateSpeed(position: BounceVector) {
    if (this.lastPos == null) {
      this.lastPos = { ...position };
      return 0;
    }

    const dx = position.x - this.lastPos.x;
    const dz = position.z - this.lastPos.z;
    const dist = Math.sqrt((dx * dx) + (dz * dz));
    this.lastPos = { ...position };

    if (dist > this.options.maxTeleportDistance) {
      return 0;
    }

    return dist * 20;
  }

  private resetInputs() {
    this.port.setInput({ forward: false, sprint: false, jump: false, yaw: null, pitch: null });
    this.lastJumpCommand = false;
  }

  private submitInput(input: BounceInput, snapshot: BounceSnapshot) {
    this.port.setInput(input);
    this.recordJumpAttempt(input.jump, snapshot);
  }

  private getLockedYaw(snapshot: BounceSnapshot) {
    if (this.targetYaw != null) return this.targetYaw;
    if (!this.lockYaw) return null;
    if (this.lockedYaw == null) {
      this.lockedYaw = snapshot.yaw;
    }
    return this.lockedYaw;
  }

  private getLockedPitch() {
    if (this.targetPitch != null) return this.targetPitch;
    return this.lockPitch ? toRadians(this.options.targetPitchDeg) : null;
  }

  private isConfirmedFallFlying(snapshot: BounceSnapshot) {
    return snapshot.rawFallFlying && !snapshot.pendingFlight;
  }

  private recordJumpAttempt(jump: boolean, snapshot: BounceSnapshot) {
    if (!jump || this.lastJumpCommand) {
      this.lastJumpCommand = jump;
      return;
    }

    this.jumpAttemptCount++;
    this.port.log(
      `Jump attempt=${this.jumpAttemptCount} state=${this.currentState} tick=${this.stateTicks} ` +
      `onGround=${snapshot.onGround} sentOnGround=${snapshot.lastSentOnGround} ` +
      `fallFlying=${snapshot.rawFallFlying} pendingFlight=${snapshot.pendingFlight} pendingRequest=${snapshot.pendingRequest}`,
    );
    this.lastJumpCommand = true;
  }

  private sendStartFlyingPacket(reason: "launch" | "state_correction") {
    this.startFlyingPacketCount++;
    this.port.log(`Sending START_FLYING_WITH_ELYTRA. count=${this.startFlyingPacketCount} reason=${reason}`);
    this.port.sendStartFlyingPacket();
  }

  private logStateEdges(snapshot: BounceSnapshot) {
    if (this.currentState === FlightState.IDLE) {
      this.lastObservedOnGround = snapshot.onGround;
      this.lastObservedFallFlying = snapshot.rawFallFlying;
      this.lastObservedClientFallFlying = snapshot.clientFallFlying;
      return;
    }

    if (this.lastObservedOnGround != null && this.lastObservedOnGround !== snapshot.onGround) {
      if (snapshot.onGround) {
        this.port.log(
          `Ground contact state=${this.currentState} tick=${this.stateTicks} ` +
          `speed=${this.currentSpeed.toFixed(2)} pos=${this.formatVec3(snapshot.position)} vel=${this.formatVec3(snapshot.velocity)}`,
        );
      } else {
        this.port.log(
          `Left ground state=${this.currentState} tick=${this.stateTicks} ` +
          `speed=${this.currentSpeed.toFixed(2)} pos=${this.formatVec3(snapshot.position)} vel=${this.formatVec3(snapshot.velocity)}`,
        );
      }
    }

    if (this.lastObservedFallFlying != null && this.lastObservedFallFlying !== snapshot.rawFallFlying) {
      this.port.log(
        `FallFlying=${snapshot.rawFallFlying} state=${this.currentState} tick=${this.stateTicks} ` +
        `pendingFlight=${snapshot.pendingFlight} pos=${this.formatVec3(snapshot.position)} vel=${this.formatVec3(snapshot.velocity)}`,
      );
    }

    if (
      this.lastObservedClientFallFlying != null &&
      snapshot.clientFallFlying != null &&
      this.lastObservedClientFallFlying !== snapshot.clientFallFlying &&
      snapshot.clientFallFlying === false
    ) {
      this.port.log(
        `WARN: clientFallFlying=false state=${this.currentState} tick=${this.stateTicks} ` +
        `rawFallFlying=${snapshot.rawFallFlying} pendingFlight=${snapshot.pendingFlight} ` +
        `pos=${this.formatVec3(snapshot.position)} vel=${this.formatVec3(snapshot.velocity)}`,
      );
    }

    this.lastObservedOnGround = snapshot.onGround;
    this.lastObservedFallFlying = snapshot.rawFallFlying;
    this.lastObservedClientFallFlying = snapshot.clientFallFlying;
  }

  private getForwardSpeed(velocity: BounceVector, yaw: number) {
    const lookX = -Math.sin(yaw);
    const lookZ = Math.cos(yaw);
    return Math.abs((velocity.x * lookX) + (velocity.z * lookZ));
  }

  private formatVec3(vec: BounceVector) {
    return `${vec.x.toFixed(3)},${vec.y.toFixed(3)},${vec.z.toFixed(3)}`;
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
      if (args[1] != null) {
        const pitch = Number(args[1]);
        if (!Number.isNaN(pitch)) controller.setTargetPitchDegrees(pitch);
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
    case "pitch":
      if (args[0] === "clear") {
        controller.clearTargetPitch();
        bot.chat("Target pitch cleared.");
        return;
      }

      if (args[0] != null) {
        const pitch = Number(args[0]);
        if (!Number.isNaN(pitch)) {
          controller.setTargetPitchDegrees(pitch);
          bot.chat(`Target pitch set to ${pitch.toFixed(1)}.`);
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
      controller = new EBounceController(new MineflayerEBouncePort(bot, helpers.physicsSwitcher));
      registerLogging(bot, controller);
      bot.on("physicsTickBegin", () => {
        controller.tick();
      });
    },
    onSpawn: async (bot, helpers) => {
      helpers.physicsSwitcher.enable();
      console.log("[ebounce] new engine enabled");
      console.log("[ebounce] chat commands: prep | bounce [yawDeg] [pitchDeg] | boost | stop | status | yaw <deg|clear> | pitch <deg|clear> | lockyaw <true|false> | lockpitch <true|false> | reset");
      await ensureBounceLoadout(bot).catch(() => {});
    },
    onChat: async (bot, username, message) => {
      await handleChatCommand(bot, username, message, controller);
    },
  });
}

activeBot = buildBot();
