## Fall-flying landing friction investigation

### Ruled-out hypothesis

Using `lastOnGround` in the normal movement friction branch without refreshing that field inside the in-memory simulation loop does not fix the Grim landing mismatch.

### Evidence

- Target test:
  `source ~/.nvm/nvm.sh && npx mocha --require ts-node/register tests/botcraftJumpCooldown.test.ts --grep "matches Grim's unique predicted movement through the glide landing"`
- Result after the first patch:
  `/gl 223: expected z=0.14972322502492966, got z=0.0814331854076098`
- The value was unchanged from before the patch.

### Why that attempt failed

`BotcraftPhysics.simulate()` mutates the existing `PlayerState` directly each tick. In the test harness, the state is not reloaded from `bot.entity` before the next `simulate()` call, so a `lastOnGround` field populated only by `PlayerState.update()` stays stale during the loop.

### Next step

Refresh previous-ground-state inside the physics tick itself before movement decisions are made.
