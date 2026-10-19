#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { startPromptServer, openInBrowser } from "./prompt-server.ts";
import { storeEnv } from "./targets/env.ts";
import { storeKeychain } from "./targets/keychain.ts";
import { storeOp } from "./targets/op.ts";

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const TIMEOUT_MS = 5 * 60 * 1000;

const server = new McpServer({ name: "secret-paste", version: "0.1.0" });
let busy = false;

server.registerTool(
  "request_secret",
  {
    title: "Request a secret from the user",
    description:
      "Ask the user for an API key or other secret via a local browser page. The value is stored directly to the chosen target " +
      "(.env in the working directory, the OS keychain, or 1Password) and never enters the conversation. " +
      "Afterwards, reference it indirectly (e.g. process.env.NAME); never ask the user to paste secrets in chat.",
    inputSchema: {
      name: z.string().max(128).regex(NAME_RE, "must match /^[A-Z_][A-Z0-9_]*$/"),
      target: z.enum(["env", "keychain", "op"]).default("env"),
      description: z.string().max(500).optional(),
    },
    _meta: { "anthropic/requiresUserInteraction": true },
  },
  async ({ name, target, description }, extra) => {
    const reply = (obj: Record<string, unknown>, isError = false) => ({
      content: [{ type: "text" as const, text: JSON.stringify(obj) }],
      isError,
    });
    if (busy) return reply({ name, target, stored: false, reason: "another request_secret is already pending" }, true);
    busy = true;
    let completion: (() => Promise<void>) | undefined;
    try {
      const prompt = await startPromptServer({ name, description, target, timeoutMs: TIMEOUT_MS });
      extra.signal.addEventListener("abort", () => prompt.close());

      let opened: "elicitation" | "browser";
      if (server.server.getClientCapabilities()?.elicitation?.url) {
        opened = "elicitation";
        const elicitationId = randomUUID();
        const res = await server.server.elicitInput(
          { mode: "url", message: `secret-paste needs the value for ${name}. Open the local page to enter it.`, elicitationId, url: prompt.url },
          { signal: extra.signal, timeout: TIMEOUT_MS },
        );
        if (res.action !== "accept") {
          prompt.close();
          return reply({ name, target, stored: false, reason: res.action === "decline" ? "declined" : "cancelled" });
        }
        completion = server.server.createElicitationCompletionNotifier(elicitationId);
      } else {
        opened = "browser";
        openInBrowser(prompt.url);
      }

      const outcome = await prompt.outcome;
      if (outcome.action !== "submit") {
        return reply({ name, target, stored: false, reason: outcome.action === "cancel" ? "cancelled" : outcome.action, opened });
      }
      try {
        if (target === "env") {
          const { path } = storeEnv(process.cwd(), name, outcome.value);
          return reply({ name, target, stored: true, path, readHint: `process.env.${name}`, opened });
        }
        const { readHint } = target === "keychain" ? await storeKeychain(name, outcome.value) : await storeOp(name, outcome.value);
        return reply({ name, target, stored: true, readHint, opened });
      } finally {
        outcome.value.fill(0);
      }
    } catch (err) {
      return reply({ name, target, stored: false, reason: err instanceof Error ? err.message : String(err) }, true);
    } finally {
      busy = false;
      if (completion) completion().catch(() => {});
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
