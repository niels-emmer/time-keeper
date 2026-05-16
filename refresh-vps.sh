#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$ROOT_DIR"

git pull --ff-only --tags

APP_VERSION="$(git describe --tags --abbrev=0)"
export APP_VERSION

echo "Using APP_VERSION=$APP_VERSION"

docker compose up -d --build frontend backend

echo "VPS refresh complete."