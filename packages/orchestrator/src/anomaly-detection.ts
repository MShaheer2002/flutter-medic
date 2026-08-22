// Tier-1 anomaly rules: deterministic, no LLM judgment, no baseline needed.
// Each rule takes raw evidence and returns a signal if — and only if — it finds
// something concrete. Absence of a signal means "this rule found nothing," not
// "the app is healthy" — there may be real bugs no tier-1 rule can see.

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
