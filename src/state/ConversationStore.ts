// ============================================================
// src/state/ConversationStore.ts
// Redis-backed conversation history.
// Falls back to in-memory Map if Redis is unavailable.
// ============================================================
import { createClient, RedisClientType } from "redis";
import { ConversationState, ConversationMessage } from "../types";
import { logger } from "../utils/logger";

const TTL = parseInt(process.env.CONVERSATION_TTL_SECONDS ?? "3600", 10);
const MAX_HISTORY = 20;

export class ConversationStore {
  private redis: RedisClientType | null = null;
  private memStore: Map<string, ConversationState> = new Map();
  private static instance: ConversationStore;
  private redisAvailable = false;

  private constructor() {}

  static getInstance(): ConversationStore {
    if (!ConversationStore.instance) {
      ConversationStore.instance = new ConversationStore();
    }
    return ConversationStore.instance;
  }

  async connect(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      logger.warn("REDIS_URL not set - using in-memory conversation store");
      return;
    }
    try {
      this.redis = createClient({ url }) as RedisClientType;
      this.redis.on("error", (err) => {
        logger.error({ err }, "Redis error - falling back to in-memory store");
        this.redisAvailable = false;
      });
      this.redis.on("ready", () => {
        this.redisAvailable = true;
        logger.info("Redis connected");
      });
      await this.redis.connect();
    } catch (err) {
      logger.warn({ err }, "Could not connect to Redis - using in-memory store");
    }
  }

  private key(tenantId: string, customerPhone: string): string {
    const phone = customerPhone.split("@")[0];
    return `conv:${tenantId}:${phone}`;
  }

  async getState(tenantId: string, customerPhone: string): Promise<ConversationState | null> {
    const k = this.key(tenantId, customerPhone);

    if (this.redis && this.redisAvailable) {
      const raw = await this.redis.get(k);
      return raw ? (JSON.parse(raw) as ConversationState) : null;
    }
    return this.memStore.get(k) ?? null;
  }

  async setState(state: ConversationState): Promise<void> {
    const k = this.key(state.tenantId, state.customerPhone);

    if (state.messages.length > MAX_HISTORY) {
      state.messages = state.messages.slice(-MAX_HISTORY);
    }

    if (this.redis && this.redisAvailable) {
      await this.redis.set(k, JSON.stringify(state), { EX: TTL });
    } else {
      this.memStore.set(k, state);
    }
  }

  async appendMessage(
    tenantId: string,
    customerPhone: string,
    message: ConversationMessage
  ): Promise<ConversationState> {
    let state = await this.getState(tenantId, customerPhone);

    if (!state) {
      state = {
        tenantId,
        customerPhone,
        messages: [],
        metadata: {
          lastActivity: Date.now(),
          messageCount: 0,
        },
      };
    }

    state.messages.push(message);
    state.metadata.lastActivity = Date.now();
    state.metadata.messageCount += 1;

    await this.setState(state);
    return state;
  }

  async clearState(tenantId: string, customerPhone: string): Promise<void> {
    const k = this.key(tenantId, customerPhone);
    if (this.redis && this.redisAvailable) {
      await this.redis.del(k);
    } else {
      this.memStore.delete(k);
    }
  }

  async listActiveConversations(tenantId: string): Promise<string[]> {
    if (this.redis && this.redisAvailable) {
      const keys = await this.redis.keys(`conv:${tenantId}:*`);
      return keys.map((k) => k.split(":")[2]);
    }
    return Array.from(this.memStore.keys())
      .filter((k) => k.startsWith(`conv:${tenantId}:`))
      .map((k) => k.split(":")[2]);
  }
}
