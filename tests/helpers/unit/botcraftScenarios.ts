import { createHash } from "crypto";
import block, { Block as PBlock } from "prismarine-block";
import { Vec3 } from "vec3";
import { BotcraftPhysics } from "../../../src/physics/engines";
import { ControlStateHandler } from "../../../src/physics/player";
import { PlayerState } from "../../../src/physics/states/playerState";
import { createBotcraftPlayerRig, loadMcData } from "./botcraftTestSupport";

/**
 * Deterministic movement scenarios for BotcraftPhysics.
 *
 * Used by the tick equivalence test (per-tick state is compared against a recorded trace)
 * and by the tick benchmark. Re-record the trace with `tests/bench/recordBotcraftTraces.ts`
 * only when a physics change is intended.
 */

const OFFSET = 1 << 11;
const packKey = (x: number, y: number, z: number) => ((x + OFFSET) * (OFFSET * 2) + (y + OFFSET)) * (OFFSET * 2) + (z + OFFSET);

/**
 * Minimal synchronous world backed by block state ids, mirroring prismarine-world's
 * `getBlock` (fresh Block per call, floored position) and `getBlockStateId`.
 */
export class StateIdWorld {
  private readonly blocks = new Map<number, number>();
  public getBlockCalls = 0;
  public getBlockStateIdCalls = 0;

  constructor(
    private readonly Block: typeof PBlock,
    private readonly floorY: number,
    private readonly floorStateId: number,
    private readonly airStateId: number,
  ) {}

  set(x: number, y: number, z: number, stateId: number) {
    this.blocks.set(packKey(x, y, z), stateId);
  }

  fill(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, stateId: number) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        for (let z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
          this.set(x, y, z, stateId);
        }
      }
    }
  }

  stateIdAt(x: number, y: number, z: number) {
    const stateId = this.blocks.get(packKey(x, y, z));
    if (stateId !== undefined) return stateId;
    return y < this.floorY ? this.floorStateId : this.airStateId;
  }

  getBlockStateId(pos: { x: number; y: number; z: number }) {
    this.getBlockStateIdCalls++;
    return this.stateIdAt(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
  }

  getBlock(pos: { x: number; y: number; z: number }) {
    this.getBlockCalls++;
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    const b = this.Block.fromStateId(this.stateIdAt(x, y, z), 0);
    b.position = new Vec3(x, y, z);
    return b;
  }

  /** The shape mineflayer's physics plugin passes to the engine: `getBlock` only. */
  blockOnly() {
    return { getBlock: (pos: Vec3) => this.getBlock(pos) };
  }
}

type BlockHelper = (name: string, props?: Record<string, string | number | boolean>) => number;

type ScenarioBuild = {
  world: StateIdWorld;
  st: BlockHelper;
};

type Scenario = {
  name: string;
  ticks: number;
  start: [number, number, number];
  yaw?: number;
  pitch?: number;
  /** override floor (top surface y) */
  floorY?: number;
  floorBlock?: string;
  build?: (b: ScenarioBuild) => void;
  setup?: (state: PlayerState, mcData: ReturnType<typeof loadMcData>["mcData"]) => void;
  controls: (tick: number, state: PlayerState) => void;
};

const FLOOR = 64;

function setControls(state: PlayerState, c: Partial<Record<"forward" | "back" | "left" | "right" | "jump" | "sprint" | "sneak", boolean>>) {
  state.control.forward = !!c.forward;
  state.control.back = !!c.back;
  state.control.left = !!c.left;
  state.control.right = !!c.right;
  state.control.jump = !!c.jump;
  state.control.sprint = !!c.sprint;
  state.control.sneak = !!c.sneak;
}

