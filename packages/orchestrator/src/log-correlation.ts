interface TimelineEntry {
  epochMs: number;
  source: "native-log" | "network";
  description: string;
}

/**
 * "-v epoch" native-log lines start with a raw epoch-seconds timestamp
 * (e.g. "1787426661.324  1234  1234 E flutter: message"). Using this instead
 * of parsing the default no-year local-clock format is what makes merging
 * against networkActivity's own epoch timestamps safe — both are the same
 * absolute clock, no guessing about device vs. host timezone.
 */
function parseNativeLogEntries(nativeLog: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const line of nativeLog.split("\n")) {
    if (line.trim() === "" || line.startsWith("---------")) continue;
    const match = line.match(/^(\d+\.\d+)\s+(.*)$/);
    if (!match) continue;
    entries.push({ epochMs: parseFloat(match[1]) * 1000, source: "native-log", description: match[2].trim() });
  }
  return entries;
}

interface HttpProfileEvent {
  timestamp: number;
  event: string;
}
interface HttpProfileRequest {
  method: string;
  uri: string;
  events?: HttpProfileEvent[];
  response?: { statusCode?: number };
}

/** networkActivity's own timestamps are epoch MICROSECONDS. */
function parseNetworkEntries(networkActivity: string): TimelineEntry[] {
  if (!networkActivity.trim()) return [];
  let parsed: { requests?: HttpProfileRequest[] };
  try {
    parsed = JSON.parse(networkActivity);
  } catch {
    return [];
  }

  const entries: TimelineEntry[] = [];
  for (const request of parsed.requests ?? []) {
    for (const event of request.events ?? []) {
      const status = request.response?.statusCode;
      const suffix = status ? ` (status ${status})` : "";
      entries.push({
        epochMs: event.timestamp / 1000,
        source: "network",
        description: `${event.event}: ${request.method} ${request.uri}${suffix}`,
      });
    }
  }
  return entries;
}

/**
 * Merges native-log and network evidence for one run into a single
 * chronologically-ordered timeline (elapsed ms from the first event, not
 * absolute clock time — sidesteps any need to display a timezone at all).
 * This is Phase 3's "log correlation": cross-referencing multiple evidence
 * sources against each other rather than reading each in isolation.
 */
export function buildTimeline(nativeLog: string, networkActivity: string): string[] {
  const entries = [...parseNativeLogEntries(nativeLog), ...parseNetworkEntries(networkActivity)];
  if (entries.length === 0) return [];

  entries.sort((a, b) => a.epochMs - b.epochMs);
  const t0 = entries[0].epochMs;
  return entries.map((e) => `+${Math.round(e.epochMs - t0)}ms [${e.source}] ${e.description}`);
}
