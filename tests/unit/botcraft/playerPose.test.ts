import { describe, it } from "mocha";
import expect from "expect";
import { PlayerPoses, playerPoseCtx } from "../../../src/physics/states/poses";

describe("Botcraft player poses", () => {
  it("uses vanilla player pose dimensions for fall-flying and crouching", () => {
    expect(playerPoseCtx[PlayerPoses.FALL_FLYING]).toEqual({ width: Math.fround(0.6), height: Math.fround(0.6) });
    expect(playerPoseCtx[PlayerPoses.SNEAKING]).toEqual({ width: Math.fround(0.6), height: Math.fround(1.5) });
  });

  it("stops at a full-block face using Java float precision", () => {
    const halfWidth = playerPoseCtx[PlayerPoses.STANDING].width / 2;
    const contactX = -51 - halfWidth;

    expect(contactX).toBe(-51.30000001192093);
    expect(contactX + halfWidth).toBe(-51);
  });
});
