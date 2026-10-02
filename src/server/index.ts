import { createApp } from "./app.js";

const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT 必须是 1–65535 的整数");
const { app } = await createApp({
  port,
  development:
    process.env.NODE_ENV !== "production" && import.meta.url.endsWith(".ts"),
  logger: true,
});
await app.listen({ host: "127.0.0.1", port });
console.log(`TraceLens: http://127.0.0.1:${port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
