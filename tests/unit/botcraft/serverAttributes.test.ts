import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig } from "../../helpers/unit/botcraftTestSupport";
import { attributeNamesTrusted } from "../../../src/physics/engines/botcraft";

const version = "1.21.11";
const BASE = 0.10000000149011612; // 0.1F, as the server sends it
const SPEED_II = 0.4000000059604645; // minecraft:effect.speed, amplifier 1

function rig() {
  const r = createBotcraftPlayerRig({ version, position: new Vec3(0.5, 0, 0.5) });
  // the repo's minecraft-data may still have the shifted 1.21.11 mapping; these
  // tests are about key resolution, not about that guard
  (r.physics as any).useServerAttributes = true;
  return r;
}

describe("Botcraft server attributes", () => {
  it("finds attributes under mineflayer's packet names", () => {
    const { physics, playerCtx, playerState } = rig();
    for (const key of ["generic.movement_speed", "minecraft:generic.movement_speed", "minecraft:movement_speed", "generic.movementSpeed"]) {
      playerState.attributes = { [key]: { value: 0.2, modifiers: [] } };
      expect(physics.getMovementSpeedAttribute(playerCtx)).toBe(Math.fround(0.2));
    }
    playerState.attributes = { "player.sneaking_speed": { value: 0.5, modifiers: [] } };
    expect(physics.getStateAttributeValue(playerState, "sneakingSpeed")).toBe(0.5);
  });

  it("uses the server's effect modifiers instead of adding its own", () => {
    const { physics, playerCtx, playerState, mcData } = rig();
    playerState.effects = { [mcData.effectsByName.Speed.id]: { id: mcData.effectsByName.Speed.id, amplifier: 1, duration: 100 } } as any;
    playerState.attributes = {
      "generic.movement_speed": { value: BASE, modifiers: [{ uuid: "minecraft:effect.speed", amount: SPEED_II, operation: 2 }] },
    };
    playerState.sprinting = false;
    expect(physics.getMovementSpeedAttribute(playerCtx)).toBe(Math.fround(BASE * (1 + SPEED_II)));
    playerState.sprinting = true;
    expect(physics.getMovementSpeedAttribute(playerCtx)).toBe(Math.fround(BASE * (1 + SPEED_II) * (1 + Math.fround(0.3))));
  });

  it("replaces a sprint modifier sent by the server with its own", () => {
    const { physics, playerCtx, playerState } = rig();
    playerState.attributes = {
      "generic.movement_speed": { value: BASE, modifiers: [{ uuid: "minecraft:sprinting", amount: Math.fround(0.3), operation: 2 }] },
    };
    playerState.sprinting = false;
    expect(physics.getMovementSpeedAttribute(playerCtx)).toBe(Math.fround(BASE));
    playerState.sprinting = true;
    expect(physics.getMovementSpeedAttribute(playerCtx)).toBe(Math.fround(BASE * (1 + Math.fround(0.3))));
  });

  it("ignores server attributes when told the names can't be trusted", () => {
    const { physics, playerCtx, playerState } = rig();
    (physics as any).useServerAttributes = false;
    playerState.attributes = { "generic.movement_speed": { value: 0, modifiers: [] } };
    expect(physics.getMovementSpeedAttribute(playerCtx)).toBe(Math.fround(0.1));
    // the engine's own key is still used
    playerState.attributes = { [physics.movementSpeedAttribute]: { value: 0.2, modifiers: [] } };
    expect(physics.getMovementSpeedAttribute(playerCtx)).toBe(Math.fround(0.2));
  });
});

describe("attributeNamesTrusted", () => {
  const withMapping = (n: number, attributes: number) =>
    ({
      protocol: {
        play: {
          toClient: {
            types: {
              packet_entity_update_attributes: [
                "container",
                [{ name: "key", type: ["mapper", { type: "varint", mappings: Object.fromEntries([...Array(n).keys()].map((i) => [String(i), `a${i}`])) }] }],
              ],
            },
          },
        },
      },
      attributesArray: new Array(attributes).fill({}),
    }) as any;

  it("rejects an id mapping with fewer names than the version has attributes", () => {
    expect(attributeNamesTrusted(withMapping(31, 35))).toBe(false);
    expect(attributeNamesTrusted(withMapping(35, 35))).toBe(true);
  });

  it("trusts string attribute keys (before 1.20.5)", () => {
    expect(attributeNamesTrusted({ protocol: { play: { toClient: { types: { packet_entity_update_attributes: ["container", [{ name: "key", type: "string" }]] } } } }, attributesArray: [] } as any)).toBe(true);
  });
});
