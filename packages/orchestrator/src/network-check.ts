export interface EndpointCheckResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Independent HTTP request, outside the app's own network stack entirely —
 * for cross-checking whether an endpoint genuinely behaves the way the
 * app's observed network evidence suggests, or whether something app-side
 * (auth headers, cookies, request formatting) is the actual cause. Uses
 * Node's built-in fetch — no new dependency for what's already in the
 * runtime. On-demand only: the calling agent decides when independent
 * verification is actually worth a real network request, this is never
 * called automatically during a reproduction run.
 */
export async function checkEndpoint(
  url: string,
  method = "GET",
  headers?: Record<string, string>,
  body?: string,
): Promise<EndpointCheckResult> {
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    body: text.slice(0, 10000),
  };
}
