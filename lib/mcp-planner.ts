// lib/mcp-planner.ts
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ROUTER_MODEL = process.env.MCP_ROUTER_MODEL || "gpt-4o-mini";
const FORMATTER_MODEL = process.env.MCP_FORMATTER_MODEL || "gpt-4o-mini";

export type PlanStep = {
  id: string;
  tool: string;
  arguments: any;
  description: string;
};

export type Plan = {
  steps: PlanStep[];
};

/**
 * Plan which MCP tools to call.
 *
 * @param userText User's natural language request
 * @param tools tools() map from the MCP client
 * @param schemaData Optional schema JSON (for graph backend, result of get_security_schema)
 * @param backend Backend type, e.g. "graph" or "rest"
 */
export async function planTools(
  userText: string,
  tools: Record<string, any>,
  schemaData?: any,
  backend: string = "rest",
): Promise<Plan> {
  const toolList = Object.entries(tools).map(([name, def]) => ({
    name,
    description: def?.description ?? "",
  }));

  const systemPrompt =
    backend === "graph"
      ? buildGraphPlanningPrompt(schemaData, toolList)
      : buildGenericPlanningPrompt();

   console.log(systemPrompt);

  const userPrompt = `
User request:
${userText}

Available tools:
${JSON.stringify(toolList, null, 2)}
`.trim();

  const resp = await openai.chat.completions.create({
    model: ROUTER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
  });

  const raw = resp.choices[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.steps)) {
      return parsed as Plan;
    }
  } catch {}

  return { steps: [] };
}
/**
 * Summarize multiple tool step results into a single UI payload.
 */
export async function summarizeForUiWithPlan(
  userText: string,
  plan: Plan,
  stepResults: Record<string, any>,
  backend: string = "generic",
) {
  const systemPrompt =
    backend === "graph"
      ? buildGraphSummarizerPrompt()
      : buildGenericSummarizerPrompt();

  const userPrompt = `
User request:
${userText}

Plan:
${JSON.stringify(plan, null, 2)}

Step results:
${JSON.stringify(stepResults, null, 2)}
  `.trim();

  const resp = await openai.chat.completions.create({
    model: FORMATTER_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
  });

  const raw = resp.choices[0]?.message?.content ?? "";

  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.type === "summary" ||
        parsed.type === "list" ||
        parsed.type === "data")
    ) {
      return parsed;
    }
  } catch {
    // ignore parse error
  }

  return {
    type: "summary",
    title: "Tool results",
    text: JSON.stringify(stepResults, null, 2),
  };
}

/* ---------- Prompt builders ---------- */

function buildGenericPlanningPrompt() {
  return `
You are a planning assistant for a system backed by MCP tools.

You are given:
- A user request.
- A list of available tools (name + description).

Your job is to create a PLAN consisting of 1-3 steps.
Each step calls ONE MCP tool with JSON arguments.

Rules:
- Prefer as FEW steps as possible, but use MORE than one step when the user
  clearly asks for multiple views or comparisons, for example:
  - "compare staging vs prod"
  - "list things AND then summarize them"
  - "first show X, then show Y"
- A step must reference a valid tool name from the list.
- Arguments must be valid JSON.
- If the question is simple and one tool is enough, use a single step.
- If no tool is appropriate, return an empty steps array.

Respond ONLY with JSON of the form:
{
  "steps": [
    {
      "id": "step1",
      "tool": string,
      "arguments": object,
      "description": string
    },
    ...
  ]
}
  `.trim();
}

function buildGraphPlanningPrompt(schemaData: any, toolList: { name: string; description: string }[]) {
  const schemaSnippet =
    schemaData && typeof schemaData === "object"
      ? JSON.stringify(schemaData, null, 2)
      : "null";

  const toolsJson = JSON.stringify(toolList, null, 2);

  return `
You are a planning assistant for a graph-based security data API.

You are given:
- A user request in natural language.
- A list of available MCP tools (name + description).
- A JSON description of the security graph schema.

The schema JSON includes, for each entity:
- "fields": all output fields.
- "relations": relation names.
- "filters": which fields can be used as filters, with:
  - "type": "string" | "number" | "boolean" | "datetime"
  - "operators": e.g. ["eq", "in", "gt", "lt", "between"]
  - "allowedValues": optional list of valid values (for enums like severity).

Schema JSON:
${schemaSnippet}

Available tools (JSON):
${toolsJson}

Your job:
- Create a PLAN with ONE step that calls "query_security_graph".
- Use the schema's "filters" metadata to choose valid filter fields and values.

Filter rules:
- You may ONLY filter on fields that appear under "filters" for the chosen entity.
- When "allowedValues" is present (e.g. for severity, environment, priority),
  map natural language to those values and do not invent new ones.
  - "critical", "critical severity" -> "CRITICAL"
  - "high severity" -> "HIGH"
  - "prod", "production" -> "prod"
- The filters object must be a simple JSON object where keys are field names
  or dotted paths (like "tags.name") and values are the filter values.
- If the user talks about ranges ("cvss > 7", "after 2024-01-01"), choose the
  closest operator from "operators" and encode it with a simple convention, e.g.:
  { "cvssScore": { "gt": 7.0 } } or
  { "publishedAt": { "after": "2024-01-01" } }.
  (Your backend should interpret these according to its filter logic.)

If you are not sure how to encode a complex filter, prefer a simpler, correct filter
(e.g. only on "severity") rather than inventing new fields.

Respond ONLY with JSON:
{
  "steps": [
    {
      "id": "step1",
      "tool": "query_security_graph",
      "arguments": {
        "entity": string,
        "filters": object,
        "fields": string[],
        "limit": number
      },
      "description": string
    }
  ]
}
`.trim();
}


function buildGenericSummarizerPrompt() {
  return `
You are a formatting assistant for a frontend UI.

You are given:
- The user's request.
- A PLAN of MCP tool calls (steps with id, tool, arguments, description).
- The JSON result for each step.

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

Guidance:
- If the plan has multiple steps, COMBINE their results into one coherent answer
  (e.g., compare environments, show top assets then top CVEs).
- Include only the most relevant fields; omit noisy raw_data, timestamps, etc.
- Be concise but informative.
- Respond ONLY with that JSON, no explanation or prose.
  `.trim();
}

function buildGraphSummarizerPrompt() {
  return `
You are a formatting assistant for a frontend UI that shows security graph results.

You are given:
- The user's request.
- A PLAN of MCP tool calls (steps with id, tool, arguments, description).
- The JSON result for each step.

Your task:
- Produce a concise JSON object for the UI, in ONE of these shapes:

1) Summary text only:
{
  "type": "summary",
  "title": string,
  "text": string
}

2) A list of items (array of objects or primitives), e.g. containers or CVEs:
{
  "type": "list",
  "title": string,
  "items": any[]
}

3) A data object (for more complex nested results):
{
  "type": "data",
  "title": string,
  "data": any
}

Graph-specific guidance:
- For ContainerAsset queries:
  - Prefer "list" where each item summarizes a container:
    - include fields like name, environment, publiclyExposed, runsAsRoot,
      and a small summary of CVEs if available.
- For CVE-focused queries:
  - Prefer "list" of CVEs with id, summary, severity, and cvssScore.
- Avoid dumping raw GraphQL-like nested structures; keep items small and readable.
- Remove internal IDs or timestamps unless clearly relevant.

General rules:
- If the plan has multiple steps, COMBINE their results into one coherent answer.
- Include only the most relevant fields; omit noisy raw_data, timestamps, etc.
- Be concise but informative.
- Respond ONLY with that JSON, no explanation or prose.
  `.trim();
}