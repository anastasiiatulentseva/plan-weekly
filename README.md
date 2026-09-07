# Plan by Week

A shared household calendar with week/month views, printing, recurring activities,
and live updates across devices. Astro/React runs as a Node service; PostgreSQL 18
stores all calendar data, including dates outside the three-month navigation window.

## Local development

Use Node 22.12 or later (the production image uses Node 22 Alpine) and PostgreSQL 18.

```sh
docker run -d --name planner-postgres \
  -e POSTGRES_USER=planner -e POSTGRES_PASSWORD=local-only \
  -e POSTGRES_DB=planner -p 127.0.0.1:5432:5432 \
  -v planner-postgres:/var/lib/postgresql postgres:18-alpine
npm ci
```

Copy `.env.example` to `.env` and replace the placeholders. Generate `INVITE_TOKEN`
and `SESSION_SECRET` independently with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Export the environment before running commands (the migration script reads process
environment variables). Never commit real secrets.

```sh
set -a
. ./.env
set +a
npm run db:migrate
npm run dev
```

Open `http://localhost:4321/#join=<your-invite-token>`. Keep `PUBLIC_ORIGIN` exactly
`http://localhost:4321` for this setup. Secure cookies work on Chromium's trusted
`localhost`; use local HTTPS when testing from another hostname or device. Production
must use `https://plans.tulentsev.com`. Astro's built-in sessions are disabled; this
application uses a signed cookie and has no filesystem session state.

`DATABASE_URL` is required by both migrations and the application. `PUBLIC_ORIGIN`,
`INVITE_TOKEN`, and `SESSION_SECRET` are required for authentication. Production also
sets `HOST=0.0.0.0` and `PORT=3000`. Do not expose PostgreSQL publicly in production.

## Behavior and synchronization

Every invitation holder can read and edit the entire household calendar and copy
the invite from settings. Leaving clears the browser's session. Rotating the invite
prevents new joins; rotating the session secret invalidates existing sessions.
Sessions expire after one year. Failed invitation exchanges are limited to ten per
minute across this single-instance service; forwarding headers cannot bypass that
limit. A proxy-level rate limit can be added if needed.

Calendar data from the former `plan-by-week:v1` browser storage is **not imported**.
After the first successful server load, only valid navigation preferences migrate
and the old key is deleted. Export anything needed from the old app before upgrading.

Scheduled copies retain their title, times, notes, color and assignments independently
of templates. Deleting a template keeps its scheduled copies. Deleting a person
removes assignments and advances the versions of affected activities. Editor changes
remain drafts until Save. A remote change preserves the draft and marks it stale;
Reload latest discards the draft, while Review and retry retains it and adopts the
latest version only after that explicit action. Save then submits the reviewed draft.

Weekly scheduling starts on the chosen day and stops at month end. Month cloning
uses weekday ordinal positions, preserves collisions, and **keeps recurrence IDs
linked across months**. Deleting this and future occurrences includes the selected
date and matching occurrences in later cloned months, including retained history
outside the visible window. A bulk deletion checks the selected occurrence's version
and locks the current series membership; it does not require versions for unseen
future occurrences. Separate clone commands intentionally produce separate copies.

Each command commits atomically and advances one calendar revision. Entity versions
are independent write preconditions. Bulk commands use idempotency keys stored with
their original results. Reusing a key for a different command fails. Idempotency records
are retained indefinitely; do not prune them without defining a retry-expiry policy.

SSE sends ready, revision and 15-second heartbeat events. Clients refetch on ready,
revision, reconnect and periodically for database-outage recovery. Editing is unavailable
offline; pending work is not queued for automatic submission. Run **one application
instance**: process-local events do not support horizontal scaling. Add shared fan-out
(for example PostgreSQL LISTEN/NOTIFY) before running multiple instances.

## Tests

```sh
npm test
docker exec planner-postgres createdb -U planner planner_e2e
export E2E_DATABASE_URL=postgres://planner:local-only@localhost:5432/planner_e2e
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
```

