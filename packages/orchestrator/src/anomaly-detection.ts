// Tier-1 anomaly rules: deterministic, no LLM judgment, no baseline needed.
// Each rule takes raw evidence and returns a signal if — and only if — it finds
// something concrete. Absence of a signal means "this rule found nothing," not
// "the app is healthy" — there may be real bugs no tier-1 rule can see.
//
// Tier-2 (below, detectBaselineDrift) is different in kind: it doesn't check
// for anything specific, it flags whatever changed since a known-good run —
// catches bugs nobody thought to write a tier-1 rule for, at the cost of
// being noisier on screens with legitimately dynamic content.

export interface AnomalySignal {
  rule: string;
  description: string;
}

/** Flags when a widget the caller expected to see never appeared. */
export function detectMissingExpectedElement(
  interactiveElementsText: string,
  expectedElementKey: string,
): AnomalySignal | null {
  if (interactiveElementsText.includes(`"${expectedElementKey}"`)) {
    return null;
  }
  return {
    rule: "expected-element-missing",
    description: `Expected element with key "${expectedElementKey}" was not found after the interaction steps completed.`,
  };
}

/** Flags any runtime exception Dart MCP's VM service connection has captured. */
export function detectRuntimeException(runtimeErrorsText: string): AnomalySignal | null {
  if (runtimeErrorsText.trim().toLowerCase() === "no runtime errors found.") {
    return null;
  }
  return {
    rule: "runtime-exception",
    description: `A runtime exception was detected: ${runtimeErrorsText.slice(0, 500)}`,
  };
}

/**
 * Flags any "E/flutter" native log output (Android only). This is a backstop
 * for exception classes detectRuntimeException structurally can't see — see
 * doc/007 — an unhandled fire-and-forget async error never reaches the VM
 * service's Flutter.Error/Stderr streams, but the engine still prints it to
 * native platform logging (adb logcat), which this checks directly.
 */
export function detectNativeLogException(logText: string): AnomalySignal | null {
  // logcat prints its own "--------- beginning of <buffer>" marker lines when
  // a requested time range starts before the buffer has content — not a real
  // log entry, has to be filtered out separately from genuine app output.
  const realLines = logText
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("---------"));

  if (realLines.length === 0) {
    return null;
  }
  return {
    rule: "native-log-exception",
    description: `An error was logged via the native "flutter" log tag: ${realLines.join("\n").slice(0, 500)}`,
  };
}

/**
 * Flags any difference from a previously saved known-good observation of the
 * same interaction path — see doc/016. Line-based, not fuzzy: exact matches
 * across identical reproduction runs are the norm (verified in doc/015 — three
 * runs of the same steps produced byte-identical interactiveElements text), so
 * a plain diff is enough without needing a similarity threshold.
 */
export function detectBaselineDrift(current: string, baseline: string): AnomalySignal | null {
  if (current === baseline) {
    return null;
  }
  const currentLines = new Set(current.split("\n"));
  const baselineLines = new Set(baseline.split("\n"));
  const removed = [...baselineLines].filter((l) => !currentLines.has(l));
  const added = [...currentLines].filter((l) => !baselineLines.has(l));

  const parts: string[] = [];
  if (removed.length) parts.push(`Present in baseline, missing now:\n${removed.join("\n")}`);
  if (added.length) parts.push(`New since baseline:\n${added.join("\n")}`);

  return {
    rule: "baseline-drift",
    description: `Interactive elements differ from the known-good baseline for this flow. ${parts.join("\n\n")}`.slice(0, 1000),
  };
}
