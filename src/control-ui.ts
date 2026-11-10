import { defineControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import type { Snapshot } from "./receipt.js";
import "./control-ui.css";

const evidenceLabels = {
  verified: "Verified",
  stale: "Stale report",
  missing: "Missing report",
  unknown: "Unverified",
};
const runLabels = {
  ok: "Succeeded",
  error: "Failed",
  skipped: "Skipped",
  none: "No completed run",
  unknown: "Unavailable",
};

function displayTime(value: number | undefined): string {
  return value === undefined ? "—" : new Date(value).toLocaleString();
}

function addField(list: HTMLDListElement, label: string, value: string) {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  row.append(term, description);
  list.append(row);
}

export default defineControlUiPlugin({
  id: "run-receipts",
  activate(host) {
    return host.ui.registerWidget({
      id: "receipt",
      label: "Run Receipts",
      mount(container, context) {
        const card = document.createElement("section");
        card.className = "run-receipts";
        card.setAttribute("aria-label", "Automation receipt");

        const toolbar = document.createElement("div");
        toolbar.className = "run-receipts__toolbar";
        const status = document.createElement("strong");
        status.setAttribute("role", "status");
        const refresh = document.createElement("button");
        refresh.type = "button";
        refresh.textContent = "Check again";
        toolbar.append(status, refresh);

        const detail = document.createElement("p");
        const fields = document.createElement("dl");
        card.append(toolbar, detail, fields);
        container.replaceChildren(card);

        let disposed = false;
        let requestVersion = 0;
        let connected = context.host.connection.connected;

        function render(snapshot: Snapshot) {
          status.textContent = evidenceLabels[snapshot.evidenceStatus];
          status.dataset.state = snapshot.evidenceStatus;
          detail.textContent = snapshot.detail;
          fields.replaceChildren();
          addField(fields, "Latest run", runLabels[snapshot.runStatus]);
          addField(fields, "Run finished", displayTime(snapshot.finishedAt));
          addField(fields, "Report generated", displayTime(snapshot.generatedAt));
          addField(fields, "Results", snapshot.resultCount?.toLocaleString() ?? "—");
        }

        async function check() {
          const version = ++requestVersion;
          if (disposed) return;
          refresh.disabled = true;
          status.removeAttribute("data-state");
          fields.replaceChildren();
          status.textContent = "Checking receipt…";
          detail.textContent = "";
          if (!connected) {
            status.textContent = "Gateway disconnected";
            return;
          }

          const { sessionKey, agentId } = context.props;
          try {
            const snapshot = await context.host.request<Snapshot>(
              "run-receipts.snapshot", { sessionKey, agentId },
            );
            if (disposed || version !== requestVersion) return;
            render(snapshot);
          } catch {
            if (disposed || version !== requestVersion) return;
            status.textContent = "Receipt unavailable";
            detail.textContent = "Check that this session is configured for Run Receipts and that you can view it.";
          } finally {
            if (!disposed && version === requestVersion) refresh.disabled = !connected;
          }
        }

        refresh.addEventListener("click", check);
        const unsubscribe = context.host.subscribe(() => {
          const next = context.host.connection.connected;
          if (connected === next) return;
          connected = next;
          void check();
        });
        void check();

        return {
          update(next) {
            const changed = next.props.sessionKey !== context.props.sessionKey
              || next.props.agentId !== context.props.agentId;
            context = next;
            if (changed) void check();
          },
          dispose() {
            disposed = true;
            unsubscribe();
            refresh.removeEventListener("click", check);
            card.remove();
          },
        };
      },
    });
  },
});
