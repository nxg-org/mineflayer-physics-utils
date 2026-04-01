import { EventEmitter } from "events";
import { Bot } from "mineflayer";
import { performElytraTakeoff, type PhysicsBot } from "./botSetup";
import {
  ensureBounceLoadout,
  findFireworkRocket,
  findInventoryItem,
  isUsableElytra,
  toRadians,
} from "./ebounceShared";

export type Pitch40Bot = PhysicsBot & {
  fireworkRocketDuration: number;
};

export type Pitch40Config = {
  upPitchDeg: number;
  downPitchDeg: number;
  maxHeight: number;
  minHeight: number;
  transitionSteps: number;
  useFireworks: boolean;
  fireworkExtraHeight: number;
  fireworkMaintainPitchDeg: number;
  fireworkCooldownTicks: number;
  emergencyEnabled: boolean;
  emergencyPitchDeg: number;
};

export const DEFAULT_PITCH40_CONFIG: Pitch40Config = {
  upPitchDeg: 40,
  downPitchDeg: -40,
  maxHeight: 380,
  minHeight: 310,
  transitionSteps: 10,
  useFireworks: true,
  fireworkExtraHeight: 10,
  fireworkMaintainPitchDeg: 0,
  fireworkCooldownTicks: 60,
  emergencyEnabled: true,
  emergencyPitchDeg: 10,
};

export type Pitch40Snapshot = {
  y: number;
  yaw: number;
  pitch: number;
  fallFlying: boolean;
  onGround: boolean;
  fireworkTicks: number;
  holdingFirework: boolean;
  hasFirework: boolean;
  hasUsableElytra: boolean;
};

export type Pitch40StatusEvent = {
  enabled: boolean;
  y: number;
  pitchDeg: number;
  fallFlying: boolean;
  onGround: boolean;
  fireworkTicks: number;
  goingUp: boolean;
  usingFireworkRecovery: boolean;
  emergency: boolean;
  fireworkDelay: number;
  targetPitchDeg: number | null;
  transitionStepIndex: number | null;
  transitionSteps: number | null;
};

export interface Pitch40Port {
  getSnapshot(): Pitch40Snapshot;
  setPitchDegrees(pitchDeg: number): void;
  ensureFireworkHeld(): Promise<boolean>;
  activateFirework(): void;
  log(message: string): void;
}

export class MineflayerPitch40Port implements Pitch40Port {
  private pendingFireworkEquip: Promise<boolean> | null = null;

  constructor(
    private readonly bot: Pitch40Bot,
    private readonly loggingEnabled: boolean = true,
  ) {}

  public getSnapshot(): Pitch40Snapshot {
    const firework = findFireworkRocket(this.bot);
    const equippedElytra = this.bot.entity.equipment[4]?.name === "elytra" ? this.bot.entity.equipment[4] : null;
    const inventoryElytra = findInventoryItem(this.bot, "elytra");
    return {
      y: this.bot.entity.position.y,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      fallFlying: (this.bot.entity as any).fallFlying ?? this.bot.entity.elytraFlying ?? false,
      onGround: this.bot.entity.onGround,
      fireworkTicks: this.bot.fireworkRocketDuration ?? 0,
      holdingFirework: this.bot.heldItem?.name === "firework_rocket",
      hasFirework: firework != null,
      hasUsableElytra: isUsableElytra(equippedElytra as ReturnType<typeof findInventoryItem>) ||
        isUsableElytra(inventoryElytra as ReturnType<typeof findInventoryItem>),
    };
  }

  public setPitchDegrees(pitchDeg: number) {
    void this.bot.look(this.bot.entity.yaw, toRadians(pitchDeg), true);
  }

  public async ensureFireworkHeld(): Promise<boolean> {
    if (this.bot.heldItem?.name === "firework_rocket") return true;
    if (this.pendingFireworkEquip) return this.pendingFireworkEquip;

    this.pendingFireworkEquip = (async () => {
      try {
        const firework = findFireworkRocket(this.bot);
        if (firework == null) {
          return false;
        }

        if (firework.slot >= 36 && firework.slot <= 44) {
          this.bot.setQuickBarSlot(firework.slot - 36);
          return this.bot.heldItem?.name === "firework_rocket";
        }

        await this.bot.equip(firework, "hand");
        return this.bot.heldItem?.name === "firework_rocket";
      } finally {
        this.pendingFireworkEquip = null;
      }
    })();

    return this.pendingFireworkEquip;
  }

  public activateFirework() {
    this.bot.activateItem();
  }

  public log(message: string) {
    if (!this.loggingEnabled) return;
    console.log(`[pitch40] ${message}`);
  }
}

type TransitionState = {
  startPitchDeg: number;
  targetPitchDeg: number;
  steps: number;
  stepIndex: number;
};

