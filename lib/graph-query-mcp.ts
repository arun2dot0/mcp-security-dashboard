// lib/graph-query-mcp.ts
import { withMcpClient } from "./mcp-client";

export type QuerySecurityGraphArgs = {
  entity: string;
  filters?: Record<string, any>;
  fields?: string[] | null;
  limit?: number;
};

export async function runQuerySecurityGraphViaMcp(
  args: QuerySecurityGraphArgs,
): Promise<any> {
  return withMcpClient(async (client: any) => {
    const tools = await client.tools();
    if (!tools["query_security_graph"]) {
      throw new Error("MCP tool 'query_security_graph' not found");
    }

    // Note: for zero-arg tools, pass {} as arguments; for this one, pass args.
    const result = await client.callTool({
      name: "query_security_graph",
      arguments: {
        entity: args.entity,
        filters: args.filters ?? {},
        fields: args.fields ?? null,
        limit: args.limit ?? 50,
      },
    });

    // Your Python tool returns a JSON string; parse if needed
    if (typeof result === "string") {
      try {
        return JSON.parse(result);
      } catch {
        return result;
      }
    }

    return result;
  });
}