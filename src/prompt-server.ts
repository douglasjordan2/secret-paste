import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { platform } from "node:os";
import { renderPrompt, renderDone } from "./page.ts";

export type PromptOutcome =
  | { action: "submit"; value: Buffer }
  | { action: "cancel" }
  | { action: "timeout" }
  | { action: "aborted" };

export interface PromptHandle {
  url: string;
  outcome: Promise<PromptOutcome>;
  close(): void;
}

const MAX_BODY = 64 * 1024;

export function decodeFormField(body: Buffer, field: string): Buffer | null {
  let start = 0;
  while (start <= body.length) {
    let end = body.indexOf(0x26, start);
    if (end === -1) end = body.length;
    const pair = body.subarray(start, end);
    const eq = pair.indexOf(0x3d);
    const key = eq === -1 ? pair : pair.subarray(0, eq);
    if (key.toString("latin1") === field) {
      const raw = eq === -1 ? Buffer.alloc(0) : pair.subarray(eq + 1);
      const out: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        const b = raw[i] as number;
        if (b === 0x2b) out.push(0x20);
        else if (b === 0x25 && i + 2 < raw.length + 0 && /^[0-9a-fA-F]{2}$/.test(raw.subarray(i + 1, i + 3).toString("latin1"))) {
          out.push(parseInt(raw.subarray(i + 1, i + 3).toString("latin1"), 16));
          i += 2;
        } else out.push(b);
      }
      return Buffer.from(out);
    }
    start = end + 1;
  }
  return null;
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(null));
  });
}

export function openInBrowser(url: string): void {
  const [cmd, args] =
    platform() === "darwin" ? ["open", [url]] :
    platform() === "win32" ? ["cmd", ["/c", "start", "", url]] :
    ["xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {}
}

export function startPromptServer(opts: { name: string; description?: string; target: string; timeoutMs: number }): Promise<PromptHandle> {
  const nonce = randomBytes(24).toString("base64url");
  const basePath = `/s/${nonce}`;
  let settle!: (o: PromptOutcome) => void;
  const outcome = new Promise<PromptOutcome>((r) => { settle = r; });
  let done = false;
  let expectedHost = "";

  const headers = (type: string) => ({
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    "Connection": "close",
  });

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${expectedHost}`);
    const deny = (code: number) => { res.writeHead(code, headers("text/plain")); res.end(); };

    if (req.headers.host !== expectedHost) return deny(421);
    if (done) return deny(410);

    if (req.method === "GET" && url.pathname === basePath) {
      res.writeHead(200, headers("text/html; charset=utf-8"));
      return res.end(renderPrompt({ name: opts.name, description: opts.description, action: basePath, target: opts.target }));
    }

    if (req.method === "POST" && (url.pathname === basePath || url.pathname === `${basePath}/cancel`)) {
      const origin = req.headers.origin;
      const site = req.headers["sec-fetch-site"];
      if ((origin && origin !== `http://${expectedHost}`) || (site && site !== "same-origin" && site !== "none")) {
        console.error(`secret-paste: rejected POST origin=${origin ?? "-"} sec-fetch-site=${site ?? "-"} expected=http://${expectedHost}`);
        return deny(403);
      }
      const body = await readBody(req);
      if (body === null) return deny(413);

      done = true;
      if (url.pathname.endsWith("/cancel")) {
        res.writeHead(200, headers("text/html; charset=utf-8"));
        res.end(renderDone("Cancelled"));
        body.fill(0);
        finish({ action: "cancel" });
        return;
      }
      const value = decodeFormField(body, "value");
      body.fill(0);
      res.writeHead(200, headers("text/html; charset=utf-8"));
      res.end(renderDone(`Saved ${opts.name}`));
      finish(value && value.length > 0 ? { action: "submit", value } : { action: "cancel" });
      return;
    }
    deny(404);
  });

  let timer: NodeJS.Timeout | undefined;
  function finish(o: PromptOutcome) {
    done = true;
    if (timer) clearTimeout(timer);
    settle(o);
    setTimeout(() => { server.close(); server.closeAllConnections(); }, 200).unref();
  }

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      expectedHost = `127.0.0.1:${port}`;
      timer = setTimeout(() => finish({ action: "timeout" }), opts.timeoutMs);
      timer.unref();
      resolve({
        url: `http://${expectedHost}${basePath}`,
        outcome,
        close: () => { if (!done) finish({ action: "aborted" }); },
      });
    });
  });
}
