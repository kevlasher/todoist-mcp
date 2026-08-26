#!/usr/bin/env bash
# PostToolUse hook (Edit|Write). Runs the full test suite whenever an edit
# touches src/ or test/, and blocks (exit 2) with the failure output fed
# back to Claude if the suite fails, per CLAUDE.md's TDD requirement.
set -euo pipefail

INPUT="$(cat)"
FILE_PATH="$(printf '%s' "$INPUT" | node -e '
let d = "";
process.stdin.on("data", c => d += c);
process.stdin.on("end", () => {
  try {
    process.stdout.write(JSON.parse(d).tool_input?.file_path || "");
  } catch {
    process.stdout.write("");
  }
});
')"

[ -z "$FILE_PATH" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

case "$FILE_PATH" in
  "$PROJECT_DIR"/src/*|"$PROJECT_DIR"/test/*) ;;
  *) exit 0 ;;
esac

cd "$PROJECT_DIR"

if ! TEST_OUTPUT="$(npm test 2>&1)"; then
  printf '%s\n' "$TEST_OUTPUT" >&2
  echo "npm test FAILED after edit to ${FILE_PATH#"$PROJECT_DIR"/}" >&2
  exit 2
fi

exit 0
