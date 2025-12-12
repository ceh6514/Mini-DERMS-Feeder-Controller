# Operations, Observability, and Resilience Runbooks

## Structured logging
- **Logger**: The backend now emits JSON logs via `pino`, with optional pretty output controlled by `LOG_PRETTY`. Use `LOG_LEVEL` to tighten noise in staging/production (e.g., `info` or `warn`).
- **Context**: Logs include the service name; MQTT handlers and startup paths annotate events with structured fields for broker host/port and errors.
- **Shipping**: In containers, redirect stdout to your log collector (e.g., `docker logs` -> Fluent Bit/Loki). For Kubernetes, attach a label/annotation for log scraping on the backend Deployment.

## Metrics and alerting
- **Prometheus endpoint**: Enabled by default at `${PROMETHEUS_PATH:-/metrics}` without authentication so platform scrapers can reach it. Disable with `PROMETHEUS_ENABLED=false` if needed.
- **Health metrics**: Gauges reported: `derms_db_up`, `derms_mqtt_up`, `derms_control_loop_ok`, `derms_control_loop_offline_devices` plus Node.js default process metrics.
- **Alert suggestions**:
  - DB down: `derms_db_up == 0` for 2m.
  - MQTT down: `derms_mqtt_up == 0` for 2m or flaps >3 times in 10m.
  - Control loop stalled: `derms_control_loop_ok == 0` for 3m.
  - Offline devices: `derms_control_loop_offline_devices > 0` with feeder labels from the health API.
- **Dashboards**: Add panels for control-loop uptime and MQTT connectivity trend; track restart counts through container restarts.

## PostgreSQL backup/retention
- **Backups**: Nightly `pg_dump` to object storage with 30-day retention; perform weekly base backup (e.g., `pg_basebackup`) if WAL archiving is enabled.
- **Restore drill**: Quarterly restore into staging using the latest backup to validate credentials and schema; rehearse app boot against restored data.
- **Retention**: Keep at least 7 daily and 4 weekly snapshots. Encrypt at rest using bucket policies and KMS keys.
- **Automation**: Use a CronJob in Kubernetes (see `deploy/k8s/prod/derms.yaml` example hook) or a scheduled GitHub Action in simpler setups.
- **Verification**: After each backup job, run `pg_restore --list` to verify archive readability and emit a metric/log event consumed by alerting.

## PostgreSQL failover and recovery
- **Primary/replica**: Run a streaming replica (Patroni, repmgr, or managed Postgres). Configure application `DB_HOST` to a VIP/HAProxy/pgbouncer that follows the primary.
- **Failure drill**: Force failover in staging monthly; confirm the app reconnects and metrics show `derms_db_up` returning to 1.
- **Config hints**: Use synchronous_commit=on for prod if latency budget allows. Keep connection pooling at the proxy layer to avoid stampedes during failover.

## MQTT backup and failover
- **Broker redundancy**: Run an active/standby Mosquitto pair or managed MQTT service. Point clients to a DNS record that can be failed over (short TTL) or to an HAProxy/TCP LB.
- **Persistence**: Enable `persistence true` with a dedicated volume for retained sessions. Nightly copy the persistence store with `mosquitto_db_dump` and retain for 7-14 days.
- **Recovery**: In outages, fail DNS/LB to the standby broker, then restart the backend so it reconnects cleanly. Validate `derms_mqtt_up` returns to 1 and offline device count drops.
- **Agent guidance**: For physical Pi agents, preconfigure a secondary broker hostname and lower keepalive intervals to detect failure quickly.

## Control-loop health runbook
- **Detection**: Alerts derive from `derms_control_loop_ok` and offline device counts. Also watch the `/api/health` endpoint for `status: degraded`.
- **Initial triage**:
  1) Check DB metrics and `derms_db_up`.
  2) Check broker reachability (`derms_mqtt_up`) and Mosquitto logs.
  3) Inspect structured logs around the control loop for exceptions.
  4) Restart the backend pod if the loop is stuck; confirm metrics recover.
- **Escalation**: If repeated stalls happen, profile queries in `src/controllers/controlLoop.ts` and validate MQTT message volume/burstiness.

## Secrets and configuration
- **Source of truth**: `.env`/Kubernetes Secrets should define JWT secret, DB password, MQTT credentials, and TLS key/cert paths. The example env file now favors non-default secrets for non-local use.
- **Rotation**: Rotate JWT and DB passwords quarterly. Restart pods to pick up new secrets. Use different secrets between staging/prod.
- **Mounting**: In Kubernetes manifests, secrets are mounted as files for TLS keys and injected as environment variables for app settings.
- **Guardrails**: Run `npm run lint:env` to ensure `.env.example` never regresses to weak defaults before publishing or committing changes.

## Dashboard/API security
- **TLS termination**: Prefer terminating TLS at an ingress/load balancer with automatic certificate renewal. When terminating in the pod, set `TLS_ENABLED=true` and mount the key/cert secret paths referenced in `.env.example`.
- **JWT secret rotation**: Create a new secret in your vault, update the deployment environment variables, and restart pods during a planned window; reject or reissue tokens signed with the old secret if centralized logout is required.
- **Credential injection**: Provide `AUTH_USERS` via your secret manager rather than checked-in files; enforce 12+ character, mixed-complexity passwords and rotate user entries every 90 days.

## TLS and HTTPS
- **App TLS**: Enable `TLS_ENABLED=true` with `TLS_KEY_PATH` and `TLS_CERT_PATH` pointing to mounted secrets. Use an Ingress with cert-manager for automated issuance/renewal.
- **MQTT TLS**: For broker hardening, generate a server cert and configure Mosquitto `cafile`/`certfile`/`keyfile`; mandate TLS on port 8883 for production clients.
- **Client enforcement**: Pin `MQTT_HOST` to the TLS endpoint and set clients to require TLS with certificate validation enabled.

## Deployment environments
- **Staging**: Single-replica backend, Mosquitto, and Postgres with PVCs; Prometheus scraping enabled; TLS via self-signed or staging ACME issuer.
- **Production**: At least two backend replicas behind a LoadBalancer/Ingress, managed Postgres or HA pair, MQTT with failover, and daily backups wired to alerting.
- **Manifests**: See `deploy/k8s/staging/derms.yaml` and `deploy/k8s/prod/derms.yaml` for reference Kubernetes deployments, secrets, and ingress.
