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

* A user request.
* A list of available tools (name + description).

Your job:

* Create a PLAN consisting of 1-3 steps.
* Each step calls ONE MCP tool with JSON arguments.
* Prefer the FEWEST possible steps.

Limit rules:

* Always include a "limit" argument when the tool supports it.
* IMPORTANT:

  * If the user does NOT explicitly request a quantity,
    use limit = 10.
* Never default to:

  * 50
  * 100
  * 1000
* Only use limits above 20 when the user explicitly asks for:

  * many results
  * all results
  * exhaustive listings
  * exports
  * bulk analysis
* For requests like:

  * "show critical CVEs"
  * "list containers"
  * "recent vulnerabilities"
  * "find exposed assets"
    prefer limit = 10.
* If unsure, use limit = 10.

Planning rules:

* Use as few steps as possible.
* If one tool can answer the request, use one step.
* Only use multiple steps when the user clearly requests comparisons
  or unrelated datasets.

Arguments:

* Arguments must be valid JSON.
* Use only arguments that are clearly supported by the tool description.
* Do not invent filters or parameters.

Respond ONLY with JSON:
{
  "steps": [
    {
    "id": "step1",
    "tool": string,
    "arguments": object,
    "description": string
    }
  ]
}

  `.trim();
}

function buildGraphPlanningPrompt(
  schemaData: any,
  toolList: { name: string; description: string }[]
) {
  const schemaSnippet =
    schemaData && typeof schemaData === "object"
      ? JSON.stringify(schemaData, null, 2)
      : "null";

  const toolsJson = JSON.stringify(toolList, null, 2);

  return `
You are a planning assistant for a graph-based security data API.

You are given:

* A user request in natural language.
* A list of available MCP tools (name + description).
* A JSON description of the security graph schema.

The schema JSON includes, for each entity:

* "fields": all output fields.
* "relations": relation names.
* "filters": which fields can be used as filters, with:

  * "type": "string" | "number" | "boolean" | "datetime"
  * "operators": e.g. ["eq", "in", "gt", "lt", "between"]
  * "allowedValues": optional list of valid values (for enums like severity).

Schema JSON:
${schemaSnippet}

Available tools (JSON):
${toolsJson}

Your job:

* Prefer a SINGLE call to the "query_security_graph" tool whenever it can answer
  the user's request.
* Only create MULTIPLE steps when the question truly requires separate queries
  that cannot be expressed as a single query.
* Each step must be a single call to "query_security_graph".

Multi-step rules:

* If a single step can answer the user's question, use ONE step.
* If the user request naturally breaks into sub-questions involving DIFFERENT
  entities (for example CVEs vs assets), then create MULTIPLE steps.
* Do NOT create multiple steps that differ only by filter values.

CRITICAL FILTER RULES:

* DO NOT generate filters like:

  * { "cvssScore": { "gt": 7 } }
  * { "publishedAt": { "after": "2024-01-01" } }
* DO NOT generate nested relational filters except for "tags.name".
* Unsupported examples:

  * "cves.severity"
  * "cves.remediation.priority"
  * "remediation.priority"
  * arbitrary dotted relation filters

Allowed filter examples:

* { "environment": "prod" }
* { "publiclyExposed": true }
* { "runsAsRoot": true }
* { "tags.name": "auth" }

Operator filter rules:

* Structured operator filters ARE allowed when supported by the schema.
* Supported operators may include:
  * "in"
  * "gt"
  * "gte"
  * "lt"
  * "lte"
  * "before"
  * "after"
  * "between"

Examples:
{ "severity": { "in": ["HIGH", "MEDIUM"] } }
{ "cvssScore": { "gt": 7.0 } }

* Only use operators explicitly listed in the schema metadata for that field.
* Prefer a SINGLE query with operator filters instead of multiple steps.
* If multiple enum values are requested and the field supports "in",
  ALWAYS use a single "in" filter instead of separate steps.

Field selection rules:

* Only request fields that exist on the selected entity or valid relations.
* DO NOT recursively repeat relations.
* Examples of VALID field paths:

  * "name"
  * "environment"
  * "tags.name"
  * "cves.summary"
  * "cves.remediation.title"

* Examples of INVALID field paths:

  * "cves.cves.summary"
  * "tags.cves.summary"
  * "remediation.cves.summary"

Fields :

* Include only the most relevant fields.
* Avoid noisy fields like raw_data unless explicitly requested.

Limits and result size rules:

* Always set "limit" explicitly for every step.
* Default limit should be SMALL and UI-friendly.
* If the user does not explicitly request a number of records:

  * use limit = 10
* Only increase limits when the user clearly asks for:

  * many results
  * all results
  * exhaustive listings
  * bulk export
* Never use limit values above 20 unless the user explicitly requests large result sets.
* If the user says:

  * "top"
  * "recent"
  * "show"
  * "list"
  * "find"
    then prefer a small limit such as 5 or 10.
* Avoid generating limit = 100 by default.
* If unsure, use limit = 10.

Respond ONLY with JSON:
{
  "steps": [
    {
      "id": string,
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

* The user's request.
* A PLAN of MCP tool calls (steps with id, tool, arguments, description).
* The JSON result for each step.

Your task:

* Produce a concise JSON object for the UI, in ONE of these shapes:

1. Summary text only:
   {
   "type": "summary",
   "title": string,
   "text": string
   }

2. A list of items (array of objects or primitives):
   {
   "type": "list",
   "title": string,
   "items": any[]
   }

3. A data object:
   {
   "type": "data",
   "title": string,
   "data": any
   }

General guidance:

* If the plan has multiple steps, COMBINE their results into one coherent answer
  rather than presenting each step separately.
* Keep responses compact and UI-friendly.
* Never dump raw tool responses directly unless the data is already small and clean.
* Include only the most relevant fields.
* Omit noisy fields such as:

  * raw_data
  * verbose descriptions
  * long timestamps
  * internal IDs
  * deeply nested structures
* Prefer short summaries over exhaustive detail.

List guidance:

* Prefer "list" when returning multiple similar items:

  * assets
  * CVEs
  * alerts
  * remediations

Limits and result size rules:

* Always set "limit" explicitly for every step.
* Default limit should be SMALL and UI-friendly.
* If the user does not explicitly request a number of records:

  * use limit = 10
* Only increase limits when the user clearly asks for:

  * many results
  * all results
  * exhaustive listings
  * bulk export
* Never use limit values above 20 unless the user explicitly requests large result sets.
* If the user says:

  * "top"
  * "recent"
  * "show"
  * "list"
  * "find"
    then prefer a small limit such as 5 or 10.
* Avoid generating limit = 100 by default.
* If unsure, use limit = 10.


Summary guidance:

* Prefer "summary" when the main value is:

  * insight
  * comparison
  * trends
  * recommendations
  * risk analysis
  * Keep summaries concise and readable.
  * Mention important filters or limits when relevant.

Data guidance:

* Prefer "data" only when the result is naturally structured for rendering.
* Keep nested objects shallow and compact.


Fields :
* Include only the most relevant fields.
* Avoid noisy fields like raw_data unless explicitly requested.


Output rules:

* Be concise but informative.
* Return clean UI-ready JSON only.
* Respond ONLY with JSON.
* Do not include explanations, markdown, or prose outside the JSON object.  
`.trim();
}