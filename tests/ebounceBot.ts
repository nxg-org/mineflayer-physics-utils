import { Bot } from "mineflayer";
import { PlayerState } from "../src/physics/states";
import { buildManagedBot, getBotOptionsFromArgs, type PhysicsBot, type PhysicsSwitcher, sleep } from "./util/botSetup";

type EBounceBot = PhysicsBot & {
  elytraFly: () => Promise<void>;
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
const WARMUP_SPEED_THRESHOLD = 0.15;
const MIN_BOOST_SPEED = 30.0;
const MAX_SPEED = 100.0;
const TARGET_PITCH_DEG = -72.4;

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
  private lockPitch = true;
  private lockYaw = true;
  private targetYaw: number | null = null;
  private lockedYaw: number | null = null;
  private equipToken = 0;
  private pendingEquip: Promise<void> | null = null;
  private pendingLook: Promise<void> | null = null;
  private desiredLook: { yaw: number; pitch: number } | null = null;
  private currentSpeed = 0;
  private launchJumpReleased = false;
  private launchAirborneMoveSeen = false;
  private glideRequested = false;

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

    this.transitionTo(FlightState.IDLE);
    this.cleanupPhysics();
    this.resetInputs();
    this.setClientSideFallFlying(false);
  }

  public resetState() {
    this.log("Forcing state reset.");
    this.currentState = FlightState.IDLE;
    this.stateTicks = 0;
    this.cleanupPhysics();
    this.resetInputs();
    this.setClientSideFallFlying(false);
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
      `onGround=${this.bot.entity.onGround}`,
      `elytraFlying=${this.bot.entity.elytraFlying}`,
      `fallFlying=${this.isServerSideFallFlying()}`,
      `fireworkTicks=${this.bot.fireworkRocketDuration}`,
      `speed=${this.currentSpeed.toFixed(2)}`,
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

  public onMove() {
    if (this.currentState !== FlightState.LAUNCHING) return;
    if (!this.launchJumpReleased) return;
    if (this.bot.entity.onGround) return;
    if (this.launchAirborneMoveSeen) return;

    this.launchAirborneMoveSeen = true;
    this.log("Observed airborne movement after jump release.");
  }

  public onDeathLikeEvent() {
    this.log("Resetting state after disconnect/death-like event.");
    this.resetState();
  }

  private transitionTo(newState: FlightState) {
    if (this.currentState === newState) return;
    this.log(`State: ${this.currentState} -> ${newState}`);
    this.currentState = newState;
    this.stateTicks = 0;

    if (newState === FlightState.BOUNCING) {
      this.lockedYaw = this.bot.entity.yaw;
    }

    this.launchJumpReleased = false;
    this.launchAirborneMoveSeen = false;
    this.glideRequested = false;

    if (newState === FlightState.IDLE) {
      this.pendingEquip = null;
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
    const yaw = this.getLockedYaw();
    const pitch = this.getLockedPitch();

    switch (this.stateTicks) {
      case 1:
        this.setClientSideFallFlying(false);
        this.submitInput(true, true, true, yaw, pitch);
        return;
      default:
        this.launchJumpReleased = true;
        this.submitInput(true, true, false, yaw, pitch);  
        if (!this.launchAirborneMoveSeen) return;

        if (!this.glideRequested) {
          this.glideRequested = true;
          this.log("Sending glide request after airborne movement.");
          this.requestStartFlying();
          return;
        }

        // if (this.isServerSideFallFlying()) {
          this.log("Server accepted glide. Entering bounce state.");
          this.transitionTo(FlightState.BOUNCING);
        // }
        return;
    }
  }

  private handleBouncing(speedBps: number) {
    const isOnGround = this.bot.entity.onGround;

    if (isOnGround && speedBps < MAX_SPEED && speedBps > MIN_BOOST_SPEED) {
      this.bot.entity.velocity.y = 0;
    }

    this.submitInput(true, true, isOnGround, this.getLockedYaw(), this.getLockedPitch());
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
    this.lockedYaw = null;
    this.targetYaw = null;
    this.desiredLook = null;
    this.currentSpeed = 0;
    this.launchJumpReleased = false;
    this.launchAirborneMoveSeen = false;
    this.glideRequested = false;
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

  private submitInput(forward: boolean, sprint: boolean, jump: boolean, yaw: number | null, pitch: number | null) {
    this.bot.setControlState("forward", forward);
    this.bot.setControlState("back", false);
    this.bot.setControlState("left", false);
    this.bot.setControlState("right", false);
    this.bot.setControlState("sprint", sprint);
    this.bot.setControlState("jump", jump);
    this.bot.setControlState("sneak", false);

    // this.bot.chat(`Submitting input: forward=${forward}, sprint=${sprint}, jump=${jump}`);

    if (yaw != null || pitch != null) {
      const nextYaw = yaw ?? this.bot.entity.yaw;
      const nextPitch = pitch ?? this.bot.entity.pitch;
      this.applyLook(nextYaw, nextPitch);
    }
  }

  private applyLook(yaw: number, pitch: number) {
    this.bot.look(yaw, pitch).finally((() => {
    }));
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

  private requestStartFlying() {
    void this.bot.elytraFly().catch(() => {});
  }

  private isServerSideFallFlying() {
    const state = this.physicsSwitcher.getState();
    return this.bot.entity.elytraFlying ?? (this.bot.entity as any).fallFlying ?? state?.fallFlying ?? false;
  }

  private setClientSideFallFlying(enabled: boolean) {
    (this.bot.entity as any).fallFlying = enabled;

    const state = this.physicsSwitcher.getState() as PlayerState | null;
    if (state) {
      state.fallFlying = enabled;
      state.elytraFlying = enabled;
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
        const pitch = Number(args[1]);
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
      bot.on("move", () => {
        controller.onMove();
      });
      bot.on("physicsTick", () => {
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
