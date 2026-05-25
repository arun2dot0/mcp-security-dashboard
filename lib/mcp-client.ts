// lib/mcp-client.ts
import { createMCPClient } from '@ai-sdk/mcp';

const MCP_URL = process.env.MCP_HTTP_URL ?? 'http://127.0.0.1:8001/mcp';

export type McpClient = Awaited<ReturnType<typeof createMCPClient>>;

export async function withMcpClient<T>(
  fn: (client: McpClient) => Promise<T>,
): Promise<T> {
  const client = await createMCPClient({
    transport: {
      type: 'http',
      url: MCP_URL,
    },
  });

  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}