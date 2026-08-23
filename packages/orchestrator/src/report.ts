import type { AnomalySignal } from "./anomaly-detection.js";
import type { ReproductionResult, RunResult } from "./reproduction.js";

const RULE_LABELS: Record<string, string> = {
  "expected-element-missing": "Expected element missing",
  "runtime-exception": "Runtime exception",
  "native-log-exception": "Native log exception (logcat)",
  "baseline-drift": "Baseline drift",
};

function dedupeSignals(runs: RunResult[]): { signal: AnomalySignal; count: number }[] {
  const byKey = new Map<string, { signal: AnomalySignal; count: number }>();
  for (const run of runs) {
    for (const signal of run.signals) {
      const key = `${signal.rule}:${signal.description}`;
      const existing = byKey.get(key);
      if (existing) existing.count++;
      else byKey.set(key, { signal, count: 1 });
    }
  }
  return [...byKey.values()];
}

/**
 * Turns a reproduction run's raw evidence (RunResult[]) into a human-readable
 * markdown summary — the raw JSON already carries everything a calling agent
 * needs to reason over, but a person reading the result shouldn't have to
 * re-derive "so what actually happened" from a pile of per-run objects.
 */
export function generateReport(result: ReproductionResult, goal?: string): string {
  const lines: string[] = [];
  lines.push(`# ${goal ?? "Investigation report"}`);
  lines.push("");
  lines.push(
    result.verdict === "confirmed"
      ? `**Confirmed** — anomaly reproduced in ${result.reproductionCount}/${result.reproductionRuns} runs.`
      : `**Not reproduced** — anomaly detected in only ${result.reproductionCount}/${result.reproductionRuns} runs (inconsistent, not confirmed).`,
  );
  lines.push("");

  const signals = dedupeSignals(result.runs);
  if (signals.length === 0) {
    lines.push("No anomalies detected in any run.");
    return lines.join("\n");
  }

  lines.push("## Findings");
  lines.push("");
  for (const { signal, count } of signals) {
    const label = RULE_LABELS[signal.rule] ?? signal.rule;
    lines.push(`- **${label}** (${count}/${result.reproductionRuns} runs): ${signal.description}`);
  }

  return lines.join("\n");
}
