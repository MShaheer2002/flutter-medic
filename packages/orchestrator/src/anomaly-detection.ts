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
