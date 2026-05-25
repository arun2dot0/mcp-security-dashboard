// app/api/chat/route.ts
import { NextRequest } from 'next/server';
import { withMcpClient } from '@/lib/mcp-client';
import {
  planTools,
  summarizeForUiWithPlan,
  type Plan,
} from "@/lib/mcp-planner";
import OpenAI from 'openai';

export const maxDuration = 60;

type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

// Generic UI payload the frontend can render for ANY tool
type UiResponse =
  | { type: 'summary'; title: string; text: string }
  | { type: 'list'; title: string; items: any[] }
  | { type: 'data'; title: string; data: any };

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper: ask LLM which MCP tool to call and with what arguments
async function decideTool(userText: string, tools: Record<string, any>) {
  const toolList = Object.entries(tools).map(([name, def]) => ({
    name,
    description: def?.description ?? '',
  }));

const systemPromptGraph = `
You are a routing assistant for an MCP-powered vulnerability scanner.

You are given:
- A user request.
- A list of available MCP tools, including their names and descriptions.

These tools are already implemented in an MCP server (this is a demo);
you MUST select from these tools when the question is about security.

Typical tools:
- listcontainerassets / getcontainerassets:
  Query container assets (services, images, environments, namespaces) and
  their related CVEs. Use this when the user asks about containers,
  services, assets, images, environments, namespaces, or "container assets with CVEs".
- listcves / getcves:
  Query CVEs directly. Use this when the user asks about CVEs in general,
  severities, or vulnerability lists without a specific asset focus.

Routing rules:
- If the user asks about containers, services, assets, images, environments,
  namespaces, or "container assets with CVEs" or similar, you MUST choose the
  asset-centric tool from the list (prefer a tool whose name contains
  "getcontainerassets" or "listcontainerassets").
- If the user asks about CVEs in general (e.g. list critical CVEs, CVEs by date),
  you MUST choose the CVE-centric tool (prefer a tool whose name contains
  "getcves" or "listcves").
- If the user’s question is even loosely about vulnerabilities, CVEs, security,
  containers, services, images, environments, or assets, you MUST choose one
  of the available MCP tools instead of returning null.
- Only return null when the question is clearly not about these topics at all.

Arguments:
- For container-asset tools:
  - Default arguments: { "limit": 20 } if a limit exists.
  - Only set exposure/root flags if the user explicitly mentions them.
- For CVE tools:
  - Default arguments: { "limit": 20 } if a limit exists.
  - Only set severity/date filters if the user clearly asks.

Respond ONLY with a valid JSON object of the form:
{
  "tool": string | null,
  "arguments": object
}
The "tool" MUST be one of the available MCP tool names from the list.
No extra text, no explanation.
`.trim();

const systemPromptRest = `
You are a routing assistant for an MCP-powered system.

You are given:
- A user request.
- A list of available MCP tools (name + description).

Your task:
- Decide which SINGLE tool to call and what JSON arguments to pass.
- If no tool is appropriate, return tool = null.

Respond ONLY with a valid JSON object of the form:
{
  "tool": string | null,
  "arguments": object
}
No extra text, no explanation.
`.trim();

  const userPrompt = `
User request:
${userText}

Available MCP tools:
${JSON.stringify(toolList, null, 2)}
`.trim();
  
  const backend = process.env.MCP_BACKEND ?? "graph";

  const systemPrompt = backend === "rest" ? systemPromptRest : systemPromptGraph;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
  });
  const raw = resp.choices[0]?.message?.content ?? '';
  let parsed: { tool: string | null; arguments: any } = {
    tool: null,
    arguments: {},
  };

  try {
    parsed = JSON.parse(raw);
  } catch {
    // If parsing fails, fall back to no tool
  }

  if (typeof parsed.tool !== 'string') {
    parsed.tool = null;
  }
  if (parsed.arguments == null || typeof parsed.arguments !== 'object') {
    parsed.arguments = {};
  }

  return parsed;
}

