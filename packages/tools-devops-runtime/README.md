# @helmsman/tools-devops-runtime

Container-isolated Git/SSH runtime tools for Helmsman.

## Security model

- Runs commands only via Docker containers (never host shell execution).
- Injects credentials as temporary files mounted read-only.
- Applies default-deny egress (`--network none`) unless explicit allowlist is provided.
- Redacts secrets from stdout/stderr before returning or logging.

## Runtime image

```bash
docker build -f packages/tools-devops-runtime/docker/Dockerfile.runtime \
  -t helmsman-runtime:latest \
  packages/tools-devops-runtime/docker
```

## Local setup

1. Create a local env file from `.env.example`.
2. Set `DOCKER_SOCKET_PATH`:
   - Linux/macOS: `/var/run/docker.sock`
   - Windows Docker Desktop: `npipe:////./pipe/docker_engine`
3. Keep `HELMSMAN_ENFORCE_EGRESS_ALLOWLIST=false` for unit tests.
4. Enable `HELMSMAN_ENFORCE_EGRESS_ALLOWLIST=true` only when you have real allowlist enforcement in place.

## Testing

```bash
bun test packages/tools-devops-runtime/tests
```

### Recommended validation sequence

```bash
bun test packages/tools-devops-runtime/tests
bun test packages/tools-github/tests
bun run check-types
```

### Runtime smoke checks

- Verify runtime image exists: `docker images | grep helmsman-runtime`
- Run one command without egress allowlist (should use `--network none` path)
- Run one command with egress allowlist and `HELMSMAN_ENFORCE_EGRESS_ALLOWLIST=true`
- Confirm secrets are redacted in tool output and audit metadata never includes raw values
