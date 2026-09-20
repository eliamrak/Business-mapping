#!/bin/bash
set -e
pnpm install --frozen-lockfile
printf '%s\n' 'Dependencies ready. Database changes require the reviewed numbered migrations; no automatic schema push was run.'
