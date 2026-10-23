import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

// Output of the real 1.21.11 client classes (Vec2, Mth) run through
// KeyboardInput.tick's normalization and LocalPlayer.modifyInput, as raw float
// bits: [forward, back, left, right, usingItem, movingSlowly, xxa bits, zza bits].
const GOLDEN_1_21_11: number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 1, 1, 0, 0],
  [1, 0, 0, 0, 0, 0, 0, 1065017672],
  [1, 0, 0, 0, 1, 0, 0, 1044952122],
  [1, 0, 0, 0, 0, 1, 0, 1050052396],
  [1, 0, 0, 0, 1, 1, 0, 1030805574],
  [0, 1, 0, 0, 0, 0, 0, -1082465976],
  [0, 1, 0, 0, 1, 0, 0, -1102531526],
  [0, 1, 0, 0, 0, 1, 0, -1097431252],
  [0, 1, 0, 0, 1, 1, 0, -1116678074],
  [1, 1, 0, 0, 0, 0, 0, 0],
  [1, 1, 0, 0, 1, 0, 0, 0],
  [1, 1, 0, 0, 0, 1, 0, 0],
  [1, 1, 0, 0, 1, 1, 0, 0],
  [0, 0, 1, 0, 0, 0, 1065017672, 0],
  [0, 0, 1, 0, 1, 0, 1044952122, 0],
  [0, 0, 1, 0, 0, 1, 1050052396, 0],
  [0, 0, 1, 0, 1, 1, 1030805574, 0],
  [1, 0, 1, 0, 0, 0, 1060439282, 1060439282],
  [1, 0, 1, 0, 1, 0, 1044952122, 1044952122],
  [1, 0, 1, 0, 0, 1, 1050052396, 1050052396],
  [1, 0, 1, 0, 1, 1, 1030805573, 1030805573],
  [0, 1, 1, 0, 0, 0, 1060439282, -1087044366],
  [0, 1, 1, 0, 1, 0, 1044952122, -1102531526],
  [0, 1, 1, 0, 0, 1, 1050052396, -1097431252],
  [0, 1, 1, 0, 1, 1, 1030805573, -1116678075],
  [1, 1, 1, 0, 0, 0, 1065017672, 0],
  [1, 1, 1, 0, 1, 0, 1044952122, 0],
  [1, 1, 1, 0, 0, 1, 1050052396, 0],
  [1, 1, 1, 0, 1, 1, 1030805574, 0],
  [0, 0, 0, 1, 0, 0, -1082465976, 0],
  [0, 0, 0, 1, 1, 0, -1102531526, 0],
  [0, 0, 0, 1, 0, 1, -1097431252, 0],
  [0, 0, 0, 1, 1, 1, -1116678074, 0],
  [1, 0, 0, 1, 0, 0, -1087044366, 1060439282],
  [1, 0, 0, 1, 1, 0, -1102531526, 1044952122],
  [1, 0, 0, 1, 0, 1, -1097431252, 1050052396],
  [1, 0, 0, 1, 1, 1, -1116678075, 1030805573],
  [0, 1, 0, 1, 0, 0, -1087044366, -1087044366],
  [0, 1, 0, 1, 1, 0, -1102531526, -1102531526],
  [0, 1, 0, 1, 0, 1, -1097431252, -1097431252],
  [0, 1, 0, 1, 1, 1, -1116678075, -1116678075],
  [1, 1, 0, 1, 0, 0, -1082465976, 0],
  [1, 1, 0, 1, 1, 0, -1102531526, 0],
  [1, 1, 0, 1, 0, 1, -1097431252, 0],
  [1, 1, 0, 1, 1, 1, -1116678074, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 1, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 0, 1, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [1, 0, 1, 1, 0, 0, 0, 1065017672],
  [1, 0, 1, 1, 1, 0, 0, 1044952122],
  [1, 0, 1, 1, 0, 1, 0, 1050052396],
  [1, 0, 1, 1, 1, 1, 0, 1030805574],
  [0, 1, 1, 1, 0, 0, 0, -1082465976],
  [0, 1, 1, 1, 1, 0, 0, -1102531526],
  [0, 1, 1, 1, 0, 1, 0, -1097431252],
  [0, 1, 1, 1, 1, 1, 0, -1116678074],
  [1, 1, 1, 1, 0, 0, 0, 0],
  [1, 1, 1, 1, 1, 0, 0, 0],
  [1, 1, 1, 1, 0, 1, 0, 0],
  [1, 1, 1, 1, 1, 1, 0, 0],
];

function floatBits(value: number) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value);
  return view.getInt32(0);
}

function headingAfterTick(version: string, keys: { forward?: boolean; back?: boolean; left?: boolean; right?: boolean; sprint?: boolean }, usingItem: boolean) {
  const rig = createBotcraftPlayerRig({ version, position: new Vec3(0.5, 0, 0.5) });
  const world = createFlatWorld(version, 0) as any;
  Object.assign(rig.playerState.control, keys);
  rig.playerState.isUsingItem = usingItem;
  rig.physics.simulate(rig.playerCtx, world);
  return rig;
}

describe("Botcraft movement input", () => {
  it("matches the 1.21.11 client's input bit for bit", () => {
    const { physics, playerState } = createBotcraftPlayerRig({ version: "1.21.11", position: new Vec3(0.5, 0, 0.5) });
    for (const [fw, bk, lf, rt, item, slow, xBits, yBits] of GOLDEN_1_21_11) {
      const heading = { forward: fw - bk, strafe: lf - rt };
      playerState.isUsingItem = item === 1;
      (physics as any).modifyInput(playerState, heading, slow === 1 ? 0.3 : null);
      expect([floatBits(heading.strafe), floatBits(heading.forward)]).toEqual([xBits, yBits]);
    }
  });

  for (const version of ["1.12.2", "1.21.4", "1.21.11"]) {
    it(`slows the input, not the acceleration, while using an item (${version})`, () => {
      // vanilla scales the input before any normalization, so a diagonal stays
      // sqrt(2) times as fast as walking straight
      const straight = headingAfterTick(version, { forward: true }, true).playerState.vel;
      const diagonal = headingAfterTick(version, { forward: true, left: true }, true).playerState.vel;
      expect(Math.hypot(diagonal.x, diagonal.z) / Math.hypot(straight.x, straight.z)).toBeCloseTo(Math.SQRT2, 6);
    });
  }

  it("still starts sprinting on a diagonal (1.21.11)", () => {
    const rig = headingAfterTick("1.21.11", { forward: true, left: true, sprint: true }, false);
    expect(rig.playerState.sprinting).toBe(true);
  });
});
