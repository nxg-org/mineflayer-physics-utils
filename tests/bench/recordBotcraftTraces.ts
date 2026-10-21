/**
 * Re-records tests/fixtures/botcraftTickTraces.json from the current BotcraftPhysics.
 * Only run this when a change to the physics results is intended.
 *
 *   npx ts-node tests/bench/recordBotcraftTraces.ts [--full <file>]
 *
 * `--full` additionally writes every recorded tick, for diffing two engines tick by tick.
 */
import { writeFileSync } from "fs";
import { join } from "path";
import { digestTraces, recordAllTraces } from "../helpers/unit/botcraftScenarios";

const out = join(__dirname, "../fixtures/botcraftTickTraces.json");
const traces = recordAllTraces("getBlock");
writeFileSync(out, JSON.stringify(digestTraces(traces), null, 1) + "\n");

const fullIdx = process.argv.indexOf("--full");
if (fullIdx !== -1) writeFileSync(process.argv[fullIdx + 1], JSON.stringify(traces) + "\n");

const skipped = traces.filter((t) => "skipped" in t);
console.log(`wrote ${traces.length - skipped.length} trace digests to ${out}`);
for (const s of skipped) console.log(`skipped ${s.version} ${s.scenario}: ${"skipped" in s ? s.skipped : ""}`);
