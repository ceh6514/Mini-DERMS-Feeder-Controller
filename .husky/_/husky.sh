#!/usr/bin/env sh
# shellcheck shell=sh

if [ "$HUSKY" = "0" ]; then
  exit 0
fi

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

if ! command_exists sh; then
  echo "husky - shell not found"
  exit 1
fi
