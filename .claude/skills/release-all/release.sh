#!/usr/bin/env bash
# release-all.sh — release any of {filigree, doodles, clouddiagram} that has
# unreleased commits past its last published tag, propagate dep bumps to
# downstream consumers, and finish with an axonize dep bump + install.
#
# Order matches the dep graph: filigree → doodles → clouddiagram → axonize.
# Each repo is only released if its HEAD is ahead of the last vX.Y.Z tag.
#
# Usage:
#   release-all.sh patch   # patch each repo that needs release
#   release-all.sh minor
#   release-all.sh major
#
# Env:
#   PUSH_REMOTES=0  # skip git push + npm publish (dry-run that still mutates locally)

set -euo pipefail

# ── config ────────────────────────────────────────────────────────────────────

REPOS_ORDER=(filigree doodles clouddiagram)

declare -A REPO_DIR=(
  [filigree]="$HOME/repos/github/filigree"
  [doodles]="$HOME/repos/github/doodles"
  [clouddiagram]="$HOME/repos/github/clouddiagram"
)

# Where to read the current version from
declare -A VERSION_FROM=(
  [filigree]="packages/api/package.json"
  [doodles]="packages/doodles-core/package.json"
  [clouddiagram]="package.json"
)

# Git tag prefix per repo (clouddiagram uses editor-vX.Y.Z, others vX.Y.Z)
declare -A TAG_PREFIX=(
  [filigree]="v"
  [doodles]="v"
  [clouddiagram]="editor-v"
)

# Glob of package.json files to bump within a repo
declare -A PKG_GLOB=(
  [filigree]="packages/*/package.json"
  [doodles]="packages/*/package.json"
  [clouddiagram]="package.json"
)

# pnpm publish filter (empty = publish root pkg)
declare -A PUBLISH_FILTER=(
  [filigree]="./packages/*"
  [doodles]="./packages/*"
  [clouddiagram]=""
)

# Public name consumers reference (key for downstream dep bumps)
declare -A PUBLIC_NAME=(
  [filigree]="@benkalegin/filigree-api"
  [doodles]="@benkalegin/doodles-api"
  [clouddiagram]="@benkalegin/clouddiagram-editor"
)

AXONIZE_DIR="$HOME/repos/github/axonize"

# ── args ──────────────────────────────────────────────────────────────────────

BUMP="${1:-}"
case "$BUMP" in
  patch|minor|major) ;;
  *) echo "usage: $0 patch|minor|major"; exit 2 ;;
esac

# ── preflight ─────────────────────────────────────────────────────────────────

command -v gh >/dev/null || { echo "✗ gh CLI required"; exit 1; }
command -v pnpm >/dev/null || { echo "✗ pnpm required"; exit 1; }

if ! gh auth status 2>&1 | grep -q "write:packages"; then
  echo "✗ gh token lacks write:packages scope. Run: gh auth refresh -s write:packages"
  exit 1
fi

# Trees must be clean. Tolerate only package.json / pnpm-lock.yaml staged.
for repo in "${REPOS_ORDER[@]}" axonize; do
  d="${REPO_DIR[$repo]:-$AXONIZE_DIR}"
  cd "$d"
  dirty=$(git status --porcelain | awk '$2 !~ /^(package\.json|pnpm-lock\.yaml)$/ && !/^\?\? /' || true)
  if [ -n "$dirty" ]; then
    echo "✗ $repo has uncommitted non-package changes (commit, stash, or revert first):"
    git status --short | sed 's/^/    /'
    exit 1
  fi
done

PUSH=${PUSH_REMOTES:-1}

# ── helpers ───────────────────────────────────────────────────────────────────

bump_version() {
  local cur="$1" mode="$2"
  node -e "
    const v = '$cur'.split('.').map(Number);
    if ('$mode' === 'patch') v[2]++;
    else if ('$mode' === 'minor') { v[1]++; v[2]=0; }
    else { v[0]++; v[1]=0; v[2]=0; }
    process.stdout.write(v.join('.'));
  "
}

current_version() {
  local repo="$1"
  cd "${REPO_DIR[$repo]}"
  node -p "require('./${VERSION_FROM[$repo]}').version"
}

# Returns 0 if HEAD is ahead of the version tag (=> needs release), 1 otherwise.
needs_release() {
  local repo="$1"
  cd "${REPO_DIR[$repo]}"
  local cur
  cur=$(current_version "$repo")
  local tag="${TAG_PREFIX[$repo]}$cur"
  if ! git rev-parse "$tag" >/dev/null 2>&1; then
    return 0  # no tag yet → treat as needing release
  fi
  local ahead
  ahead=$(git rev-list --count "$tag..HEAD" 2>/dev/null || echo 0)
  [ "$ahead" -gt 0 ]
}

