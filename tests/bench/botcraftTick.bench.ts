/**
 * Micro-benchmark for BotcraftPhysics.simulate, one player tick at a time.
 *
 *   npx ts-node --transpile-only tests/bench/botcraftTick.bench.ts [version] [--rounds N]
 *
 * Runs every scenario from botcraftScenarios against both world shapes:
 * - getBlock: `{ getBlock }` only, what mineflayer's physics plugin passes
 * - stateId:  a world that also exposes `getBlockStateId` (like prismarine-world)
 *
 * Reports the median µs per tick over several rounds (after warm-up), and the
 * cold cost of the very first 200 ticks in a fresh process.
 */
import { performance } from "perf_hooks";
import { ControlStateHandler } from "../../src/physics/player";
import { PlayerState } from "../../src/physics/states/playerState";
import { PreparedScenario, SimWorld, WorldMode, prepareScenario, scenarios } from "../helpers/unit/botcraftScenarios";

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--") && /^\d/.test(a)) ?? "1.21.11";
const roundsIdx = args.indexOf("--rounds");
const rounds = roundsIdx !== -1 ? Number(args[roundsIdx + 1]) : 7;

const prepared = scenarios.map((s) => prepareScenario(version, s));

type Run = {
  rig: ReturnType<PreparedScenario["makeRig"]>;
  world: SimWorld;
  p: PreparedScenario;
  initial: PlayerState;
  attributes: string;
};

// one rig per scenario, reset between runs, so the heap stays quiet while timing.
function makeRun(p: PreparedScenario, mode: WorldMode): Run {
  const rig = p.makeRig();
  return {
    rig,
    world: mode === "stateId" ? p.world : p.world.blockOnly(),
    p,
    initial: rig.playerState.clone(),
    attributes: JSON.stringify(rig.playerState.attributes),
  };
}

function reset(run: Run) {
  const state = run.rig.playerState;
  state.merge(run.initial);
  state.attributes = JSON.parse(run.attributes);
  state.control = ControlStateHandler.DEFAULT();
  state.prevControl = ControlStateHandler.DEFAULT();
}

function runTicks({ rig, world, p }: Run) {
  for (let t = 0; t < p.ticks; t++) {
    p.controls(t, rig.playerState);
    rig.physics.simulate(rig.playerCtx, world);
  }
  return p.ticks;
}

// one rig, the first 200 ticks this process ever simulates.
function cold() {
  const p = prepared[1]; // sprint_jump
  const rig = p.makeRig();
  const world = p.world.blockOnly();
  const start = performance.now();
  for (let t = 0; t < 200; t++) {
    p.controls(t, rig.playerState);
    rig.physics.simulate(rig.playerCtx, world);
  }
  return performance.now() - start;
}

function timeReps(run: Run, reps: number) {
  let ms = 0;
  let ticks = 0;
  for (let i = 0; i < reps; i++) {
    reset(run);
    const start = performance.now();
    ticks += runTicks(run);
    ms += performance.now() - start;
  }
  return { ms, ticks };
}

function bench(p: PreparedScenario, mode: WorldMode) {
  const run = makeRun(p, mode);
  // aim for ~40ms per round
  let reps = 1;
  while (timeReps(run, reps).ms < 40) reps *= 2;
  const samples: number[] = [];
  for (let r = 0; r < rounds; r++) {
    const { ms, ticks } = timeReps(run, reps);
    samples.push((ms * 1000) / ticks);
  }
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1];
}

const coldMs = cold();
const bun = (globalThis as { Bun?: { version: string } }).Bun;
const runtime = bun ? `bun ${bun.version}` : `node ${process.version}`;
console.log(`BotcraftPhysics tick benchmark: mc ${version}, ${runtime}`);
console.log(`cold: first 200 ticks took ${coldMs.toFixed(1)} ms (${((coldMs * 1000) / 200).toFixed(1)} µs/tick)`);
console.log(`${"scenario".padEnd(24)}${"getBlock µs".padStart(13)}${"stateId µs".padStart(13)}`);

const totals: Record<WorldMode, number[]> = { getBlock: [], stateId: [] };
for (const p of prepared) {
  const a = bench(p, "getBlock");
  const b = bench(p, "stateId");
  totals.getBlock.push(a);
  totals.stateId.push(b);
  console.log(`${p.name.padEnd(24)}${a.toFixed(2).padStart(13)}${b.toFixed(2).padStart(13)}`);
}
const geo = (xs: number[]) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length);
console.log(`${"geomean".padEnd(24)}${geo(totals.getBlock).toFixed(2).padStart(13)}${geo(totals.stateId).toFixed(2).padStart(13)}`);