export class Pitch40Controller extends EventEmitter {
  private enabled = false;
  private goingUp = false;
  private usingFireworkRecovery = false;
  private emergency = false;
  private fireworkDelay = 0;
  private lastY: number | null = null;
  private lastAppliedPitchDeg: number | null = null;
  private transition: TransitionState | null = null;
  private noFireworksLogged = false;
  private readonly config: Pitch40Config;

  constructor(
    private readonly port: Pitch40Port,
    config: Partial<Pitch40Config> = {},
  ) {
    super();
    this.config = {
      ...DEFAULT_PITCH40_CONFIG,
      ...config,
    };
  }

  public isEnabled() {
    return this.enabled;
  }

  public begin() {
    const snapshot = this.port.getSnapshot();

    if (!snapshot.hasUsableElytra) {
      this.log("Cannot start: no usable elytra equipped or available.");
      return false;
    }

    if (snapshot.y < this.config.maxHeight && !this.config.useFireworks) {
      this.log("Cannot start below maxHeight when fireworks are disabled.");
      return false;
    }

    this.enabled = true;
    this.usingFireworkRecovery = false;
    this.emergency = false;
    this.fireworkDelay = 0;
    this.noFireworksLogged = false;
    this.lastY = snapshot.y;

    if (snapshot.y < this.config.maxHeight) {
      this.goingUp = true;
      this.beginTransition(this.getCurrentPitchDegrees(snapshot), this.config.upPitchDeg);
    } else {
      this.goingUp = false;
      this.beginTransition(this.getCurrentPitchDegrees(snapshot), this.config.downPitchDeg);
    }

    this.log(
      `Started: y=${snapshot.y.toFixed(2)} goingUp=${this.goingUp} ` +
      `targetPitch=${this.getTargetPitchDescription()}`,
    );
    this.emit("enabled", { status: this.getStatusEvent(snapshot) });
    return true;
  }

  public stop() {
    if (!this.enabled) return;
    this.enabled = false;
    this.transition = null;
    this.usingFireworkRecovery = false;
    this.emergency = false;
    this.fireworkDelay = 0;
    this.lastY = null;
    this.lastAppliedPitchDeg = null;
    this.noFireworksLogged = false;
    this.log("Stopped.");
    this.emit("disabled");
  }

  public async launchAndBegin(
    bot: Pitch40Bot,
    yawDeg: number | null = null,
    takeoffPitchDeg: number = 50,
    useInitialFirework: boolean = false,
  ) {
    const yaw = yawDeg == null ? bot.entity.yaw : toRadians(yawDeg);
    await performElytraTakeoff(bot, yaw, toRadians(takeoffPitchDeg), useInitialFirework);
    if (useInitialFirework) {
      this.fireworkDelay = this.config.fireworkCooldownTicks;
      this.emit("firework", {
        action: "initial_takeoff",
        y: bot.entity.position.y,
        cooldownTicks: this.config.fireworkCooldownTicks,
      });
      this.log(`Initial takeoff firework used at y=${bot.entity.position.y.toFixed(2)}.`);
    }
    return this.begin();
  }

  public tick() {
    if (!this.enabled) return;

    if (this.fireworkDelay > 0) {
      this.fireworkDelay--;
    }

    const snapshot = this.port.getSnapshot();
    if (!snapshot.hasUsableElytra) {
      this.log("No usable elytra available. Stopping pitch40.");
      this.stop();
      return;
    }

    const currentPitchDeg = this.getCurrentPitchDegrees(snapshot);
    const nextPitchDeg = this.advanceTransition(currentPitchDeg);
    this.lastAppliedPitchDeg = nextPitchDeg;
    this.port.setPitchDegrees(nextPitchDeg);
    this.emit("tick_state", { status: this.getStatusEvent(snapshot, nextPitchDeg) });

    if (this.usingFireworkRecovery) {
      void this.handleFireworkRecovery(snapshot);
      this.lastY = snapshot.y;
      return;
    }

    if (this.goingUp) {
      if (this.config.useFireworks && this.lastY != null && snapshot.y < this.lastY && !this.isTransitioning()) {
        this.usingFireworkRecovery = true;
        this.log(
          `Detected climb stall at y=${snapshot.y.toFixed(2)} lastY=${this.lastY.toFixed(2)}. ` +
          "Switching to firework recovery.",
        );
        this.emit("mode_change", {
          mode: "firework_recovery",
          active: true,
          y: snapshot.y,
        });
      }

      if (snapshot.y >= this.config.maxHeight) {
        this.goingUp = false;
        this.beginTransition(nextPitchDeg, this.config.downPitchDeg);
        this.log(`Reached maxHeight=${this.config.maxHeight}. Transitioning downward.`);
        this.emit("mode_change", { mode: "going_up", active: false, y: snapshot.y });
      }
    } else if (snapshot.y <= this.config.minHeight && !this.emergency) {
      this.goingUp = true;
      this.beginTransition(nextPitchDeg, this.config.upPitchDeg);
      this.log(`Reached minHeight=${this.config.minHeight}. Transitioning upward.`);
      this.emit("mode_change", { mode: "going_up", active: true, y: snapshot.y });
    }

    this.lastY = snapshot.y;
  }

