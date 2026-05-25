// lib/mcp-planner.ts
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export type PlanStep = {
  id: string;
  tool: string;
  arguments: any;
  description: string;
};

export type Plan = {
  steps: PlanStep[];
};

export async function planTools(
  userText: string,
  tools: Record<string, any>,
): Promise<Plan> {
  const toolList = Object.entries(tools).map(([name, def]) => ({
    name,
    description: def?.description ?? "",
  }));

  const systemPrompt = `
You are a planning assistant for a vulnerability scanner backed by MCP tools.

You are given:
- A user request.
- A list of available tools (name + description).

Your job is to create a PLAN consisting of 1-3 steps.
Each step calls ONE MCP tool with JSON arguments.

Rules:
- Prefer as FEW steps as possible, but use MORE than one step when the user
  clearly asks for multiple views or comparisons, for example:
  - "compare staging vs prod"
  - "list assets AND then summarize top CVEs"
  - "first show containers, then show CVEs"
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

  const userPrompt = `
User request:
${userText}

Available tools:
${JSON.stringify(toolList, null, 2)}
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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
      Array.isArray(parsed.steps)
    ) {
      return parsed as Plan;
    }
  } catch {
    // ignore parse error
  }

  return { steps: [] };
}

export async function summarizeForUiWithPlan(
  userText: string,
  plan: Plan,
  stepResults: Record<string, any>,
) {
  
  const systemPrompt = 
  `You are a formatting assistant for a frontend UI.

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

  const userPrompt = `
User request:
${userText}

Plan:
${JSON.stringify(plan, null, 2)}

Step results:
${JSON.stringify(stepResults, null, 2)}
`.trim();

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
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