import { describe, it } from "mocha";
import expect from "expect";
import fixture from "../../fixtures/botcraftTickTraces.json";
import {
  TraceDigest,
  WorldMode,
  hashTrace,
  prepareScenario,
  runScenario,
  scenarios,
} from "../../helpers/unit/botcraftScenarios";

// Recorded per-tick player state for a fixed set of movement scenarios.
// Any change here means the simulation results changed; if that is intended,
// re-record with `npx ts-node tests/bench/recordBotcraftTraces.ts`.
const digests = fixture as TraceDigest[];
const modes: WorldMode[] = ["getBlock", "stateId"];

describe("Botcraft tick traces", () => {
  for (const digest of digests) {
    if ("skipped" in digest) continue;
    const scenario = scenarios.find((s) => s.name === digest.scenario);
    if (scenario == null) throw new Error(`unknown scenario ${digest.scenario}`);

    for (const mode of modes) {
      it(`${digest.version} ${digest.scenario} (${mode} world) matches the recorded trace`, () => {
        const ticks = runScenario(prepareScenario(digest.version, scenario), mode);
        expect(ticks.length).toBe(digest.ticks);
        expect(ticks[ticks.length - 2]).toEqual(digest.last);
        expect(hashTrace(ticks)).toBe(digest.sha256);
      });
    }
  }
});
