// ============================================================
// src/index.ts - Application bootstrap
// ============================================================
import "dotenv/config";
import { logger } from "./utils/logger";
import { TenantRegistry } from "./tenants/TenantRegistry";
import { ConversationStore } from "./state/ConversationStore";
import { SessionManager } from "./whatsapp/SessionManager";
import { createApiServer } from "./api/server";
import { eliteproConfig } from "./tenants/eliteproConfig";

async function main() {
  logger.info("Salon AI Platform starting...");

  const required = ["GROQ_API_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.fatal({ missing }, "Missing required environment variables");
    process.exit(1);
  }

  const store = ConversationStore.getInstance();
  await store.connect();

  const registry = TenantRegistry.getInstance();
  registry.register(eliteproConfig);
  logger.info({ tenantId: eliteproConfig.tenantId }, "Auto-registered tenant from config");

  const sessionManager = SessionManager.getInstance();

  await sessionManager.restorePersistedSessions();

  const port = parseInt(process.env.PORT ?? "3000", 10);
  const httpServer = createApiServer(sessionManager);
  httpServer.listen(port, () => {
    logger.info("API server listening on http://localhost:" + port);
    logger.info("Admin dashboard: GET /dashboard (requires X-Admin-Secret header)");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down gracefully...");
    const sessions = sessionManager.getAllStatuses();
    for (const s of sessions) {
      await sessionManager.removeSession(s.tenantId).catch(() => {});
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled promise rejection");
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
});
