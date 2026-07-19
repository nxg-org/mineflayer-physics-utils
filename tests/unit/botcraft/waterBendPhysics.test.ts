import { describe, it } from "mocha";
import expect from "expect";
import { Vec3 } from "vec3";
import { createBotcraftPlayerRig, createFlatWorld } from "../../helpers/unit/botcraftTestSupport";

const versions = ["1.18.2", "1.21.11"];
const playerHalfWidth = Math.fround(0.6) / 2;

const waterPath = [
  new Vec3(0, 0, 0),
  new Vec3(1, 0, 0),
  new Vec3(2, 0, 0),
  new Vec3(3, 0, 0),
  new Vec3(4, 0, 0),
  new Vec3(4, 0, 1),
  new Vec3(4, 0, 2),
  new Vec3(4, 0, 3),
];

const loggedWaterPath = [
  new Vec3(-14, -60, 6),
  new Vec3(-15, -60, 6),
  new Vec3(-16, -60, 6),
  new Vec3(-17, -60, 6),
  new Vec3(-17, -60, 5),
  new Vec3(-17, -60, 4),
  new Vec3(-17, -60, 3),
  new Vec3(-17, -60, 2),
];

const horizontalOffsets = [
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];

function createWaterBendRig(version: string) {
  const rig = createBotcraftPlayerRig({
    version,
    position: new Vec3(0.5, 0, 0.5),
    groundLevel: 0,
  });
  const world = createFlatWorld(version, -100);
  const blocks = rig.mcData.blocksByName;

  // Continuous packed-ice foundation. Water occupies Y=0 and glass walls occupy
  // Y=0..1, so the 1.8-block-tall player is enclosed without a ceiling.
  for (let x = -1; x <= 5; x++) {
    for (let z = -1; z <= 4; z++) {
      world.setOverrideBlock(new Vec3(x, -1, z), blocks.packed_ice.id);
    }
  }

  for (let y = 0; y <= 1; y++) {
    // Incoming leg runs east through z=0. Its north wall is continuous, while
    // the south wall ends before x=4 to leave the bend exit open.
    for (let x = -1; x <= 4; x++) {
      world.setOverrideBlock(new Vec3(x, y, -1), blocks.glass.id);
    }
    for (let x = -1; x <= 3; x++) {
      world.setOverrideBlock(new Vec3(x, y, 1), blocks.glass.id);
    }
    world.setOverrideBlock(new Vec3(-1, y, 0), blocks.glass.id);

    // Outgoing leg runs south through x=4. The x=5 wall is the outer wall that
    // the diagonal corner current pushes against. The x=3 wall includes the
    // inner-corner block at (3, y, 1), preventing a diagonal shortcut.
    for (let z = 0; z <= 4; z++) {
      world.setOverrideBlock(new Vec3(5, y, z), blocks.glass.id);
    }
    for (let z = 1; z <= 4; z++) {
      world.setOverrideBlock(new Vec3(3, y, z), blocks.glass.id);
    }
  }

  // One source followed by vanilla's seven decreasing fluid heights. Metadata
  // increases by one for every horizontal block of Manhattan distance, including
  // across the turn: levels 0..4 eastward, then levels 5..7 southward.
  waterPath.forEach((position, metadata) => {
    world.setOverrideBlock(position, blocks.water.id, metadata);
  });

  return { ...rig, world };
}

function createLoggedWaterBendRig(version: string) {
  const rig = createBotcraftPlayerRig({
    version,
    position: new Vec3(-16.7, -60, 6.7),
    groundLevel: -60,
  });
  const world = createFlatWorld(version, -100);
  const blocks = rig.mcData.blocksByName;
  const key = (position: Vec3) => `${position.x},${position.y},${position.z}`;
  const waterPositions = new Set(loggedWaterPath.map(key));
  const wallPositions = new Map<string, Vec3>();

  // Infer the one-wide glass channel visible in the report: every horizontal
  // neighbor outside the water path is a wall, except beyond the final L7 cell.
  for (const waterPosition of loggedWaterPath) {
    for (const offset of horizontalOffsets) {
      const wallPosition = waterPosition.plus(offset);
      if (!waterPositions.has(key(wallPosition))) {
        wallPositions.set(key(wallPosition), wallPosition);
      }
    }
  }
  const openEnd = new Vec3(-17, -60, 1);
  wallPositions.delete(key(openEnd));

  for (const position of [...loggedWaterPath, ...wallPositions.values(), openEnd]) {
    world.setOverrideBlock(position.offset(0, -1, 0), blocks.grass_block.id);
  }
  for (const position of wallPositions.values()) {
    world.setOverrideBlock(position, blocks.glass.id);
    world.setOverrideBlock(position.offset(0, 1, 0), blocks.glass.id);
  }
  loggedWaterPath.forEach((position, metadata) => {
    world.setOverrideBlock(position, blocks.water.id, metadata);
  });

  rig.playerState.vel.set(0, 0, 0);
  return { ...rig, world };
}

