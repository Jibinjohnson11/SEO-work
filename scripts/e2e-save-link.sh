#!/bin/bash
# Backup for the staging real-email E2E tests (e2e/support/email-links.ts): saves the LinkOps link
# you copied from the Resend dashboard into the waiting test's private folder.
#
#   1. Copy the email button's link address.   2. TYPE (do not copy/paste) in Terminal:
#        ./scripts/e2e-save-link.sh
#
# Copying this command would replace the link on the clipboard, so type it. The link is checked for
# the http://localhost:3100/auth/confirm address, written with owner-only permissions, never printed,
# and the clipboard is cleared afterwards.
set -euo pipefail
umask 077
shopt -s nullglob
waiting=("${TMPDIR:-/tmp}"/linkops-e2e-links-*/WAITING)
if [ ${#waiting[@]} -ne 1 ]; then
  echo "No LinkOps test is waiting for a link (found ${#waiting[@]}). Start the test first." >&2
  exit 1
fi
dir=$(dirname "${waiting[0]}")
label=$(head -n 1 "${waiting[0]}")
[[ "$label" =~ ^[a-z0-9-]+$ ]] || { echo "Unexpected waiting label; nothing saved." >&2; exit 1; }
link=$(pbpaste | tr -d '\r\n')
link=${link//&amp;/&}
case "$link" in
  http://localhost:3100/auth/confirm\?*token_hash=*) ;;
  *)
    echo "The clipboard does not hold a http://localhost:3100/auth/confirm link (${#link} characters)." >&2
    echo "Right-click the email button → Copy Link Address, then type this command again." >&2
    exit 1
    ;;
esac
printf '%s\n' "$link" > "$dir/$label.url"
printf '' | pbcopy
echo "Saved the link for '$label' (${#link} characters); clipboard cleared. The test will check it before use."
