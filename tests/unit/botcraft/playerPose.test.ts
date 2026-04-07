import { describe, it } from "mocha";
import expect from "expect";
import { PlayerPoses, playerPoseCtx } from "../../../src/physics/states/poses";

describe("Botcraft player poses", () => {
  it("uses vanilla player pose dimensions for fall-flying and crouching", () => {
    expect(playerPoseCtx[PlayerPoses.FALL_FLYING]).toEqual({ width: 0.6, height: 0.6 });
    expect(playerPoseCtx[PlayerPoses.SNEAKING]).toEqual({ width: 0.6, height: 1.5 });
  });
});
