# Cloud agent

The cloud agent mirrors the Study library to the Planner Hub and runs the Planner's queued commands on this machine. It is started with the Next.js server (Node runtime) only when configured, and can also be run from a terminal.

## Configuration

Set both values, either in the environment or in **Settings → Keys → Cloud hub**:

| Variable | Meaning |
| --- | --- |
| `HUB_URL` | Base URL of the deployed Hub Worker (`https://…`, trailing `/` optional). |
| `HUB_TOKEN` | Device bearer token issued for this machine by the hub. |

Real environment variables win over values saved in the keys store (`auth.json`). The agent is disabled when either value is missing. The machine name used to claim commands is `os.hostname()`.

For older/hand-edited installs, a `hub` object in `settings.json` (`{"url":…, "token":…}`) is also read as a fallback.

## What it does

Every 60 seconds and whenever the server emits `sources-changed`:

1. Diff the library against `data/study/cloud-mirror.json` (or `<LH_DATA_DIR>/study/cloud-mirror.json`). New and changed subjects, topics, materials and deadlines are pushed as `h_subject`, `h_topic`, `h_material` and `h_deadline` rows via `POST /ops` with `updatedAt`; rows that disappeared locally are re-sent once with `deletedAt`.
2. Material files are uploaded by SHA-256: `HEAD /files/:sha` first, then `PUT /files/:sha` if missing. Files come from the study store's `materials/<sha>.pdf` / `.txt` path.
3. Queued commands are claimed with `POST /commands/claim` (`{"device": "<hostname>"}`) and completed with `POST /commands/:id/complete`. `harness.note` calls the same `upsertPlannerNote` helper as `/api/planner/notes`; `harness.capture` downloads each `fileSha` with `GET /files/:sha` and calls `createCapture`, the same helper as `/api/study/inbox`.
4. `POST /events` publishes `harness.mirrored` with `{ at, materials, bytes }`.

State is saved only after the Hub accepts the pass. If the Hub is unreachable, the pass is retried with exponential backoff (1 → 2 → 4 … minutes, capped at 15) and nothing breaks locally.

## CLI

```bash
npm run cloud-agent -- --once   # one pass, then exit
npm run cloud-agent             # loop with the same 60s / backoff schedule
```

`npm test` includes `tests/cloud-agent*.test.ts`, which cover the mirror diff and command dispatch against a fake hub.
