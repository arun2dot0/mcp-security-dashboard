# MCP Security Copilot (Next.js Demo)

This is a [Next.js](https://nextjs.org) demo app that connects to a Model Context Protocol (MCP) server and lets you ask questions about container assets and vulnerabilities. It supports both REST and GraphQL MCP backends and uses [shadcn/ui](https://ui.shadcn.com) for the UI.

## Getting Started

Install dependencies:

```bash
npm install
```

Start the Next.js dev server:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## MCP Client & SDK

Install the MCP client SDKs used by the app:

```bash
npm install @ai-sdk/mcp @modelcontextprotocol/sdk
```

The Next.js API routes use these packages to talk to the MCP server over HTTP.

## shadcn/ui and Theming Setup

Initialize shadcn if you haven’t already:

```bash
npx shadcn@latest init
```

Add the UI components used in this app:

```bash
npx shadcn@latest add card
npx shadcn@latest add input
npx shadcn@latest add button
npx shadcn@latest add scroll-area
npx shadcn@latest add separator
npx shadcn@latest add badge
npx shadcn@latest add dropdown-menu
```

Install theme support:

```bash
npm install next-themes
```

The app uses `next-themes` together with shadcn’s Tailwind tokens to support light/dark mode.
## Setup OPENAI_API_KEY

setup the key in .env.local

OPENAI_API_KEY=your_openapi_key

## Running With GraphQL MCP Backend

To route the app through your GraphQL-based MCP server, set:

```bash
export MCP_HTTP_URL=http://127.0.0.1:8000/mcp
export MCP_BACKEND=graph
```

Then (re)start the Next.js dev server:

```bash
npm run dev
```

## Running With REST MCP Backend

To route the app through your REST-based MCP server, set:

```bash
export MCP_HTTP_URL=http://127.0.0.1:8001/mcp
export MCP_BACKEND=rest
```

Then (re)start the Next.js dev server:

```bash
npm run dev
```

The app will read `MCP_HTTP_URL` to know where the MCP server is listening and `MCP_BACKEND` to decide how to prompt the LLM (REST-style vs GraphQL-style routing).

## Prompts 

### complex
find public containers with critical cves and have high priority remediations
Generate a prioritized remediation plan for production assets, grouped by severity and estimated effort.
For each namespace, summarize the most dangerous asset, the main CVEs, and the most actionable remediation steps
Generate a prioritized remediation plan for production assets, grouped by severity and estimated effort

### simple
List all public container assets in prod with CVEs and severity.
find public containers that are also root --
find name and environment for container assets with tag auth --
Give me recent CRITICAL CVEs affecting my containers.