// yaw 0 faces -z in mineflayer.
export const scenarios: Scenario[] = [
  {
    name: "sprint_flat",
    ticks: 80,
    start: [0.5, FLOOR, 0.5],
    controls: (t, s) => setControls(s, { forward: t < 60, sprint: t < 60 }),
  },
  {
    name: "sprint_jump",
    ticks: 100,
    start: [0.5, FLOOR, 0.5],
    yaw: 0.3,
    controls: (t, s) => setControls(s, { forward: true, sprint: true, jump: t > 5 }),
  },
  {
    name: "walk_strafe_diagonal",
    ticks: 60,
    start: [0.5, FLOOR, 0.5],
    yaw: 2.2,
    controls: (t, s) => setControls(s, { forward: true, left: t < 30, right: t >= 40 }),
  },
  {
    name: "sneak_edge",
    ticks: 80,
    start: [0.5, FLOOR, 0.5],
    floorY: -100,
    build: ({ world, st }) => world.fill(-3, FLOOR - 1, -3, 3, FLOOR - 1, 3, st("stone")),
    controls: (t, s) => {
      s.yaw = t < 40 ? 0 : 0.8;
      setControls(s, { forward: true, sneak: true });
    },
  },
  {
    name: "step_slab_then_block",
    ticks: 90,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => {
      world.fill(-2, FLOOR, -3, 2, FLOOR, -5, st("oak_slab", { type: "bottom" }));
      world.fill(-2, FLOOR, -6, 2, FLOOR, -8, st("stone"));
      world.fill(-2, FLOOR + 1, -9, 2, FLOOR + 1, -12, st("stone"));
      world.fill(-2, FLOOR, -9, 2, FLOOR, -12, st("stone"));
    },
    controls: (t, s) => setControls(s, { forward: true, sprint: t > 10, jump: t > 40 && t < 70 }),
  },
  {
    name: "ceiling_bonk",
    ticks: 70,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => world.fill(-3, FLOOR + 2, -8, 3, FLOOR + 2, 3, st("stone")),
    controls: (_t, s) => setControls(s, { forward: true, sprint: true, jump: true }),
  },
  {
    name: "fall_land",
    ticks: 70,
    start: [0.5, FLOOR + 18, 0.5],
    yaw: 1.1,
    controls: (t, s) => setControls(s, { forward: t > 20 }),
  },
  {
    name: "low_gap_crouch",
    ticks: 70,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => world.fill(-2, FLOOR + 1, -3, 2, FLOOR + 1, -10, st("oak_slab", { type: "top" })),
    controls: (t, s) => setControls(s, { forward: true, sneak: t > 8 && t < 20 }),
  },
  {
    name: "ice_slide",
    ticks: 80,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => {
      world.fill(-2, FLOOR - 1, -20, 2, FLOOR - 1, 2, st("packed_ice"));
      world.fill(-2, FLOOR - 1, -30, 2, FLOOR - 1, -21, st("blue_ice"));
    },
    controls: (t, s) => setControls(s, { forward: t < 40, sprint: t < 40, jump: t > 20 && t < 35 }),
  },
  {
    name: "soul_sand_honey",
    ticks: 80,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => {
      world.fill(-2, FLOOR - 1, -2, 2, FLOOR - 1, -6, st("soul_sand"));
      world.fill(-2, FLOOR - 1, -7, 2, FLOOR - 1, -12, st("honey_block"));
      world.fill(-2, FLOOR - 1, -13, 2, FLOOR - 1, -16, st("slime_block"));
    },
    controls: (_t, s) => setControls(s, { forward: true, sprint: true, jump: true }),
  },
  {
    name: "slime_bounce",
    ticks: 80,
    start: [0.5, FLOOR + 12, 0.5],
    build: ({ world, st }) => world.fill(-3, FLOOR - 1, -3, 3, FLOOR - 1, 3, st("slime_block")),
    controls: (t, s) => setControls(s, { forward: t > 50 }),
  },
  {
    name: "ladder_climb",
    ticks: 80,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => {
      world.fill(-1, FLOOR, -2, 1, FLOOR + 8, -2, st("stone"));
      world.fill(0, FLOOR, -1, 0, FLOOR + 8, -1, st("ladder", { facing: "south" }));
    },
    controls: (t, s) => setControls(s, { forward: t < 50, jump: t > 5 && t < 30, sneak: t >= 30 && t < 40 }),
  },
  {
    name: "cobweb_berry_snow",
    ticks: 80,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => {
      world.fill(0, FLOOR, -2, 0, FLOOR + 1, -3, st("cobweb"));
      world.set(0, FLOOR, -5, st("sweet_berry_bush", { age: 3 }));
      world.fill(0, FLOOR, -7, 0, FLOOR, -8, st("powder_snow"));
    },
    controls: (_t, s) => setControls(s, { forward: true, sprint: true }),
  },
  {
    name: "stairs_up",
    ticks: 70,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => {
      for (let i = 0; i < 6; i++) {
        world.fill(-1, FLOOR + i, -2 - i, 1, FLOOR + i, -2 - i, st("oak_stairs", { facing: "north", half: "bottom" }));
        world.fill(-1, FLOOR, -3 - i, 1, FLOOR + i, -3 - i, st("stone"));
      }
    },
    controls: (t, s) => setControls(s, { forward: true, sprint: t > 20 }),
  },
  {
    name: "fence_corner",
    ticks: 60,
    start: [0.5, FLOOR, 0.5],
    yaw: Math.PI / 4,
    build: ({ world, st }) => {
      world.fill(-4, FLOOR, -4, 0, FLOOR, -4, st("oak_fence", { east: true, west: true }));
      world.fill(-4, FLOOR, -4, -4, FLOOR, 0, st("oak_fence", { north: true, south: true }));
    },
    controls: (t, s) => setControls(s, { forward: true, sprint: true, jump: t > 30 }),
  },
  {
    name: "water_swim",
    ticks: 120,
    start: [0.5, FLOOR - 2, 0.5],
    build: ({ world, st }) => {
      world.fill(-4, FLOOR - 4, -12, 4, FLOOR - 1, 4, st("water", { level: 0 }));
      world.fill(-4, FLOOR - 5, -12, 4, FLOOR - 5, 4, st("stone"));
      // flowing edge
      for (let i = 1; i <= 7; i++) world.set(0, FLOOR, -12 + i, st("water", { level: i }));
      world.set(1, FLOOR - 1, -3, st("seagrass"));
      world.set(-1, FLOOR - 2, -5, st("oak_slab", { type: "bottom", waterlogged: true }));
    },
    controls: (t, s) => {
      s.pitch = t < 60 ? -0.3 : 0.4;
      setControls(s, { forward: true, sprint: t > 10 && t < 90, jump: t > 70, sneak: t > 100 });
    },
  },
  {
    name: "water_wade_out",
    ticks: 90,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => {
      world.fill(-3, FLOOR, -6, 3, FLOOR, 3, st("water", { level: 0 }));
      world.fill(-3, FLOOR - 1, -6, 3, FLOOR - 1, 3, st("stone"));
      world.fill(-3, FLOOR, -7, 3, FLOOR, -9, st("stone"));
    },
    controls: (t, s) => setControls(s, { forward: true, jump: t > 30 }),
  },
  {
    name: "lava_pool",
    ticks: 60,
    start: [0.5, FLOOR, 0.5],
    build: ({ world, st }) => {
      world.fill(-3, FLOOR - 1, -5, 3, FLOOR, 3, st("lava", { level: 0 }));
      world.fill(-3, FLOOR - 2, -5, 3, FLOOR - 2, 3, st("stone"));
    },
    controls: (t, s) => setControls(s, { forward: true, jump: t > 20 }),
  },
  {
    name: "bubble_column",
    ticks: 60,
    start: [0.5, FLOOR - 4, 0.5],
    build: ({ world, st }) => {
      world.fill(-2, FLOOR - 6, -2, 2, FLOOR - 1, 2, st("water", { level: 0 }));
      world.fill(0, FLOOR - 6, 0, 0, FLOOR - 1, 0, st("bubble_column", { drag: false }));
      world.set(0, FLOOR - 7, 0, st("soul_sand"));
    },
    controls: () => undefined,
  },
  {
    name: "speed_effect_attrs",
    ticks: 60,
    start: [0.5, FLOOR, 0.5],
    setup: (s, mcData) => {
      // what servers send: base value plus a sprint modifier that must be replaced.
      s.attributes["minecraft:movement_speed"] = {
        value: 0.10000000149011612,
        modifiers: [{ uuid: "662a6b8d-da3e-4c1c-8813-96ea6097278d", amount: 0.30000001192092896, operation: 2 }],
      } as PlayerState["attributes"][string];
      const effects: PlayerState["effects"] = [];
      effects[mcData.effectsByName.Speed.id] = { id: mcData.effectsByName.Speed.id, amplifier: 1, duration: 1000 };
      effects[mcData.effectsByName.JumpBoost.id] = { id: mcData.effectsByName.JumpBoost.id, amplifier: 0, duration: 1000 };
      s.effects = effects;
      s.jumpBoost = 1;
    },
    controls: (t, s) => setControls(s, { forward: true, sprint: t > 10, jump: t > 30 }),
  },
];

