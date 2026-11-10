import { join } from "node:path";
import { dispatchGatewayMethod } from "openclaw/plugin-sdk/gateway-method-runtime";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolveStateDir } from "openclaw/plugin-sdk/state-paths";
import { inspectReceipt, unavailable } from "./receipt.js";

export default definePluginEntry({
  id: "run-receipts",
  name: "Run Receipts",
  description: "Verify the output of an OpenClaw automation in a session dashboard.",
  register(api) {
    const config = api.pluginConfig;
    const jobId = config?.jobId;
    const sessionKey = config?.sessionKey;

    api.session.controls.registerControlUiDescriptor({
      id: "receipt",
      surface: "widget",
      label: "Run Receipts",
      description: "Check the latest automation report against its recorded run.",
      requiredScopes: ["operator.read"],
    });

    api.registerGatewayMethod("run-receipts.snapshot", async ({ params, respond, hasCurrentClientAuthority }) => {
      if (typeof jobId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)
        || typeof sessionKey !== "string" || !sessionKey) {
        respond(true, unavailable("Configure an automation and dashboard session first."));
        return;
      }
      if (params.sessionKey !== sessionKey) {
        respond(true, unavailable("This dashboard has no configured receipt."));
        return;
      }

      let result = unavailable("OpenClaw run history is unavailable.");
      try {
        const board = await dispatchGatewayMethod("board.get", { sessionKey }, { timeoutMs: 5_000 });
        if (!board.ok || hasCurrentClientAuthority?.() === false) {
          respond(true, unavailable("This dashboard receipt is unavailable."));
          return;
        }
        const history = await dispatchGatewayMethod("cron.runs", {
          id: jobId, limit: 1, sortDir: "desc",
        }, { timeoutMs: 5_000 });
        if (history.ok && hasCurrentClientAuthority?.() !== false) {
          const directory = join(resolveStateDir(), "run-receipts");
          result = await inspectReceipt(history.payload, directory, jobId);
        }
      } catch {
        // The nested method retains the caller's Gateway permissions.
      }
      respond(true, hasCurrentClientAuthority?.() === false
        ? unavailable("Access to this receipt has ended.")
        : result);
    }, { scope: "operator.read" });
  },
});