# ── main ──────────────────────────────────────────────────────────────────────

declare -A RELEASED

for repo in "${REPOS_ORDER[@]}"; do
  cd "${REPO_DIR[$repo]}"
  cur=$(current_version "$repo")

  # Skip if no commits past last tag AND no upstream we just released changed deps in this repo.
  upstream_released=0
  for u in "${REPOS_ORDER[@]}"; do
    [ "$u" = "$repo" ] && break
    if [ -n "${RELEASED[$u]:-}" ] && grep -q "\"${PUBLIC_NAME[$u]}\"" "${VERSION_FROM[$repo]%/*}"/*/package.json package.json 2>/dev/null; then
      upstream_released=1
    fi
  done

  if ! needs_release "$repo" && [ "$upstream_released" -eq 0 ]; then
    echo "─ $repo $cur · clean (no commits past tag, no upstream changes) — skip"
    continue
  fi

  next=$(bump_version "$cur" "$BUMP")
  echo "━━━ $repo $cur → $next ━━━"

  # 1. Bump versions in this repo's packages
  for f in ${PKG_GLOB[$repo]}; do
    sed -i '' "s/\"version\": \"$cur\"/\"version\": \"$next\"/" "$f"
  done

  # 2. Bump deps on any upstream we just released
  for u in "${REPOS_ORDER[@]}"; do
    [ "$u" = "$repo" ] && break
    up_v="${RELEASED[$u]:-}"
    [ -z "$up_v" ] && continue
    up_name="${PUBLIC_NAME[$u]}"
    while IFS= read -r f; do
      sed -i '' "s|\"$up_name\": \"\^[0-9.]\{1,\}\"|\"$up_name\": \"^$up_v\"|" "$f"
    done < <(find . -name "package.json" -not -path "*/node_modules/*" -not -path "*/dist/*")
    echo "  ↳ bumped $up_name → ^$up_v"
  done

  # 3. Install (needs token for our scoped registry)
  NODE_AUTH_TOKEN="$(gh auth token)" pnpm install 2>&1 | tail -3

  # 4. Build + test
  pnpm -r build 2>&1 | tail -3
  if grep -q '"test"' package.json; then
    pnpm test 2>&1 | tail -5
  fi

  # 5. Commit + tag
  git add -A
  git commit -m "$next"
  tag="${TAG_PREFIX[$repo]}$next"
  git tag "$tag"

  # 6. Push + publish
  if [ "$PUSH" = "1" ]; then
    git push origin HEAD "$tag"
    filter="${PUBLISH_FILTER[$repo]}"
    if [ -n "$filter" ]; then
      NODE_AUTH_TOKEN="$(gh auth token)" \
        pnpm -r --filter "$filter" publish --no-git-checks --access public 2>&1 | grep -E "^\+ @benkalegin|error" || true
    else
      NODE_AUTH_TOKEN="$(gh auth token)" \
        pnpm publish --no-git-checks --access public 2>&1 | grep -E "^\+ @benkalegin|error" || true
    fi
  else
    echo "  (PUSH_REMOTES=0 — skipping git push + pnpm publish)"
  fi

  RELEASED[$repo]=$next
done

# ── axonize: dep bumps + install + commit ─────────────────────────────────────

if [ ${#RELEASED[@]} -eq 0 ]; then
  echo "nothing to release."
  exit 0
fi

cd "$AXONIZE_DIR"
bumped=()
for repo in "${!RELEASED[@]}"; do
  pkg="${PUBLIC_NAME[$repo]}"
  v="${RELEASED[$repo]}"
  if grep -q "\"$pkg\"" package.json; then
    sed -i '' "s|\"$pkg\": \"\^[0-9.]\{1,\}\"|\"$pkg\": \"^$v\"|" package.json
    bumped+=("${pkg##*/}@$v")
  fi
done

if [ ${#bumped[@]} -gt 0 ]; then
  echo "━━━ axonize: bumping ${bumped[*]} ━━━"
  NODE_AUTH_TOKEN="$(gh auth token)" pnpm install 2>&1 | tail -3
  git add package.json pnpm-lock.yaml
  git commit -m "Bump deps: ${bumped[*]}"
  [ "$PUSH" = "1" ] && git push
fi

echo ""
echo "✓ release-all done:"
for r in "${!RELEASED[@]}"; do
  echo "    $r → ${RELEASED[$r]}"
done
[ ${#bumped[@]} -gt 0 ] && echo "    axonize → bumped ${bumped[*]}"
