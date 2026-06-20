// ============================================================
// src/ai/AIService.ts
// Wraps Groq (free tier, OpenAI-compatible API) with
// per-tenant rate limiting and conversation history.
// ============================================================
import axios from "axios";
import PQueue from "p-queue";
import { ConversationMessage } from "../types";
import { logger } from "../utils/logger";

const MAX_PER_MIN = parseInt(process.env.RATE_LIMIT_PER_MIN ?? "25", 10);
const MODEL = process.env.AI_MODEL ?? "llama-3.3-70b-versatile";
const MAX_TOKENS = parseInt(process.env.AI_MAX_TOKENS ?? "1024", 10);
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export class AIService {
  private apiKey: string;
  private queues: Map<string, PQueue> = new Map();
  private static instance: AIService;

  private constructor() {
    this.apiKey = process.env.GROQ_API_KEY!;
  }

  static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  private getQueue(tenantId: string): PQueue {
    if (!this.queues.has(tenantId)) {
      this.queues.set(
        tenantId,
        new PQueue({
          intervalCap: MAX_PER_MIN,
          interval: 60_000,
          carryoverConcurrencyCount: true,
        })
      );
    }
    return this.queues.get(tenantId)!;
  }

  async chat(
    tenantId: string,
    systemPrompt: string,
    history: ConversationMessage[],
    userMessage: string
  ): Promise<string> {
    const queue = this.getQueue(tenantId);

    return queue.add(async () => {
      const messages = [
        { role: "system", content: systemPrompt },
        ...history
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userMessage },
      ];

      logger.debug(
        { tenantId, historyLength: messages.length, model: MODEL },
        "Sending to AI"
      );

      const response = await axios.post(
        GROQ_URL,
        {
          model: MODEL,
          messages,
          max_tokens: MAX_TOKENS,
          temperature: parseFloat(process.env.AI_TEMPERATURE ?? "0.7"),
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const text = response.data?.choices?.[0]?.message?.content ?? "";

      logger.debug({ tenantId }, "AI response received");

      return text;
    }) as Promise<string>;
  }

  async generateGreeting(
    tenantId: string,
    systemPrompt: string,
    customerName?: string
  ): Promise<string> {
    const prompt = customerName
      ? `A new customer named ${customerName} has just messaged. Send a warm welcome.`
      : "A new customer has just messaged for the first time. Send a warm, brief welcome message and ask how you can help.";

    return this.chat(tenantId, systemPrompt, [], prompt);
  }
}
