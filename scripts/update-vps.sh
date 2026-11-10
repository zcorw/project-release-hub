#!/usr/bin/env bash
# Run manually on a Linux VPS. This script never logs in, pulls Git, or publishes.
set -Eeuo pipefail
exec python3 "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)/update-vps.py" "$@"
