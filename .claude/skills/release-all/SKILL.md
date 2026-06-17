---
name: release-all
description: Release any of {filigree, doodles, clouddiagram} that has unreleased commits past its last published tag, propagate the new versions to downstream consumers, and finish with an axonize dep bump + install. Use when the user asks to "release everything", "publish all", "ship the changes", "release-all", "deploy libs", or similar after working across these repos.
---

# release-all

End-to-end release for the whole `@benkalegin/*` stack. One command bumps, builds, tests, commits, tags, pushes, publishes, and rolls the new versions through downstream consumers.

## Dependency order

```
filigree  →  doodles  →  clouddiagram  →  axonize
(packages)   (packages)   (editor)       (consumer only — no publish)
```

The script walks this order. For each upstream repo, it:
1. Checks if HEAD is past the last published tag — if not, **skips** that repo.
2. Bumps version in every `package.json` under the repo.
3. Bumps any upstream deps just released earlier in the run (e.g. doodles' `@benkalegin/filigree-api` if filigree got a new version this run).
4. Installs, builds, tests.
5. Commits + tags (`vX.Y.Z` for filigree/doodles, `editor-vX.Y.Z` for clouddiagram) + pushes.
6. Publishes packages to GH Packages using `gh auth token` as `NODE_AUTH_TOKEN`.

After all publishers run, axonize gets the new dep versions, `pnpm install`, and a commit + push.

## When to invoke

User says any of:
- "release everything" / "release all"
- "publish doodles + cd"
- "ship the changes"
- "deploy the libs"

If the user mentions a single specific lib (e.g. "publish doodles"), still use this skill — it auto-detects and only releases what needs it.

## How to invoke

```bash
~/.claude/skills/release-all/release.sh patch    # most common
~/.claude/skills/release-all/release.sh minor
~/.claude/skills/release-all/release.sh major
```

Bump level applies to every repo that gets released. If the user wants different bump levels per repo, run the script multiple times or do it manually.

### Optional environment

- `PUSH_REMOTES=0 ~/.claude/skills/release-all/release.sh patch` — does everything locally (versions, commits, tags) but skips `git push` and `pnpm publish`. Useful for review before going live.

## Prerequisites — verified automatically

The script aborts at the top if any of these fail. Surface the message to the user and stop.

1. **`gh` CLI authed** with `write:packages` scope. If missing:
   ```
   gh auth refresh -s write:packages
   ```
2. **Working trees clean** in all four repos. The only tolerated dirty files are `package.json` and `pnpm-lock.yaml` (the script will overwrite them anyway). Any other modification means the user has in-progress work — stop and ask them to commit, stash, or revert.

## NODE_AUTH_TOKEN

Each repo's `.npmrc` references `${NODE_AUTH_TOKEN}` for both publish and install (because `@benkalegin/*` lives on `npm.pkg.github.com`, not the public registry). The script supplies it via `gh auth token` on every `pnpm install` and `pnpm publish` call. **Never ask the user for a token** — `gh auth token` produces one whenever the user is logged in.

## Failure modes

- **Tests fail mid-release**: the script aborts after the version bump but before commit. Revert with `cd <repo> && git restore package.json packages/*/package.json` (and `pnpm-lock.yaml` if pnpm install ran).
- **`pnpm publish` returns 409 (version exists)**: someone (or a previous interrupted run) already published that version. Bump again with a higher level, or set the version explicitly by editing `package.json`s.
- **Consumer install fails after publish**: usually a registry propagation delay (a just-published upstream isn't resolvable yet). The script now auto-retries each install up to `INSTALL_RETRIES` times with `INSTALL_RETRY_DELAY`s between attempts (`install_with_retry`), so a transient lag no longer aborts the cascade. If it still fails after all retries, the publish genuinely didn't land — check `gh` auth / the package page.

## Do NOT use this skill for

- Releases of `ui26` — separate repo, not yet wired into this script.
- Major refactors that need a coordinated multi-repo PR — those want manual review, not auto-release.
- The clouddiagram repo when it has unrelated in-progress edits (the user's frequent state). The preflight catches this; tell the user to commit or stash.
