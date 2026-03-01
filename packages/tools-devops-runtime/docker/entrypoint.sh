#!/bin/bash
set -euo pipefail

if [ -n "${HELMSMAN_SSH_KEY_FILE:-}" ]; then
  mkdir -p ~/.ssh
  chmod 700 ~/.ssh
  cp "$HELMSMAN_SSH_KEY_FILE" ~/.ssh/helmsman_task_key
  chmod 600 ~/.ssh/helmsman_task_key

  if [ -n "${HELMSMAN_KNOWN_HOSTS_FILE:-}" ]; then
    cp "$HELMSMAN_KNOWN_HOSTS_FILE" ~/.ssh/known_hosts
    chmod 644 ~/.ssh/known_hosts
  elif [ -n "${HELMSMAN_SSH_HOST:-}" ]; then
    echo "ERROR: HELMSMAN_KNOWN_HOSTS_FILE is required when HELMSMAN_SSH_HOST is set." >&2
    exit 1
  fi

  export GIT_SSH_COMMAND="ssh -i ~/.ssh/helmsman_task_key -o BatchMode=yes -o StrictHostKeyChecking=yes"
fi

if [ -n "${HELMSMAN_GIT_TOKEN_FILE:-}" ]; then
  HELMSMAN_GIT_TOKEN="$(cat "$HELMSMAN_GIT_TOKEN_FILE")"
  git config --global credential.helper store
  echo "https://x-access-token:${HELMSMAN_GIT_TOKEN}@github.com" > ~/.git-credentials
  chmod 600 ~/.git-credentials
fi

git config --global init.defaultBranch main
git config --global safe.directory /workspace

exec "$@"
