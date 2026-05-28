// app/page.tsx
"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ModeToggle } from "@/components/mode-toggle"; // optional theme toggle

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type UiList = {
  type: "list";
  title: string;
  items: any[];
};

type UiData = {
  type: "data";
  title: string;
  data: any;
};

type UiSummary = {
  type: "summary";
  title: string;
  text: string;
};

type UiResponse = UiList | UiData | UiSummary;

function severityBadge(sev: string) {
  const s = sev.toUpperCase();
  if (s === "CRITICAL") {
    return (
      <Badge variant="destructive" className="text-[10px]">
        {s}
      </Badge>
    );
  }
  if (s === "HIGH") {
    return (
      <Badge variant="destructive" className="bg-red-500/80 text-[10px]">
        {s}
      </Badge>
    );
  }
  if (s === "MEDIUM") {
    return (
      <Badge variant="outline" className="border-amber-500/70 text-amber-500 text-[10px]">
        {s}
      </Badge>
    );
  }
  if (s === "LOW") {
    return (
      <Badge variant="outline" className="border-emerald-500/70 text-emerald-500 text-[10px]">
        {s}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px]">
      {sev}
    </Badge>
  );
}


  type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function JsonRenderer({ value }: { value: JsonValue }) {
  // Null or undefined
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">null</span>;
  }

  // Primitive
  if (typeof value !== "object") {
    return <span>{String(value)}</span>;
  }

  // Array
  if (Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {value.map((item, idx) => (
          <div key={idx} className="pl-2 border-l border-border">
            <JsonRenderer value={item} />
          </div>
        ))}
      </div>
    );
  }

  // Object: key/value pairs, nested renderer
  const entries = Object.entries(value);
  return (
    <div className="rounded-md border border-border bg-card p-2 text-xs space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1">
          <span className="font-semibold text-muted-foreground">{k}:</span>
          <div className="flex-1">
            <JsonRenderer value={v} />
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  let parsed: UiResponse | null = null;
  try {
    const obj = JSON.parse(message.content);
    if (obj && typeof obj === "object" && "type" in obj && "title" in obj) {
      parsed = obj as UiResponse;
    }
  } catch {
    // not JSON UI payload
  }

  if (parsed) {
    if (parsed.type === "summary") {
      return (
        <Card className="inline-block max-w-full bg-muted">
          <CardHeader className="py-2">
            <CardTitle className="text-sm">{parsed.title}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {parsed.text}
            </p>
          </CardContent>
        </Card>
      );
    }

    if (parsed.type === "list") {
      return (
        <Card className="inline-block max-w-full bg-muted">
          <CardHeader className="py-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">{parsed.title}</CardTitle>
            <Badge variant="outline" className="text-[10px]">
              {parsed.items.length} items
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            <JsonRenderer value={parsed.items} />
          </CardContent>
        </Card>
      );
    }

    if (parsed.type === "data") {
      return (
        <Card className="inline-block max-w-full bg-muted">
          <CardHeader className="py-2">
            <CardTitle className="text-sm">{parsed.title}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <JsonRenderer value={parsed.data} />
          </CardContent>
        </Card>
      );
    }
  }

  const isUser = message.role === "user";
  return (
    <div
      className={
        "inline-block max-w-full rounded-2xl px-3 py-2 text-sm " +
        (isUser
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground")
      }
    >
      <pre className="whitespace-pre-wrap text-sm overflow-x-auto">
        {message.content}
      </pre>
    </div>
  );
}

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hi! Ask me about container assets or vulnerabilities, and I will call the MCP tools.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const nextMessages = [...messages, { role: "user", content: input }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: nextMessages }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      if (Array.isArray(data.messages)) {
        setMessages(data.messages);
      } else {
        console.error("Unexpected response shape", data);
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Error calling MCP chat API." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function runPreset(question: string) {
    setInput(question);
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40 text-foreground flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border/60 px-4 py-3 flex items-center justify-between bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs font-bold">
            MCP
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight">
              Security Copilot
            </span>
            <span className="text-[11px] text-muted-foreground">
              Backed by your MCP demo (REST + GraphQL).
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ModeToggle />
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 px-4 py-6 max-w-6xl mx-auto w-full">
        {/* Left panel: presets */}
        <div className="w-full lg:w-72 flex-shrink-0 space-y-3">
          <Card className="h-full border-border/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Quick queries</CardTitle>
              <CardDescription className="text-[11px]">
                Use these as starting points for your demo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={() =>
                  runPreset(
                    "List all public container assets in prod with CVEs and severity.",
                  )
                }
              >
                Public prod containers with CVEs
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={() =>
                  runPreset(
                    "Show containers running as root and summarize their CVEs.",
                  )
                }
              >
                Containers running as root
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={() =>
                  runPreset(
                    "Give me recent CRITICAL CVEs affecting my containers.",
                  )
                }
              >
                Recent CRITICAL CVEs
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={() =>
                  runPreset(
                    "Generate a prioritized remediation plan for production assets, grouped by severity and estimated effort.",
                  )
                }
              >
                Complex Remediation Query
              </Button>

              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={() =>
                  runPreset(
                    "Find assets that are both internet-facing and running as root, then return only critical or high CVEs with fix guidance.",
                  )
                }
              >
                Complex Assets with CVE Query
              </Button>

               <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={() =>
                  runPreset(
                    "Rank assets by a custom risk score using severity, public exposure, root usage, and critical tags.",
                  )
                }
              >
                Complex Assets with Risk Assessment
              </Button> 

              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs"
                onClick={() =>
                  runPreset(
                    "find namespace in container assets and using the corresponding cve's find the highest risky namespace.",
                  )
                }
              >
                Analyze Highrisk namespace
              </Button> 

              
            </CardContent>
          </Card>
        </div>

        {/* Right panel: chat */}
        <div className="flex-1 flex flex-col">
          <Card className="flex-1 flex flex-col shadow-lg border-border/70">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                Ask about container assets & CVEs
              </CardTitle>
              <CardDescription className="text-[11px]">
                The assistant routes your question to the appropriate MCP tool
                and returns a structured summary.
              </CardDescription>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4 flex-1 flex flex-col">
              <ScrollArea className="h-[420px] pr-2">
                <div className="flex flex-col gap-3">
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={
                        "flex " +
                        (m.role === "user" ? "justify-end" : "justify-start")
                      }
                    >
                      <MessageBubble message={m} />
                    </div>
                  ))}

                  {loading && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-block h-3 w-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
                      <span>Thinking…</span>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
            <Separator />
            <CardFooter className="pt-3">
              <form
                onSubmit={sendMessage}
                className="flex w-full items-center gap-2"
              >
                <Input
                  className="text-sm"
                  placeholder="Ask about container assets or CVEs..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={loading}
                />
                <Button type="submit" size="sm" disabled={loading}>
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      <span>Sending</span>
                    </span>
                  ) : (
                    "Send"
                  )}
                </Button>
              </form>
            </CardFooter>
          </Card>
        </div>
      </div>
    </main>
  );
}