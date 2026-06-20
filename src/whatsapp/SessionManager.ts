// ============================================================
// src/whatsapp/SessionManager.ts
// Singleton that owns and orchestrates all active sessions.
// ============================================================
import { EventEmitter } from "events";
import { createClient } from "redis";
import { WhatsAppSession } from "./WhatsAppSession";
import { MessageRouter } from "./MessageRouter";
import { TenantRegistry } from "../tenants/TenantRegistry";
import { TenantSession } from "../types";
import { logger } from "../utils/logger";

export class SessionManager extends EventEmitter {
  private sessions: Map<string, WhatsAppSession> = new Map();
  private router: MessageRouter;
  private registry: TenantRegistry;
  private static instance: SessionManager;

  private constructor() {
    super();
    this.router = new MessageRouter();
    this.registry = TenantRegistry.getInstance();
  }

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  async addSession(tenantId: string): Promise<WhatsAppSession> {
    if (this.sessions.has(tenantId)) {
      logger.warn({ tenantId }, "Session already exists - returning existing");
      return this.sessions.get(tenantId)!;
    }

    const session = new WhatsAppSession(tenantId, this.router);

    session.on("status_update", (data: TenantSession) => this.emit("status_update", data));
    session.on("qr", (data) => this.emit("qr", data));
    session.on("ready", (data) => {
      this.registry.update(tenantId, { phoneNumber: data.number });
      this.emit("ready", data);
    });
    session.on("logged_out", (data) => {
      logger.error({ tenantId }, "Tenant logged out - removing session");
      this.sessions.delete(tenantId);
      this.emit("logged_out", data);
    });
    session.on("max_retries", (data) => {
      logger.error({ tenantId }, "Max reconnect attempts - session halted");
      this.emit("session_halted", data);
    });

    this.sessions.set(tenantId, session);
    await session.start();
    return session;
  }

  async removeSession(tenantId: string): Promise<void> {
    const session = this.sessions.get(tenantId);
    if (!session) return;
    await session.stop();
    this.sessions.delete(tenantId);
    logger.info({ tenantId }, "Session removed");
  }

  async logoutSession(tenantId: string): Promise<void> {
    const session = this.sessions.get(tenantId);
    if (!session) throw new Error("Session " + tenantId + " not found");
    await session.logout();
    this.sessions.delete(tenantId);
  }

  getSession(tenantId: string): WhatsAppSession | undefined {
    return this.sessions.get(tenantId);
  }

  getAllStatuses(): TenantSession[] {
    return Array.from(this.sessions.values()).map((s) => s.getStatus());
  }

  // Restores sessions by checking Redis for existing auth data
  // for each registered tenant, instead of scanning local folders.
  async restorePersistedSessions(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      logger.warn("REDIS_URL not set - skipping session restore");
      return;
    }

    const client = createClient({ url });
    await client.connect();

    const tenants = this.registry.getAll();
    let restored = 0;

    for (const tenant of tenants) {
      const keys = await client.keys(`wa:auth:${tenant.tenantId}:creds`);
      if (keys.length > 0) {
        logger.info({ tenantId: tenant.tenantId }, "Restoring session from Redis");
        await this.addSession(tenant.tenantId).catch((err) =>
          logger.error({ tenantId: tenant.tenantId, err }, "Failed to restore session")
        );
        restored += 1;
      }
    }

    logger.info(`Restored ${restored} of ${tenants.length} tenant session(s)`);
    await client.quit();
  }
}
