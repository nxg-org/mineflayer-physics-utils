import { Bot, createBot } from "mineflayer";
import loader, { BotcraftPhysics, EntityState, EPhysicsCtx } from "../../../src/index";
import { IEntityState, PlayerState } from "../../../src/physics/states";
import type { IPhysics } from "../../../src/physics/engines/IPhysics";

export type PhysicsBot = Bot & {
  physics: {
    yawSpeed: number;
    pitchSpeed: number;
    autojumpCooldown: number;
    simulatePlayer: (...args: any[]) => unknown;
  };
  physicsEngine?: unknown;
  physicsEngineCtx?: unknown;
  elytraFly?: (options?: { assistTakeoff?: boolean } | boolean) => Promise<void>;
  fireworkRocketDuration?: number;
};

type ForkPhysicsEngine = IPhysics & {
  simulate: (ctx: EPhysicsCtx, world: Bot["world"]) => unknown;
};

type BotOptions = Parameters<typeof createBot>[0];

type ManagedBotHooks<TBot extends PhysicsBot> = {
  afterCreate?: (bot: TBot, helpers: BotHelpers<TBot>) => void;
  onSpawn?: (bot: TBot, helpers: BotHelpers<TBot>) => Promise<void> | void;
  onChat?: (bot: TBot, username: string, message: string, helpers: BotHelpers<TBot>) => Promise<void> | void;
};

export type PhysicsSwitcher<TBot extends PhysicsBot = PhysicsBot> = ReturnType<typeof createPhysicsSwitcher<TBot>>;
export type BotHelpers<TBot extends PhysicsBot = PhysicsBot> = {
  physicsSwitcher: PhysicsSwitcher<TBot>;
};

const rl = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});
const DEFAULT_CLI_USERNAME = "cli";

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function performElytraTakeoff(
  bot: PhysicsBot,
  yaw: number,
  pitch: number,
  activateItem = false,
  requestFlight: (() => Promise<void>) | null = null,
) {
  if (typeof bot.elytraFly !== "function") {
    throw new Error("Bot does not support elytraFly()");
  }

  await bot.look(yaw, pitch);
  bot.setControlState("jump", true);
  // bot.setControlState("forward", true);
  // bot.setControlState("sprint", true);
  await bot.waitForTicks(1);
  bot.setControlState("jump", false);

  await bot.waitForTicks(1);
  if (requestFlight) {
    await requestFlight();
  } else {
    await bot.elytraFly();
  }
  if (activateItem) {
    await bot.waitForTicks(1);
    bot.activateItem();
  }
}

export function getBotOptionsFromArgs(args: {
  defaultUsername: string;
  usernameIndex?: number;
  versionIndex: number;
  authIndex: number;
}): BotOptions {
  const {
    defaultUsername,
    usernameIndex,
    versionIndex,
    authIndex,
  } = args;

  return {
    host: process.argv[2] ?? "localhost",
    port: Number(process.argv[3]),
    username: usernameIndex == null ? defaultUsername : process.argv[usernameIndex] ?? defaultUsername,
    version: process.argv[versionIndex],
    auth: (process.argv[authIndex] as any) ?? "offline",
    logErrors: false,
    hideErrors: true
  };
}

function getActivePhysicsEngine(bot: PhysicsBot): IPhysics | null {
  const physicsEngine = bot.physicsEngine;
  if (!physicsEngine || typeof physicsEngine !== "object") return null;

  const maybePhysics = physicsEngine as Partial<IPhysics> & { constructor?: { name?: string } };
  if (maybePhysics.constructor?.name !== "BotcraftPhysics") return null;
  if (typeof maybePhysics.simulate !== "function") return null;

  return physicsEngine as IPhysics;
}

function getActivePhysicsState(bot: PhysicsBot): PlayerState | null {
  const physicsCtx = bot.physicsEngineCtx;
  if (!physicsCtx || typeof physicsCtx !== "object") return null;

  const maybeState = (physicsCtx as { state?: unknown }).state;
  return maybeState instanceof PlayerState ? maybeState : null;
}

export function createPhysicsSwitcher<TBot extends PhysicsBot>(bot: TBot) {
  let enabled = false;
  let fallbackState: PlayerState | null = null;

  const enable = () => {
    if (enabled) return false;
    enabled = true;

    const overridePhysics = new BotcraftPhysics(bot.registry);
    const overrideCtx = EPhysicsCtx.FROM_BOT(overridePhysics, bot);

    bot.physics.autojumpCooldown = 0;

    const activePhysics = getActivePhysicsEngine(bot);
    if (activePhysics) {
      const forkPhysics = activePhysics as ForkPhysicsEngine;

      forkPhysics.simulate = (ctx: EPhysicsCtx<IEntityState>, world: Bot["world"]) => {
        const newState = overrideCtx.state;
        (ctx as { state: IEntityState }).state = newState;
        (ctx.state as PlayerState).update(bot);
        return overridePhysics.simulate(ctx, world);
      };

      bot.physics.simulatePlayer = (_oldState, world) => {
        const compatCtx = EPhysicsCtx.FROM_BOT(overridePhysics, bot);
        fallbackState = compatCtx.state as PlayerState;
        fallbackState.update(bot);
        compatCtx.state.jumpTicks = 0;
        return overridePhysics.simulate(compatCtx, world ?? bot.world);
      };

      return true;
    }

    (EntityState.prototype as any).apply = function applyState(this: EntityState, currentBot: Bot) {
      this.applyToBot(currentBot);
    };

    fallbackState = overrideCtx.state as PlayerState;

    bot.physics.simulatePlayer = () => {
      fallbackState!.update(bot);
      overrideCtx.state.jumpTicks = 0;
      return overridePhysics.simulate(overrideCtx, bot.world);
    };

    return true;
  };

  const reset = () => {
    enabled = false;
    fallbackState = null;
  };

  return {
    enable,
    reset,
    getState: () => getActivePhysicsState(bot) ?? fallbackState,
    isEnabled: () => enabled,
  };
}

export function registerConsoleRelay<TBot extends PhysicsBot>(
  bot: TBot,
  hooks: ManagedBotHooks<TBot>,
  helpers: BotHelpers<TBot>,
) {
  rl.removeAllListeners("line");
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;

    if (trimmed.startsWith("chat ")) {
      bot.chat(trimmed.slice(5));
      return;
    }

    void hooks.onChat?.(bot, DEFAULT_CLI_USERNAME, trimmed, helpers);
  });
}

export function buildManagedBot<TBot extends PhysicsBot>(
  getBotOptions: () => BotOptions,
  hooks: ManagedBotHooks<TBot> = {},
): TBot {
  const bot = createBot(getBotOptions()) as TBot;
  const helpers: BotHelpers<TBot> = {
    physicsSwitcher: createPhysicsSwitcher(bot),
  };

  bot.once("spawn", async () => {
    bot.loadPlugin(loader);

    bot.physics.yawSpeed = 6000;
    bot.physics.pitchSpeed = 6000;
    await bot.waitForTicks(20);
    await hooks.onSpawn?.(bot, helpers);
  });

  if (hooks.onChat) {
    bot.on("chat", (username, message) => {
      void hooks.onChat?.(bot, username, message, helpers);
    });
  }

  registerConsoleRelay(bot, hooks, helpers);
  bot.on("kicked", console.log);
  bot.on("error", console.log);

  hooks.afterCreate?.(bot, helpers);

  return bot;
}
