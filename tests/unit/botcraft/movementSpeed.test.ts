import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";
import * as attributes from "../../../src/physics/info/attributes";

const version = "1.21.11";
// Player movement speed base 0.1F, sprint modifier 0.3F (ADD_MULTIPLIED_TOTAL), then (float).
const WALK_SPEED = Math.fround(0.1);
const SPRINT_SPEED = Math.fround(Math.fround(0.1) * (1 + Math.fround(0.3)));

describe("Botcraft movement speed attribute", () => {
  it("keeps vanilla's float32 sprint speed when sprinting starts and stops", () => {
    const { physics, playerCtx, playerState } = createBotcraftPlayerRig({ version, position: new Vec3(0.5, 0, 0.5) });
    const world = createFlatWorld(version, 0) as any;
    playerState.control.forward = true;

    // sprint on, off, on again: each change goes through setSprinting
    for (const sprint of [true, false, true]) {
      playerState.control.sprint = sprint;
      for (let tick = 0; tick < 3; tick++) physics.simulate(playerCtx, world);
      expect(playerState.sprinting).toBe(sprint);
      expect(physics.getMovementSpeedAttribute(playerCtx)).toBe(sprint ? SPRINT_SPEED : WALK_SPEED);
    }
    expect(SPRINT_SPEED).toBe(0.1300000101327896);
  });

  it("does not modify the state's attributes (they are shared with the bot)", () => {
    const { physics, playerCtx, playerState } = createBotcraftPlayerRig({ version, position: new Vec3(0.5, 0, 0.5) });
    const world = createFlatWorld(version, 0) as any;
    const serverAttributes = {
      [physics.movementSpeedAttribute]: {
        value: 0.10000000149011612,
        modifiers: [{ uuid: "minecraft:effect.speed", amount: 0.4000000059604645, operation: 2 }],
      },
    };
    const snapshot = JSON.stringify(serverAttributes);
    playerState.attributes = serverAttributes;
    playerState.control.forward = true;
    for (const sprint of [true, false, true]) {
      playerState.control.sprint = sprint;
      for (let tick = 0; tick < 3; tick++) physics.simulate(playerCtx, world);
    }
    expect(playerState.attributes).toBe(serverAttributes);
    expect(JSON.stringify(serverAttributes)).toBe(snapshot);
  });
});

describe("attribute helpers", () => {
  it("applies multiply-total modifiers as value * (1 + amount)", () => {
    // y += y * a would give 0.12000000000000001 here
    expect(attributes.getAttributeValue({ value: 0.1, modifiers: [{ uuid: "a", amount: 0.2, operation: 2 }] })).toBe(0.1 * (1 + 0.2));
  });

  it("deletes only the matching modifier", () => {
    const attr = {
      value: 1,
      modifiers: [
        { uuid: "a", amount: 1, operation: 0 },
        { uuid: "b", amount: 2, operation: 0 },
        { uuid: "c", amount: 3, operation: 0 },
        { uuid: "b", amount: 4, operation: 0 },
      ],
    };
    attributes.deleteAttributeModifier(attr, "b");
    expect(attr.modifiers.map((m) => m.uuid)).toEqual(["a", "c"]);
  });
});