Both database test suites **drop the public and drizzle schemas** of the dedicated
test database. The URL is mandatory and its database name must end in `_e2e`.
Never point it at production. Browser tests run serially, launch the production
server on `localhost:4329`, and use synthetic secrets. An installed Chromium can be
selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium`.

## Image publication and Coolify

The workflow tests with PostgreSQL 18 and Chromium before publishing
`ghcr.io/anastasiiatulentseva/plan-weekly` for `linux/amd64` and `linux/arm64`.
It emits branch, release-tag and full `sha-<commit>` tags. Only the default branch
emits `latest`; only `refs/heads/main` calls the deployment webhook. Tag builds never
deploy production. Production dependencies and generated SQL migrations are included
in the image. Startup applies migrations before listening, using one migration
connection and an advisory lock to prevent overlapping startup migrations.

In Coolify, create a **Docker Image** application for
`ghcr.io/anastasiiatulentseva/plan-weekly:latest`. Configure GHCR pull authentication
there if the package is private. Attach `https://plans.tulentsev.com`, internal port
3000 and deployment health check `/readyz`. The image's own health check is `/healthz`.
Coolify owns HTTPS redirects, certificates and proxy routing. No application volume
is needed; run the image as its default unprivileged `node` user.

Attach a **PostgreSQL 18** resource and configure its internal `DATABASE_URL` plus
`PUBLIC_ORIGIN=https://plans.tulentsev.com`, both generated secrets, `HOST` and `PORT`.
Pin the database major independently of the application. PostgreSQL 18 Docker data
volumes mount at `/var/lib/postgresql`; follow the resource's upgrade procedure rather
than replacing an older major's image against its existing data directory.

Set repository secrets `COOLIFY_WEBHOOK` (the existing application deployment URL)
and `COOLIFY_TOKEN` (a token allowed to deploy that application). The deploy job fails
clearly when either is missing. Its only Coolify operation is a GET to that webhook,
with three retries and a bearer token. Response bodies are discarded. Do not enable
shell tracing, HTTP header/body logging, or proxy cookie logging around these secrets.

## Backup, restore, and rollback

Configure scheduled backups on the PostgreSQL resource before relying on production:
daily backups, at least 14 daily copies and four weekly copies, stored outside the
database host. Confirm successful runs and storage access. Back up the whole database,
including Drizzle migration history, calendar metadata and idempotency results.

Use PostgreSQL 18 client tools. Store connection credentials in a protected environment
or `.pgpass`; the following examples assume `PGHOST`, `PGUSER`, `PGDATABASE` and
authentication are already configured:

```sh
pg_dump --format=custom --file=planner.dump
createdb planner_restore_drill
pg_restore --no-owner --no-acl --dbname=planner_restore_drill planner.dump
```

Restore to a **new, isolated database**, point a temporary app at it, run migrations,
and compare people, templates, scheduled dates, assignments and revision with the
backup source. Open the app using separate test secrets and confirm representative
old and current activities. Record the restore date, backup identifier and result.
Never practice a restore over the live calendar. Secure backup files like the database.

Roll back the app by selecting a previously published immutable SHA or release tag
in Coolify and redeploying, then check `/readyz`. Do not roll back the database by
reusing an older PostgreSQL major against newer data. New migrations must remain
compatible with the preceding application image whenever application rollback is
expected; take a backup before schema changes. Generate and review SQL with
`npm run db:generate`, commit `drizzle/`, and test empty/repeated migrations.

## Deployment smoke test

Open an invitation at the production HTTPS origin; verify fragment removal, a secure
HttpOnly SameSite=Strict cookie, and a clean URL. Without a session the API must return
401. With a session, a mutation from another Origin must return 403 and non-JSON
mutations 415. Check `/healthz` and database-backed `/readyz`.

Keep two devices open and create, edit, assign and delete an activity. Leave the SSE
request open for several minutes: heartbeat frames should arrive every 15 seconds,
with no proxy buffering. Confirm HTTPS forwarding, routing at `/`, long-lived
connections and a refetch after reconnect. Redeploy the app and confirm persistence;
check readiness and live updates again. Repeat after an application rollback.

Production GHCR publication, webhook execution, proxy streaming and scheduled-backup
configuration require checks in the actual deployment; local tests cannot certify them.