  public status() {
    const snapshot = this.port.getSnapshot();
    const currentPitch = this.lastAppliedPitchDeg ?? this.getCurrentPitchDegrees(snapshot);
    const transition = this.transition == null
      ? "idle"
      : `${this.transition.stepIndex}/${this.transition.steps}->${this.transition.targetPitchDeg.toFixed(1)}`;

    return [
      `enabled=${this.enabled}`,
      `y=${snapshot.y.toFixed(2)}`,
      `pitch=${currentPitch.toFixed(2)}`,
      `fallFlying=${snapshot.fallFlying}`,
      `onGround=${snapshot.onGround}`,
      `fireworkTicks=${snapshot.fireworkTicks}`,
      `goingUp=${this.goingUp}`,
      `usingFireworkRecovery=${this.usingFireworkRecovery}`,
      `emergency=${this.emergency}`,
      `fireworkDelay=${this.fireworkDelay}`,
      `transition=${transition}`,
      `cfg(up=${this.config.upPitchDeg},down=${this.config.downPitchDeg},min=${this.config.minHeight},max=${this.config.maxHeight},steps=${this.config.transitionSteps})`,
    ].join(" ");
  }

  public configure(name: string, value: string) {
    switch (name) {
      case "up":
        this.config.upPitchDeg = Number(value);
        return `upPitchDeg=${this.config.upPitchDeg}`;
      case "down":
        this.config.downPitchDeg = Number(value);
        return `downPitchDeg=${this.config.downPitchDeg}`;
      case "min":
        this.config.minHeight = Number(value);
        return `minHeight=${this.config.minHeight}`;
      case "max":
        this.config.maxHeight = Number(value);
        return `maxHeight=${this.config.maxHeight}`;
      case "steps":
        this.config.transitionSteps = Math.max(1, Number(value));
        return `transitionSteps=${this.config.transitionSteps}`;
      case "fireworks":
        this.config.useFireworks = value !== "false";
        return `useFireworks=${this.config.useFireworks}`;
      case "extra":
        this.config.fireworkExtraHeight = Number(value);
        return `fireworkExtraHeight=${this.config.fireworkExtraHeight}`;
      case "maintain":
        this.config.fireworkMaintainPitchDeg = Number(value);
        return `fireworkMaintainPitchDeg=${this.config.fireworkMaintainPitchDeg}`;
      case "cooldown":
        this.config.fireworkCooldownTicks = Math.max(0, Number(value));
        return `fireworkCooldownTicks=${this.config.fireworkCooldownTicks}`;
      case "emergency":
        this.config.emergencyEnabled = value !== "false";
        return `emergencyEnabled=${this.config.emergencyEnabled}`;
      case "emergencypitch":
        this.config.emergencyPitchDeg = Number(value);
        return `emergencyPitchDeg=${this.config.emergencyPitchDeg}`;
      default:
        return null;
    }
  }