export type TickRecord = (number | boolean | string | null)[];
export type ScenarioTrace = { version: string; scenario: string; ticks: TickRecord[] } | { version: string; scenario: string; skipped: string };

export const traceVersions = ["1.21.11", "1.21.4", "1.20.4", "1.18.2"];

export function recordTick(state: PlayerState): TickRecord {
  const sbp = state.supportingBlockPos;
  return [
    state.pos.x,
    state.pos.y,
    state.pos.z,
    state.vel.x,
    state.vel.y,
    state.vel.z,
    state.onGround,
    state.isCollidedHorizontally,
    state.isCollidedHorizontallyMinor,
    state.isCollidedVertically,
    state.isInWater,
    state.isUnderWater,
    state.isInLava,
    state.sprinting,
    state.crouching,
    state.swimming,
    state.pose,
    state.onClimbable,
    state.jumpTicks,
    sbp == null ? null : `${sbp.x},${sbp.y},${sbp.z}`,
  ];
}

const blockClassCache = new Map<string, typeof PBlock>();

function blockClass(version: string) {
  let B = blockClassCache.get(version);
  if (!B) {
    B = block(version) as typeof PBlock;
    blockClassCache.set(version, B);
  }
  return B;
}

export type PreparedScenario = {
  name: string;
  world: StateIdWorld;
  /** fresh rig in the scenario's start state */
  makeRig: () => ReturnType<typeof createBotcraftPlayerRig>;
  ticks: number;
  controls: Scenario["controls"];
};

