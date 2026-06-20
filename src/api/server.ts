// ============================================================
// src/api/server.ts
// REST API for the admin dashboard + Socket.IO real-time events.
// ============================================================
import express, { Request, Response, NextFunction } from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { SessionManager } from "../whatsapp/SessionManager";
import { TenantRegistry } from "../tenants/TenantRegistry";
import { ConversationStore } from "../state/ConversationStore";
import { RegisterTenantPayload } from "../types";
import { logger } from "../utils/logger";

const ADMIN_SECRET = process.env.ADMIN_SECRET ?? "change-me";

export function createApiServer(sessionManager: SessionManager) {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
  });

  const registry = TenantRegistry.getInstance();
  const store = ConversationStore.getInstance();

  app.use(express.json());
  app.use(requestLogger);

  function adminOnly(req: Request, res: Response, next: NextFunction): void {
    const secret = req.headers["x-admin-secret"];
    if (secret !== ADMIN_SECRET) {
      res.status(401).json({ success: false, error: "Unauthorized" });
      return;
    }
    next();
  }

  function requestLogger(req: Request, _res: Response, next: NextFunction) {
    logger.debug({ method: req.method, url: req.url }, "API request");
    next();
  }

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", sessions: sessionManager.getAllStatuses().length });
  });

  app.post("/tenants", adminOnly, async (req: Request, res: Response) => {
    const payload = req.body as RegisterTenantPayload;

    if (!payload.tenantId || !payload.salonConfig) {
      res.status(400).json({ success: false, error: "tenantId and salonConfig are required" });
      return;
    }

    try {
      registry.register({ ...payload.salonConfig, tenantId: payload.tenantId });
      await sessionManager.addSession(payload.tenantId);
      res.status(201).json({ success: true, data: { tenantId: payload.tenantId } });
    } catch (err: unknown) {
      const error = err as Error;
      logger.error({ err, tenantId: payload.tenantId }, "Failed to register tenant");
      res.status(500).json({ success: false, error: error?.message });
    }
  });

  app.get("/tenants", adminOnly, (_req: Request, res: Response) => {
    const tenants = registry.getAll().map((t) => ({
      tenantId: t.tenantId,
      salonName: t.salonName,
      phoneNumber: t.phoneNumber,
    }));
    res.json({ success: true, data: tenants });
  });

  app.get("/tenants/:tenantId/status", adminOnly, (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.tenantId);
    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }
    res.json({ success: true, data: session.getStatus() });
  });

  app.post(
    "/tenants/:tenantId/sessions/restart",
    adminOnly,
    async (req: Request, res: Response) => {
      const { tenantId } = req.params;
      try {
        await sessionManager.removeSession(tenantId);
        await sessionManager.addSession(tenantId);
        res.json({ success: true, data: { message: "Session restarting" } });
      } catch (err: unknown) {
        const error = err as Error;
        res.status(500).json({ success: false, error: error?.message });
      }
    }
  );

  app.delete(
    "/tenants/:tenantId/sessions",
    adminOnly,
    async (req: Request, res: Response) => {
      try {
        await sessionManager.logoutSession(req.params.tenantId);
        res.json({ success: true, data: { message: "Logged out" } });
      } catch (err: unknown) {
        const error = err as Error;
        res.status(500).json({ success: false, error: error?.message });
      }
    }
  );

  app.delete("/tenants/:tenantId", adminOnly, async (req: Request, res: Response) => {
    const { tenantId } = req.params;
    await sessionManager.removeSession(tenantId);
    registry.remove(tenantId);
    res.json({ success: true, data: { message: "Tenant removed" } });
  });

  app.get(
    "/tenants/:tenantId/conversations/:customerPhone",
    adminOnly,
    async (req: Request, res: Response) => {
      const { tenantId, customerPhone } = req.params;
      const state = await store.getState(tenantId, customerPhone + "@s.whatsapp.net");
      if (!state) {
        res.status(404).json({ success: false, error: "No conversation found" });
        return;
      }
      res.json({ success: true, data: state });
    }
  );

  app.delete(
    "/tenants/:tenantId/conversations/:customerPhone",
    adminOnly,
    async (req: Request, res: Response) => {
      const { tenantId, customerPhone } = req.params;
      await store.clearState(tenantId, customerPhone + "@s.whatsapp.net");
      res.json({ success: true, data: { message: "Conversation cleared" } });
    }
  );

  app.post("/tenants/:tenantId/send", adminOnly, async (req: Request, res: Response) => {
    const { tenantId } = req.params;
    const { customerPhone, message } = req.body as { customerPhone: string; message: string };

    if (!customerPhone || !message) {
      res.status(400).json({ success: false, error: "customerPhone and message required" });
      return;
    }

    const session = sessionManager.getSession(tenantId);
    if (!session) {
      res.status(404).json({ success: false, error: "Session not found" });
      return;
    }

    try {
      await session.sendMessage(customerPhone + "@s.whatsapp.net", message);
      res.json({ success: true, data: { message: "Sent" } });
    } catch (err: unknown) {
      const error = err as Error;
      res.status(500).json({ success: false, error: error?.message });
    }
  });

  app.get("/dashboard", adminOnly, (_req: Request, res: Response) => {
    const sessions = sessionManager.getAllStatuses();
    const tenants = registry.getAll();
    res.json({
      success: true,
      data: {
        totalTenants: tenants.length,
        sessions: sessions.map((s) => ({
          tenantId: s.tenantId,
          status: s.status,
          connectedNumber: s.connectedNumber,
          reconnectAttempts: s.reconnectAttempts,
        })),
      },
    });
  });

  io.use((socket, next) => {
    const secret = socket.handshake.auth.adminSecret;
    if (secret !== ADMIN_SECRET) {
      next(new Error("Unauthorized"));
    } else {
      next();
    }
  });

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "Admin dashboard connected via WebSocket");
    socket.emit("all_statuses", sessionManager.getAllStatuses());
    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "Dashboard disconnected");
    });
  });

  sessionManager.on("status_update", (data) => io.emit("status_update", data));
  sessionManager.on("qr", (data) => io.emit("qr", data));
  sessionManager.on("ready", (data) => io.emit("session_ready", data));
  sessionManager.on("logged_out", (data) => io.emit("session_logged_out", data));
  sessionManager.on("session_halted", (data) => io.emit("session_halted", data));

  return httpServer;
}
