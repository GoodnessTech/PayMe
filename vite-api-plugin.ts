// Dev-only Vite plugin: serves the Vercel-style /api functions (api/*.ts, which
// export Web-standard GET/POST handlers) from the Vite dev server, so
// `npm run dev` runs frontend + API with one command and no Vercel login.
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { loadEnv, type Plugin } from "vite";

type Handler = (request: Request) => Promise<Response> | Response;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function apiDevServer(): Plugin {
  return {
    name: "payme-api-dev-server",
    apply: "serve",
    configureServer(server) {
      // Server-side env for the handlers (all vars, not just VITE_*). This only
      // touches the dev server's process.env; the client bundle still sees VITE_* only.
      const env = loadEnv(server.config.mode, server.config.root, "");
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        const name = url.pathname.slice("/api/".length).replace(/\/$/, "");
        const file = path.join(server.config.root, "api", `${name}.ts`);
        if (!/^[a-z0-9-]+$/.test(name) || !existsSync(file)) return send(res, 404, { error: "Not found" });
        try {
          const mod = (await server.ssrLoadModule(file)) as Record<string, unknown>;
          const method = (req.method ?? "GET").toUpperCase();
          const handler = mod[method] as Handler | undefined;
          if (typeof handler !== "function") return send(res, 405, { error: `Method ${method} not allowed` });

          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
          }
          const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
          const request = new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, { method, headers, body });
          const response = await handler(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
          server.config.logger.error(`[api] ${name}: ${err instanceof Error ? err.message : String(err)}`);
          send(res, 500, { error: "Internal server error" });
        }
      });
    },
  };
}