// Helper: ask LLM to summarize tool output into UI-friendly JSON
async function summarizeForUi(
  userText: string,
  toolName: string | null,
  toolArgs: any,
  toolResult: any,
): Promise<UiResponse> {
  const systemPrompt = `
You are a formatting assistant for a frontend UI.

Given:
- The user's request.
- The MCP tool name and arguments (if any).
- The raw MCP tool JSON result.

Your task:
- Produce a concise JSON object for the UI, in ONE of these shapes:

1) Summary text only:
{
  "type": "summary",
  "title": string,
  "text": string
}

2) A list of items (array of objects or primitives):
{
  "type": "list",
  "title": string,
  "items": any[]
}

3) A data object:
{
  "type": "data",
  "title": string,
  "data": any
}

Rules:
- Choose whichever shape best fits the tool result and the user request.
- Include only the most relevant fields; omit noisy raw_data, timestamps, etc.
- Be concise but informative.
- Respond ONLY with that JSON, no explanation or prose.
`.trim();

  const userPrompt = `
User request:
${userText}

Tool used:
${toolName ?? 'none'}

Tool arguments:
${JSON.stringify(toolArgs, null, 2)}

Raw tool result (truncated if huge):
${JSON.stringify(toolResult, null, 2)}
`.trim();

  const resp = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0,
  });

  const raw = resp.choices[0]?.message?.content ?? '';

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed.type === 'summary' ||
        parsed.type === 'list' ||
        parsed.type === 'data')
    ) {
      return parsed as UiResponse;
    }
  } catch {
    // fall through
  }

  // Fallback: plain summary dump
  return {
    type: 'summary',
    title: 'Tool result',
    text: JSON.stringify(toolResult, null, 2),
  };
}

export async function POST(req: NextRequest) {
  try {
    const { messages } = (await req.json()) as { messages: ChatMessage[] };

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const userText = lastUser?.content ?? "";

    // Plan + execute
    const { stepResults, plan } = await withMcpClient(async (client) => {
      const mcpClient = client as unknown as {
        tools: () => Promise<Record<string, any>>;
        callTool: (args: { name: string; arguments?: any }) => Promise<any>;
      };

      const tools = await mcpClient.tools();

      const plan = await planTools(userText, tools);
      console.log("[MCP] Plan:", JSON.stringify(plan, null, 2));

      const stepResults: Record<string, any> = {};

      for (const step of plan.steps) {
        const toolDef = tools[step.tool];
        if (!toolDef) {
          console.log("[MCP] Tool not found in tools():", step.tool);
          stepResults[step.id] = {
            error: `Tool ${step.tool} not found`,
          };
          continue;
        }

        console.log(
          `[MCP] Executing ${step.id} -> ${step.tool} with args`,
          step.arguments,
        );

        try {
          const result = await mcpClient.callTool({
            name: step.tool,
            arguments: step.arguments,
          });

          // console.log(
          //   `[MCP] Result for ${step.id}:`,
          //   typeof result === "string"
          //     ? result
          //     : JSON.stringify(result, null, 2),
          // );

          stepResults[step.id] = result;
        } catch (err: any) {
          console.error(`[MCP] Error in step ${step.id}:`, err);
          stepResults[step.id] = {
            error: String(err?.message ?? err),
          };
        }
      }

      return { stepResults, plan };
    });

    const uiPayload = await summarizeForUiWithPlan(
      userText,
      plan,
      stepResults,
    );

    const reply: ChatMessage = {
      role: "assistant",
      content: JSON.stringify(uiPayload),
    };

    return Response.json({ messages: [...messages, reply] });
  } catch (err) {
    console.error("MCP + LLM chat error:", err);
    const errorReply: ChatMessage = {
      role: "assistant",
      content: JSON.stringify({
        type: "summary",
        title: "Error",
        text: "Something went wrong calling MCP or the LLM.",
      }),
    };
    return Response.json({ messages: [errorReply] }, { status: 500 });
  }
}