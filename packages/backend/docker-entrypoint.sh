#!/bin/sh
# Read version from file extracted at build time and run the app
export APP_VERSION=$(cat /app/VERSION)
exec node packages/backend/dist/index.js "$@"
