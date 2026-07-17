#!/usr/bin/env bash
# check_no_seed_ref.sh — refuse any project script that calls scripts/seed.py.
#
# Failure pattern: a build/start/CI helper accidentally re-seeds the
# database at boot. Live data on a populated DB gets silently overwritten
# by the idempotent DEFAULT_* upsert in seed.py. See CLAUDE.md "不允许用
# seed.py / init_db.py 重置数据库" for context.
#
# Allow-list: only files that legitimately *mention* seed.py can stay.
# Anything else (hook, start script, npm script-equivalent, CI helper,
# supervisor stanza, etc.) that *invokes* `scripts/seed.py` (or
# `from scripts import seed`) fails the build.
#
# Exit codes:
#   0 = clean (no unauthorised seed invocation)
#   1 = found a violating file (output lists path + line)
#   2 = tooling error (e.g., grep/find missing)

set -u
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

# Files allowed to reference seed.py without flagging:
#   - the seed.py source itself (the script we are guarding)
#   - docs/ (design notes only)
#   - CLAUDE.md / README.md (rule statements, prose)
#   - this script and its sibling linter (the rule itself)
#   - backend/scripts/seed_*.py siblings (intentionally similar names)
#   - backend/tests/test_no_seed_invocation.py (the test that *checks* the rule)
#   - backend/scripts/init_db.py: paired destructive op; guarded by dual env vars
#   - backend/scripts/bootstrap_seed_once.py / render_start.sh:
#       Render-only empty-DB bootstrap wrapper; seeds only when core tables are empty
case "$(uname -s)" in
  Darwin) SED_E='-E'; FIND_NULL='/dev/null' ;;
  *)      SED_E='-r'; FIND_NULL='/dev/null' ;;
esac

allow_match() {
  case "$1" in
    backend/scripts/seed.py) return 0 ;;
    backend/scripts/seed_tags.py) return 0 ;;
    backend/scripts/seed_analytics_demo.py) return 0 ;;
    backend/scripts/seed_mock_small_models.py) return 0 ;;
    backend/scripts/seed_test_materials.py) return 0 ;;
    backend/scripts/bootstrap_seed_once.py) return 0 ;;
    backend/scripts/render_start.sh) return 0 ;;
    backend/scripts/check_no_seed_ref.sh) return 0 ;;
    backend/tests/test_no_seed_invocation.py) return 0 ;;
    backend/scripts/init_db.py) return 0 ;;
    README.md|CLAUDE.md) return 0 ;;
  esac
  case "$1" in
    docs/*) return 0 ;;
  esac
  return 1
}

# Patterns we treat as an "invocation" of seed.py. The point of this
# linter is to catch *executable* references — places that would actually
# trigger seed.py main() during build/startup/CI. Pure comments and
# doc references ("see scripts/seed.py for context") must NOT trip.
#
# Each pattern below describes an actual call/shell form:
#   - shell: python scripts/seed.py  |  bash scripts/seed.py  |  ./scripts/seed.py
#   - shell exec via env:
#       PYTHONPATH=. scripts/seed.py   RESEED_ALLOWED=YES scripts/seed.py ...
#   - python -m scripts.seed
#   - subprocess: subprocess.run(["python", "scripts/seed.py"...]) /
#                os.system("... scripts/seed.py")
#   - direct module invocation: from scripts import seed; seed.main() /
#                                import scripts.seed; scripts.seed.main()
#
# Plain text mentions ("must match scripts/seed.py DEFAULT_*"), comment
# lines starting with '#', and docstring prose are excluded by requiring
# either a path-position prefix (start of line, after "python ", or inside
# quotes/brackets) or the explicit module-call forms.
PATTERN='(^|[[:space:]"'\''\[])((python|bash|sh|exec)[[:space:]]+([^[:space:]]+[[:space:]]+)?)?scripts/seed\.py([[:space:]]|$)|python[[:space:]]+-m[[:space:]]+scripts\.seed([[:space:]]|$)|subprocess\.(run|call|Popen|check_output)[[:space:]]*\([^)]*scripts[/.]seed|from[[:space:]]+scripts[[:space:]]+import[[:space:]]+seed\b|import[[:space:]]+scripts\.seed\b|scripts\.seed\.main\b'

# Look at shell scripts, python scripts, CI yml/json/toml, npm scripts,
# systemd/supervisor configs. Skip git internals and node_modules.
TMP_FILES="$(mktemp -t check_no_seed.XXXXXX)"
trap 'rm -f "$TMP_FILES"' EXIT

find . \
  \( -path './.git'      -o -path './node_modules' -o -path '*/node_modules' \
     -o -path '*/__pycache__' \
     -o -path './.venv'   -o -path '*/.venv' \
     -o -path './dist'    -o -path './build' \) -prune -o \
  -type f \
  \( -name '*.sh' -o -name '*.py' -o -name '*.yml' -o -name '*.yaml' \
     -o -name '*.toml' -o -name '*.json' -o -name '*.conf' \
     -o -name '*.service' \) \
  -print > "$TMP_FILES" 2> "$FIND_NULL"

violations=0
report=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  rel="${f#./}"
  if allow_match "$rel"; then
    continue
  fi
  # Numbered hits like '  42:line content'. Strip pure-comment lines:
  #   - '  # ...'
  #   - '   # ...'
  # We deliberately keep docstring/rest lines that *executable* Python would
  # interpret as code. Pure comments are safe.
  hits="$(grep -nE "$PATTERN" "$f" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    # Use perl for portability (awk on macOS is BSD awk with limited regex).
    filtered_hits="$(printf '%s\n' "$hits" \
      | perl -ne '
          chomp;
          unless (/^(\d+):(.*)$/) { next; }
          my ($ln, $body) = ($1, $2);
          if ($body =~ /^\s*#/) { next; }   # pure comment
          print "$ln:$body";
        ')"
    if [ -n "$filtered_hits" ]; then
      while IFS= read -r hit; do
        [ -n "$hit" ] || continue
        report+="${rel}:${hit}"$'\n'
        violations=$((violations + 1))
      done <<EOF_HITS
$filtered_hits
EOF_HITS
    fi
  fi
done < "$TMP_FILES"

if [ "$violations" -gt 0 ]; then
  echo "✗ seed.py invocation forbidden by project policy (CLAUDE.md)." >&2
  echo "  The following files reference 'scripts/seed.py' (or import the module):" >&2
  echo "" >&2
  printf '%s' "$report" | sed 's/^/    /' >&2
  echo "" >&2
  echo "  Fix: remove the invocation. To re-seed safely on a live DB:" >&2
  echo "    RESEED_ALLOWED=YES python scripts/seed.py --allow-reseed" >&2
  echo "  (only on empty DBs, with explicit acknowledgement; see CLAUDE.md)." >&2
  exit 1
fi

echo "✓ no seed.py invocations outside the allow-list"
exit 0
