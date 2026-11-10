# Run Receipts for OpenClaw

A dashboard widget that checks whether the latest successful OpenClaw automation produced a fresh JSON report. The widget shows the scheduler result and the report check separately, so a green run can still show a stale or missing report.

## Install from ClawHub

Use OpenClaw 2026.11.2 or later and Node 24.16+ below 25, or Node 26.1+.

```sh
openclaw plugins install clawhub:@brianmcguire/openclaw-run-receipts --accept-capabilities
```

Run Receipts uses the Gateway's authenticated dispatch capability to check dashboard access and read the job's recorded runs with the viewer's scopes.

## Add it to your dashboard

Configure one automation ID and the full key of the dashboard session where you want to see it. Merge these settings into the existing Gateway config.

```json
{
  "plugins": {
    "entries": {
      "run-receipts": {
        "enabled": true,
        "config": {
          "jobId": "YOUR_AUTOMATION_ID",
          "sessionKey": "agent:main:YOUR_SESSION_ID"
        }
      }
    }
  }
}
```

Restart the Gateway. In Control UI, enable **Custom plugin UI** under **Settings > Labs**. Open the configured session and ask an agent with the `dashboard` tool to pin the Run Receipts widget, or run this command on the Gateway with your session key.

```sh
openclaw gateway call board.widget.put --params '{
  "sessionKey": "agent:main:YOUR_SESSION_ID",
  "name": "run-receipts",
  "title": "Run Receipts",
  "content": { "kind": "plugin", "pluginKind": "run-receipts:receipt", "props": {} },
  "placement": { "size": "md" }
}'
```

## Produce the report

Have the automation write `run-receipts/<job-id>.json` under the Gateway's OpenClaw state directory. The default state directory is `~/.openclaw`. Use the effective state directory when a profile or `OPENCLAW_STATE_DIR` changes it.

The report needs three fields. Set `generatedAt` with `Date.now()` when the report is ready, and write it before the job exits. Use a temporary file in the same directory followed by a rename so the widget reads a complete report. Keep the directory private to the Gateway account.

```json
{
  "jobId": "YOUR_AUTOMATION_ID",
  "generatedAt": 1794279000000,
  "resultCount": 0
}
```

A valid zero-result report can verify a run. The timestamp must fall within the latest successful execution window recorded by OpenClaw. An older report is **Stale**. A missing file is **Missing**. An unsuccessful run, a timestamp after the run ended, unreadable history, or an invalid file leaves the receipt **Unverified**. The reader accepts regular JSON files up to 64 KiB and displays the timestamp and count.

The widget checks on open, reconnect, and **Check again**. The Gateway reads the configured job with the viewer's existing OpenClaw permissions. This check relies on the automation writing accurate report fields. It does not validate how the automation found its results or confirm delivery to a chat channel.

See the [OpenClaw dashboard guide](https://docs.openclaw.ai/web/dashboards) and [automation run history](https://docs.openclaw.ai/automation/cron-jobs/managing-jobs).

## Build from source

```sh
npm ci
npm run build
npm test
npm pack
```