export function prepareScenario(version: string, scenario: Scenario): PreparedScenario {
  const { mcData } = loadMcData(version);
  const Block = blockClass(version);
  const st: BlockHelper = (name, props = {}) => {
    const info = mcData.blocksByName[name];
    if (!info) throw new Error(`missing block ${name}`);
    // start from the block's default state so unspecified properties (e.g. waterlogged) are vanilla defaults.
    const strProps: Record<string, string> = {};
    const defaults = info.defaultState != null ? Block.fromStateId(info.defaultState, 0).getProperties() : {};
    for (const [k, v] of Object.entries({ ...defaults, ...props })) strProps[k] = String(v);
    return Block.fromProperties(name, strProps, 0).stateId!;
  };
  const floorY = scenario.floorY ?? FLOOR;
  const world = new StateIdWorld(Block, floorY, st(scenario.floorBlock ?? "stone"), st("air"));
  scenario.build?.({ world, st });

  const makeRig = () => {
    const rig = createBotcraftPlayerRig({
      version,
      position: new Vec3(...scenario.start),
      groundLevel: scenario.start[1] === FLOOR ? FLOOR : -1000,
    });
    // PlayerState's default prevControl is a module-level object that the engine mutates,
    // so give each run its own to keep scenarios independent of run order.
    rig.playerState.prevControl = ControlStateHandler.DEFAULT();
    rig.playerState.yaw = scenario.yaw ?? 0;
    rig.playerState.pitch = scenario.pitch ?? 0;
    scenario.setup?.(rig.playerState, mcData);
    return rig;
  };

  return { name: scenario.name, world, makeRig, ticks: scenario.ticks, controls: scenario.controls };
}

export type WorldMode = "getBlock" | "stateId";
export type SimWorld = Parameters<BotcraftPhysics["simulate"]>[1];

export function runScenario(prepared: PreparedScenario, mode: WorldMode): TickRecord[] {
  const rig = prepared.makeRig();
  const world: SimWorld = mode === "stateId" ? prepared.world : prepared.world.blockOnly();
  const out: TickRecord[] = [];
  for (let t = 0; t < prepared.ticks; t++) {
    prepared.controls(t, rig.playerState);
    rig.physics.simulate(rig.playerCtx, world);
    out.push(recordTick(rig.playerState));
  }
  const speedAttr = rig.playerState.attributes[rig.physics.movementSpeedAttribute];
  out.push(["attr", speedAttr == null ? null : JSON.stringify(speedAttr)]);
  return out;
}

export function recordAllTraces(mode: WorldMode = "getBlock"): ScenarioTrace[] {
  const traces: ScenarioTrace[] = [];
  for (const version of traceVersions) {
    for (const scenario of scenarios) {
      let prepared: PreparedScenario;
      try {
        prepared = prepareScenario(version, scenario);
      } catch (e) {
        traces.push({ version, scenario: scenario.name, skipped: (e as Error).message });
        continue;
      }
      traces.push({ version, scenario: scenario.name, ticks: runScenario(prepared, mode) });
    }
  }
  return traces;
}

export type TraceDigest = { version: string; scenario: string; ticks: number; sha256: string; last: TickRecord } | { version: string; scenario: string; skipped: string };

export function hashTrace(ticks: TickRecord[]) {
  return createHash("sha256").update(JSON.stringify(ticks)).digest("hex");
}

export function digestTraces(traces: ScenarioTrace[]): TraceDigest[] {
  return traces.map((t) => {
    if ("skipped" in t) return t;
    return { version: t.version, scenario: t.scenario, ticks: t.ticks.length, sha256: hashTrace(t.ticks), last: t.ticks[t.ticks.length - 2] };
  });
}
