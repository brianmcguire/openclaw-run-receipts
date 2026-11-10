import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";

const MAX_REPORT_BYTES = 64 * 1024;
const MAX_DATE_MS = 8_640_000_000_000_000;

type EvidenceStatus = "verified" | "stale" | "missing" | "unknown";
type RunStatus = "ok" | "error" | "skipped" | "none" | "unknown";

export type Snapshot = {
  evidenceStatus: EvidenceStatus;
  detail: string;
  runStatus: RunStatus;
  startedAt?: number;
  finishedAt?: number;
  generatedAt?: number;
  resultCount?: number;
};

export function unavailable(detail: string): Snapshot {
  return { evidenceStatus: "unknown", runStatus: "unknown", detail };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function timestamp(value: unknown): value is number {
  return nonnegativeInteger(value) && value > 0 && value <= MAX_DATE_MS;
}

async function readReport(directory: string, jobId: string): Promise<Snapshot> {
  try {
    if (!(await lstat(directory)).isDirectory()) {
      return unavailable("The report directory is unavailable.");
    }
    // Open the report once so atomic replacements cannot mix two versions.
    const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    const file = await open(join(directory, `${jobId}.json`), flags);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_REPORT_BYTES) {
        return unavailable("The report must be a regular JSON file under 64 KiB.");
      }
      const buffer = Buffer.alloc(MAX_REPORT_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
        if (!bytesRead) break;
        size += bytesRead;
      }
      if (size > MAX_REPORT_BYTES) {
        return unavailable("The report exceeds 64 KiB.");
      }
      const report = record(JSON.parse(buffer.toString("utf8", 0, size)));
      if (report?.jobId !== jobId || !timestamp(report.generatedAt)
        || !nonnegativeInteger(report.resultCount)) {
        return unavailable("The report has invalid receipt fields.");
      }
      return {
        evidenceStatus: "unknown",
        runStatus: "unknown",
        detail: "",
        generatedAt: report.generatedAt,
        resultCount: report.resultCount,
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ...unavailable("The expected report is missing."), evidenceStatus: "missing" };
    }
    return unavailable("The report could not be read as JSON.");
  }
}

export async function inspectReceipt(history: unknown, directory: string, jobId: string): Promise<Snapshot> {
  const entries = record(history)?.entries;
  if (!Array.isArray(entries)) return unavailable("OpenClaw returned no readable run history.");
  if (entries.length === 0) {
    return { ...unavailable("There is no completed run to verify yet."), runStatus: "none" };
  }

  const run = record(entries[0]);
  if (run?.jobId !== jobId) return unavailable("OpenClaw returned an unexpected run.");
  const status = run.status;
  const runStatus: RunStatus = status === "ok" || status === "error" || status === "skipped"
    ? status
    : "unknown";
  const startedAt = timestamp(run.runAtMs) ? run.runAtMs : undefined;
  const finishedAt = startedAt !== undefined && nonnegativeInteger(run.durationMs)
    && timestamp(startedAt + run.durationMs)
    ? startedAt + run.durationMs
    : undefined;
  const timing = { runStatus, startedAt, finishedAt };

  if (runStatus !== "ok") {
    return { ...unavailable("Verification requires a successful run."), ...timing };
  }
  if (startedAt === undefined || finishedAt === undefined) {
    return { ...unavailable("OpenClaw did not record the full run window."), ...timing };
  }

  const report = await readReport(directory, jobId);
  const snapshot = { ...report, ...timing };
  if (report.generatedAt === undefined) return snapshot;
  if (report.generatedAt < startedAt) {
    return { ...snapshot, evidenceStatus: "stale", detail: "The report predates this run." };
  }
  if (report.generatedAt > finishedAt) {
    return { ...snapshot, detail: "The report was generated after this run ended." };
  }
  return { ...snapshot, evidenceStatus: "verified", detail: "The report was generated during this run." };
}
