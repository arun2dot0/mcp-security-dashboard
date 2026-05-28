// lib/graph-executor.ts

export type QuerySecurityGraphArgs = {
  entity: string;
  filters?: Record<string, any>;
  fields?: string[];
  limit?: number;
};

/**
 * Execute a planned "query_security_graph" call via your existing REST/GraphQL API.
 * Assumes you have MCP_HTTP_URL pointing to a POST endpoint
 * that accepts this shape and returns JSON.
 */
export async function executeQuerySecurityGraph(
  args: QuerySecurityGraphArgs,
): Promise<any> {
  const url = process.env.MCP_HTTP_URL;
  if (!url) {
    throw new Error("MCP_HTTP_URL is not set");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `query_security_graph REST call failed: ${res.status} ${text}`,
    );
  }

  // Adjust if your REST endpoint wraps result differently
  return res.json();
}