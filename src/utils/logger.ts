// ============================================================
// src/utils/logger.ts — Structured logger
// ============================================================
import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } }
      : undefined,
});

export const tenantLogger = (tenantId: string) =>
  logger.child({ tenantId });
