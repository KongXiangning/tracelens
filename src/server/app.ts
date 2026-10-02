import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { AppError, dataDirectory, validate } from "./config.js";
import { ProjectRegistry } from "./registry.js";
import { discover } from "./scanner.js";
import { SnapshotStore } from "./snapshot.js";
import { browseDirectories, codexProjects } from "./project-sources.js";

export interface AppOptions {
  dataDir?: string;
  port?: number;
  development?: boolean;
  webRoot?: string;
  logger?: boolean;
  codexHome?: string;
}
export async function createApp(options: AppOptions = {}) {
  const app = Fastify({
    logger: options.logger || false,
    bodyLimit: 128 * 1024,
  });
  const registry = new ProjectRegistry(options.dataDir || dataDirectory());
  await registry.load();
  const store = new SnapshotStore(registry);
  const token = randomBytes(32).toString("hex");
  app.addHook("onRequest", async (request, reply) => {
    const port =
      (app.server.address() as { port?: number } | null)?.port ||
      options.port ||
      4317;
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    if (options.development) {
      hosts.add("127.0.0.1:5173");
      hosts.add("localhost:5173");
    }
    const host = request.headers.host || "";
    if (!hosts.has(host.toLowerCase()))
      throw new AppError("Host 不在本地服务允许范围内", 403);
    if (
      request.headers.origin &&
      ![...hosts].some((h) => request.headers.origin === `http://${h}`)
    )
      throw new AppError("Origin 不在本地服务允许范围内", 403);
    if (request.headers["sec-fetch-site"] === "cross-site")
      throw new AppError("拒绝跨站请求", 403);
    if (!["GET", "HEAD"].includes(request.method)) {
      const supplied = request.headers["x-tracelens-token"];
      if (
        typeof supplied !== "string" ||
        Buffer.byteLength(supplied) !== token.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        throw new AppError("会话令牌无效，请重新加载页面", 403);
      if (!request.headers["content-type"]?.startsWith("application/json"))
        throw new AppError("仅接受 JSON 请求", 415);
    }
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    if (!options.development)
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      );
  });
  app.setErrorHandler((error, _request, reply) => {
    const detail = error as Error & { statusCode?: number };
    const status =
      error instanceof AppError ? error.statusCode : detail.statusCode || 500;
    reply.code(status).send({ error: detail.message || "服务请求失败" });
  });
  app.get("/api/session", async () => ({ token, dataDir: registry.dataDir }));
  app.get("/api/projects", async () => registry.list());
  app.post("/api/project-sources/codex", async () =>
    codexProjects(registry.list(), registry.dataDir, options.codexHome),
  );
  app.post("/api/project-sources/directories", async (request) => {
    const input = validate(
      z.object({ path: z.string().trim().min(1).max(2000).optional() }),
      request.body,
    );
    return browseDirectories(input.path, registry.dataDir);
  });
  app.post("/api/discover", async (request) => {
    const { root } = validate(
      z.object({ root: z.string().trim().min(1).max(2000) }),
      request.body,
    );
    return discover(root, registry.dataDir);
  });
  app.post("/api/projects", async (request, reply) => {
    const project = await registry.add(request.body);
    reply.code(201);
    return project;
  });
  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request) =>
    registry.update(request.params.id, request.body),
  );
  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (request) => {
      if (store.view(request.params.id).attempt?.state === "scanning")
        throw new AppError("请等待扫描结束后移除项目", 409);
      await registry.remove(request.params.id);
      store.remove(request.params.id);
      return { removed: true };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/snapshot",
    async (request) => store.view(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/refresh",
    async (request) => store.refresh(request.params.id),
  );
  app.get<{
    Params: { id: string; documentId: string };
    Querystring: { snapshotId?: string };
  }>("/api/projects/:id/documents/:documentId", async (request) =>
    store.document(
      request.params.id,
      request.params.documentId,
      request.query.snapshotId,
    ),
  );
  const webRoot =
    options.webRoot || fileURLToPath(new URL("../web", import.meta.url));
  try {
    await access(path.join(webRoot, "index.html"));
    await app.register(fastifyStatic, { root: webRoot });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith("/api/") ||
        path.extname(request.url.split("?")[0])
      )
        return reply.code(404).send({ error: "未找到资源" });
      return reply.sendFile("index.html");
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    app.get("/", async (_request, reply) =>
      reply.code(503).send({
        error: "尚未构建界面。开发使用 npm run dev，生产先执行 npm run build。",
      }),
    );
  }
  return { app, registry, store };
}