  private async handleFireworkRecovery(snapshot: Pitch40Snapshot) {
    const isRocketActive = snapshot.fireworkTicks > 0;

    if (snapshot.y >= this.config.maxHeight + this.config.fireworkExtraHeight && isRocketActive) {
      this.beginTransition(
        this.lastAppliedPitchDeg ?? this.getCurrentPitchDegrees(snapshot),
        this.config.fireworkMaintainPitchDeg,
      );
      this.emit("mode_change", {
        mode: "maintain_pitch",
        active: true,
        y: snapshot.y,
      });
      return;
    }

    if (snapshot.y >= this.config.maxHeight && !isRocketActive) {
      this.usingFireworkRecovery = false;
      this.goingUp = false;
      this.beginTransition(
        this.lastAppliedPitchDeg ?? this.getCurrentPitchDegrees(snapshot),
        this.config.downPitchDeg,
      );
      this.log("Firework recovery completed. Transitioning back to glide-down pitch.");
      this.emit("mode_change", {
        mode: "firework_recovery",
        active: false,
        y: snapshot.y,
      });
      return;
    }

    if (snapshot.y > this.config.maxHeight) {
      return;
    }

    if (!snapshot.hasFirework) {
      if (this.config.emergencyEnabled && !this.emergency && this.fireworkDelay === 0) {
        this.emergency = true;
        this.goingUp = false;
        this.beginTransition(
          this.lastAppliedPitchDeg ?? this.getCurrentPitchDegrees(snapshot),
          this.config.emergencyPitchDeg,
        );
        this.log("No fireworks available. Switching to emergency glide pitch.");
        this.emit("emergency", {
          active: true,
          y: snapshot.y,
          pitchDeg: this.config.emergencyPitchDeg,
        });
      } else if (!this.noFireworksLogged) {
        this.noFireworksLogged = true;
        this.log("No fireworks available.");
      }
      return;
    }

    this.noFireworksLogged = false;

    if (this.emergency) {
      this.emergency = false;
      this.goingUp = true;
      this.beginTransition(
        this.lastAppliedPitchDeg ?? this.getCurrentPitchDegrees(snapshot),
        this.config.upPitchDeg,
      );
      this.log("Fireworks restored. Leaving emergency pitch.");
      this.emit("emergency", {
        active: false,
        y: snapshot.y,
        pitchDeg: this.config.upPitchDeg,
      });
    }

    if (!snapshot.holdingFirework) {
      const held = await this.port.ensureFireworkHeld();
      if (!held) {
        return;
      }
    }

    if (!isRocketActive && this.fireworkDelay === 0 && !this.isTransitioning() && snapshot.fallFlying) {
      this.port.activateFirework();
      this.fireworkDelay = this.config.fireworkCooldownTicks;
      this.log(`Activated firework at y=${snapshot.y.toFixed(2)}.`);
      this.emit("firework", {
        action: "activate",
        y: snapshot.y,
        cooldownTicks: this.config.fireworkCooldownTicks,
      });
    }
  }

  private beginTransition(currentPitchDeg: number, targetPitchDeg: number) {
    const steps = Math.max(1, this.config.transitionSteps);
    this.transition = {
      startPitchDeg: currentPitchDeg,
      targetPitchDeg,
      steps,
      stepIndex: 0,
    };
    this.emit("transition_start", {
      fromPitchDeg: currentPitchDeg,
      targetPitchDeg,
      steps,
    });
  }

  private advanceTransition(currentPitchDeg: number) {
    if (this.transition == null) {
      return this.lastAppliedPitchDeg ?? currentPitchDeg;
    }

    this.transition.stepIndex++;
    const progress = Math.min(1, this.transition.stepIndex / this.transition.steps);
    const pitchDeg = this.transition.startPitchDeg +
      ((this.transition.targetPitchDeg - this.transition.startPitchDeg) * progress);

    if (progress >= 1) {
      this.transition = null;
    }

    this.emit("transition_tick", {
      pitchDeg,
      progress,
      targetPitchDeg: this.transition?.targetPitchDeg ?? pitchDeg,
      stepIndex: this.transition?.stepIndex ?? null,
      steps: this.transition?.steps ?? null,
    });

    return pitchDeg;
  }

  private isTransitioning() {
    return this.transition != null;
  }

  private getCurrentPitchDegrees(snapshot: Pitch40Snapshot) {
    return snapshot.pitch * 180 / Math.PI;
  }

  private getTargetPitchDescription() {
    if (this.transition == null) return "none";
    return this.transition.targetPitchDeg.toFixed(1);
  }

  private getStatusEvent(snapshot: Pitch40Snapshot, pitchDegOverride?: number): Pitch40StatusEvent {
    return {
      enabled: this.enabled,
      y: snapshot.y,
      pitchDeg: pitchDegOverride ?? this.lastAppliedPitchDeg ?? this.getCurrentPitchDegrees(snapshot),
      fallFlying: snapshot.fallFlying,
      onGround: snapshot.onGround,
      fireworkTicks: snapshot.fireworkTicks,
      goingUp: this.goingUp,
      usingFireworkRecovery: this.usingFireworkRecovery,
      emergency: this.emergency,
      fireworkDelay: this.fireworkDelay,
      targetPitchDeg: this.transition?.targetPitchDeg ?? null,
      transitionStepIndex: this.transition?.stepIndex ?? null,
      transitionSteps: this.transition?.steps ?? null,
    };
  }

  private log(message: string) {
    this.port.log(message);
    this.emit("log", { message });
  }
}

export async function ensurePitch40Loadout(bot: Bot) {
  await ensureBounceLoadout(bot);
}

export function registerPitch40Logging(bot: Pitch40Bot, controller: Pitch40Controller, enabled: boolean = true) {
  if (!enabled) return;

  bot.on("entityElytraFlew", (entity) => {
    if (entity.id !== bot.entity.id) return;
    console.log("[pitch40] entityElytraFlew", controller.status());
  });

  bot.on("usedFirework", () => {
    console.log("[pitch40] usedFirework", {
      fireworkRocketDuration: bot.fireworkRocketDuration,
    });
  });

  bot.on("end", () => {
    controller.stop();
  });
}