describe("Botcraft right-angle water channel", () => {
  for (const version of versions) {
    describe(version, () => {
      it("has the intended water levels, glass corner, and flow vectors", () => {
        const { physics, world } = createWaterBendRig(version);

        expect(waterPath.map((position) => {
          const block = world.getBlock(position)!;
          return { position: block.position, name: block.name, metadata: block.metadata };
        })).toEqual(waterPath.map((position, metadata) => ({ position, name: "water", metadata })));

        // These four cells define a closed inner corner, a closed outer corner,
        // and the two open water cells through which the player must turn.
        expect(world.getBlock(new Vec3(3, 0, 1))!.name).toBe("glass");
        expect(world.getBlock(new Vec3(5, 0, 0))!.name).toBe("glass");
        expect(world.getBlock(new Vec3(4, 0, 0))!.name).toBe("water");
        expect(world.getBlock(new Vec3(4, 0, 1))!.name).toBe("water");

        const expectedFlows = [
          new Vec3(1, 0, 0),
          new Vec3(1, 0, 0),
          new Vec3(1, 0, 0),
          new Vec3(1, 0, 0),
          new Vec3(1 / Math.sqrt(2), 0, 1 / Math.sqrt(2)),
          new Vec3(0, 0, 1),
          new Vec3(0, 0, 1),
          new Vec3(0, 0, 1),
        ];

        waterPath.forEach((position, index) => {
          const flow = physics.getFlow(world.getBlock(position)!, world);
          expect(flow.x).toBeCloseTo(expectedFlows[index].x, 12);
          expect(flow.y).toBeCloseTo(expectedFlows[index].y, 12);
          expect(flow.z).toBeCloseTo(expectedFlows[index].z, 12);
        });
      });

      it("slides along the outer wall and reliably rounds the bend while idle", () => {
        const { physics, playerCtx, playerState, world } = createWaterBendRig(version);
        let firstCollisionZ: number | null = null;
        let lastCollisionZ: number | null = null;
        let zVelocityBeforeCollision: number | null = null;
        let zVelocityAfterCollision: number | null = null;

        for (let tick = 0; tick < 400 && playerState.pos.z <= 3; tick++) {
          const previousZVelocity = playerState.vel.z;
          physics.simulate(playerCtx, world);

          if (playerState.isCollidedHorizontally) {
            if (firstCollisionZ == null) {
              firstCollisionZ = playerState.pos.z;
              zVelocityBeforeCollision = previousZVelocity;
              zVelocityAfterCollision = playerState.vel.z;
            }
            lastCollisionZ = playerState.pos.z;
          }
        }

        // A 0.6F-wide player contacting the x=5 outer wall stops one half-width away.
        // Requiring contact ensures this test exercises wall sliding, not a wide path.
        expect(firstCollisionZ).not.toBeNull();
        expect(playerState.pos.x).toBeCloseTo(5 - playerHalfWidth, 12);

        // The downstream component must survive while the wall clips the +X component.
        expect(lastCollisionZ! - firstCollisionZ!).toBeGreaterThan(0.25);
        expect(zVelocityAfterCollision!).toBeGreaterThanOrEqual(zVelocityBeforeCollision!);

        // z>3 places the player's center well inside the outgoing leg, beyond the bend.
        expect(playerState.pos.z).toBeGreaterThan(3);
      });

      it("continues north from the reported L3 corner position while touching glass", () => {
        const { physics, playerCtx, playerState, world } = createLoggedWaterBendRig(version);
        const corner = world.getBlock(new Vec3(-17, -60, 6))!;
        const outgoing = world.getBlock(new Vec3(-17, -60, 5))!;

        expect({
          cornerMetadata: corner.metadata,
          cornerFlow: physics.getFlow(corner, world),
          outgoingMetadata: outgoing.metadata,
          outgoingFlow: physics.getFlow(outgoing, world),
          northMetadata: world.getBlock(new Vec3(-17, -60, 4))!.metadata,
          southMetadata: world.getBlock(new Vec3(-17, -60, 6))!.metadata,
        }).toEqual({
          cornerMetadata: 3,
          cornerFlow: new Vec3(-1 / Math.sqrt(2), 0, -1 / Math.sqrt(2)),
          outgoingMetadata: 4,
          outgoingFlow: new Vec3(0, 0, -1),
          northMetadata: 5,
          southMetadata: 3,
        });

        const start = playerState.pos.clone();
        let collisionTicks = 0;
        for (let tick = 0; tick < 20; tick++) {
          physics.simulate(playerCtx, world);
          if (playerState.isCollidedHorizontally) collisionTicks++;
        }

        // While the AABB overlaps L3 and L4, L3 presses west into the outer wall.
        // The northward component must move the player fully into L4, after which
        // its straight north current no longer produces a horizontal collision.
        expect(collisionTicks).toBeGreaterThan(0);
        expect(playerState.pos.x).toBeCloseTo(-17 + playerHalfWidth, 12);
        expect(playerState.pos.z).toBeLessThan(start.z - 0.8);
      });
    });
  }
});
