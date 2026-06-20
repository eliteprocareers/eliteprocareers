// ============================================================
// src/whatsapp/MessageRouter.ts
// Routes an incoming WhatsApp message through the AI pipeline.
// ============================================================
import { ConversationStore } from "../state/ConversationStore";
import { TenantRegistry } from "../tenants/TenantRegistry";
import { AIService } from "../ai/AIService";
import { logger } from "../utils/logger";

const RESET_KEYWORDS = ["reset", "start over", "restart", "clear", "new conversation"];

export class MessageRouter {
  private store: ConversationStore;
  private registry: TenantRegistry;
  private ai: AIService;

  constructor() {
    this.store = ConversationStore.getInstance();
    this.registry = TenantRegistry.getInstance();
    this.ai = AIService.getInstance();
  }

  async route(tenantId: string, customerJid: string, text: string): Promise<string> {
    const log = logger.child({ tenantId, customerJid });

    const config = this.registry.get(tenantId);
    if (!config) {
      log.error("Tenant not found in registry");
      return "This service is temporarily unavailable. Please contact our team directly.";
    }

    if (RESET_KEYWORDS.some((k) => text.trim().toLowerCase().includes(k))) {
      await this.store.clearState(tenantId, customerJid);
      log.info("Conversation reset by customer");
      return "No problem! I've cleared our conversation. How can I help you today?\n\nYou can ask me about:\n- Our services & prices\n- Booking an appointment\n- Our team\n- Opening hours";
    }

    let state = await this.store.getState(tenantId, customerJid);
    const isFirstMessage = !state || state.metadata.messageCount === 0;

    const systemPrompt = this.registry.buildSystemPrompt(tenantId);

    state = await this.store.appendMessage(tenantId, customerJid, {
      role: "user",
      content: text,
      timestamp: Date.now(),
    });

    let reply: string;
    try {
      if (isFirstMessage) {
        reply = await this.ai.chat(
          tenantId,
          systemPrompt,
          [],
          `[FIRST CONTACT] Customer's first message: "${text}"\n\nGreet them warmly and help with their query.`
        );
      } else {
        reply = await this.ai.chat(
          tenantId,
          systemPrompt,
          state.messages.slice(0, -1),
          text
        );
      }
    } catch (err: unknown) {
      const error = err as { status?: number; message?: string };
      log.error({ err }, "AI call failed");

      if (error?.status === 429) {
        return "I'm currently handling a high volume of messages. Please try again in a moment!";
      }
      return "I'm having a brief technical issue. Please try again shortly, or contact our team directly.";
    }

    await this.store.appendMessage(tenantId, customerJid, {
      role: "assistant",
      content: reply,
      timestamp: Date.now(),
    });

    log.debug("Message routed successfully");
    return reply;
  }
}
