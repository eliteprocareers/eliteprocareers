// ============================================================
// src/whatsapp/WhatsAppSession.ts
// Manages a single Baileys session for one tenant.
// Auth state is stored in Redis so it survives restarts.
// ============================================================
import {
  makeWASocket,
  DisconnectReason,
  WASocket,
  proto,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { EventEmitter } from "events";
import pino from "pino";

import { TenantSession, SessionStatus } from "../types";
import { tenantLogger } from "../utils/logger";
import { MessageRouter } from "./MessageRouter";
import { useRedisAuthState } from "./useRedisAuthState";

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;

export class WhatsAppSession extends EventEmitter {
  readonly tenantId: string;
  private socket: WASocket | null = null;
  private sessionStatus: SessionStatus = "INITIALIZING";
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private qrCode: string | undefined;
  private connectedNumber: string | undefined;
  private router: MessageRouter;
  private log = tenantLogger("unknown");
  private clearAuthFn: (() => Promise<void>) | null = null;

  constructor(tenantId: string, router: MessageRouter) {
    super();
    this.tenantId = tenantId;
    this.router = router;
    this.log = tenantLogger(tenantId);
  }

  async start(): Promise<void> {
    this.log.info("Starting WhatsApp session");
    this.sessionStatus = "INITIALIZING";
    await this.createSocket();
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.end(undefined);
    this.socket = null;
    this.sessionStatus = "DISCONNECTED";
    this.log.info("Session stopped");
  }

  async logout(): Promise<void> {
    await this.socket?.logout();
    await this.stop();
    if (this.clearAuthFn) {
      await this.clearAuthFn();
    }
    this.log.info("Session logged out and credentials wiped from Redis");
  }

  private async createSocket(): Promise<void> {
    const { state, saveCreds, clearAuthState } = await useRedisAuthState(
      this.tenantId
    );
    this.clearAuthFn = clearAuthState;

    const { version } = await fetchLatestBaileysVersion();

    const silentLogger = pino({ level: "silent" });

    this.socket = makeWASocket({
      version,
      logger: silentLogger,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      printQRInTerminal: false,
      browser: ["SalonAI", "Chrome", "1.0.0"],
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      markOnlineOnConnect: false,
    });

    this.socket.ev.on("creds.update", saveCreds);

    this.socket.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.log.info("QR code received - awaiting scan");
        this.sessionStatus = "QR_READY";
        this.qrCode = await qrcode.toDataURL(qr);

        if (process.env.QR_TERMINAL === "true") {
          qrcodeTerminal.generate(qr, { small: true }, (qrString: string) => {
            console.log("\n=== QR for tenant: " + this.tenantId + " ===\n" + qrString + "\n");
          });
        }

        this.emit("qr", { tenantId: this.tenantId, qrCode: this.qrCode });
        this.emitStatus();
      }

      if (connection === "open") {
        this.log.info("WhatsApp connection established");
        this.reconnectAttempts = 0;
        this.sessionStatus = "READY";
        this.connectedNumber = this.socket?.user?.id?.split(":")[0];
        this.qrCode = undefined;
        this.emit("ready", { tenantId: this.tenantId, number: this.connectedNumber });
        this.emitStatus();
      }

      if (connection === "close") {
        const boom = lastDisconnect?.error as Boom | undefined;
        const statusCode = boom?.output?.statusCode;

        this.log.warn({ statusCode }, "Connection closed");

        if (statusCode === DisconnectReason.loggedOut) {
          this.log.error("Session logged out - manual re-scan required");
          this.sessionStatus = "BANNED";
          this.emit("logged_out", { tenantId: this.tenantId });
          this.emitStatus();
          return;
        }

        this.scheduleReconnect();
      }
    });

    this.socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        await this.handleIncomingMessage(msg);
      }
    });
  }

  private async handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
    if (msg.key.fromMe) return;
    if (msg.key.remoteJid === "status@broadcast") return;
    if (msg.key.remoteJid?.endsWith("@g.us")) return;

    const customerJid = msg.key.remoteJid!;
    const text =
      msg.message?.conversation ??
      msg.message?.extendedTextMessage?.text ??
      msg.message?.buttonsResponseMessage?.selectedDisplayText;

    if (!text) return;

    this.log.info({ customerJid, textLength: text.length }, "Incoming message");

    try {
      await this.socket?.sendPresenceUpdate("composing", customerJid);

      const reply = await this.router.route(this.tenantId, customerJid, text);

      await this.socket?.sendPresenceUpdate("paused", customerJid);
      await this.sendMessage(customerJid, reply);
    } catch (err) {
      this.log.error({ err, customerJid }, "Error processing message");
      await this.sendMessage(
        customerJid,
        "Sorry, I'm having a brief technical issue. Please try again in a moment."
      );
    }
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket || this.sessionStatus !== "READY") {
      throw new Error("Session " + this.tenantId + " is not ready");
    }
    await this.socket.sendMessage(jid, { text });
    this.log.debug({ jid }, "Message sent");
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.log.error("Max reconnect attempts reached - manual intervention required");
      this.sessionStatus = "DISCONNECTED";
      this.emit("max_retries", { tenantId: this.tenantId });
      this.emitStatus();
      return;
    }

    this.reconnectAttempts += 1;
    const delay = RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);
    this.sessionStatus = "RECONNECTING";
    this.emitStatus();

    this.log.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      "Scheduling reconnect"
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.createSocket();
      } catch (err) {
        this.log.error({ err }, "Reconnect failed");
        this.scheduleReconnect();
      }
    }, delay);
  }

  private emitStatus(): void {
    const session: TenantSession = {
      tenantId: this.tenantId,
      status: this.sessionStatus,
      qrCode: this.qrCode,
      connectedNumber: this.connectedNumber,
      reconnectAttempts: this.reconnectAttempts,
      lastSeen: new Date(),
    };
    this.emit("status_update", session);
  }

  getStatus(): TenantSession {
    return {
      tenantId: this.tenantId,
      status: this.sessionStatus,
      qrCode: this.qrCode,
      connectedNumber: this.connectedNumber,
      reconnectAttempts: this.reconnectAttempts,
      lastSeen: new Date(),
    };
  }
}
