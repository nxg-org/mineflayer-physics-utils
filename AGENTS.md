# AGENTS

## Environment

- Workspace root: `/home/genpc/github_stuff/mineflayer-physics-utils`
- Shell: `zsh`
- `node` is available after sourcing `nvm`

## NVM / Node

Run this before any `node`, `npm`, or `npx` command:

```sh
source ~/.nvm/nvm.sh
```

After that, `node` should be on `PATH`.

## Research References

The research reference directory is:

```text
/home/genpc/github_stuff/mineflayer-physics-utils/research_refs
```

Useful subtrees include:

- Vanilla extracted client code:
  `/home/genpc/github_stuff/mineflayer-physics-utils/research_refs/extracted_minecraft_data_client1_21_4_rc3`
- Grim source:
  `/home/genpc/github_stuff/mineflayer-physics-utils/research_refs/Grim_head`

## Physics Change Requirements

- If you change the physics implementation, you must find the corresponding vanilla code for that behavior and reference it in your work.
- Use the vanilla extracted client code under `research_refs/extracted_minecraft_data_client1_21_4_rc3` unless there is a clear reason to use a different vanilla source.
- If the physics change is related to anticheat reasoning, add code comments that explain the anticheat reasoning and why the implementation matches the relevant behavior.

## Linked Mineflayer Checkout

The linked mineflayer repository is outside this workspace at:

```text
/home/genpc/github_stuff/mineflayer
```

The mineflayer physics plugin folder is:

```text
/home/genpc/github_stuff/mineflayer/lib/plugins
```

The main file commonly edited for movement packet logic is:

```text
/home/genpc/github_stuff/mineflayer/lib/plugins/physics.js
```

## Common Commands

Run tests in this repo:

```sh
source ~/.nvm/nvm.sh
npx mocha --require ts-node/register tests/botcraftJumpCooldown.test.ts
```

Syntax-check the linked mineflayer physics plugin:

```sh
source ~/.nvm/nvm.sh
node -c /home/genpc/github_stuff/mineflayer/lib/plugins/physics.js
```
