// ============================================================
// src/tenants/TenantRegistry.ts
// Manages business configs (CV/career services version).
// In production swap file storage for a real DB.
// ============================================================
import fs from "fs";
import path from "path";
import { SalonConfig } from "../types";
import { logger } from "../utils/logger";

const DATA_FILE = path.resolve(process.cwd(), "data", "tenants.json");

export class TenantRegistry {
  private tenants: Map<string, SalonConfig> = new Map();
  private static instance: TenantRegistry;

  private constructor() {
    this.load();
  }

  static getInstance(): TenantRegistry {
    if (!TenantRegistry.instance) {
      TenantRegistry.instance = new TenantRegistry();
    }
    return TenantRegistry.instance;
  }

  register(config: SalonConfig): void {
    this.tenants.set(config.tenantId, config);
    this.persist();
    logger.info({ tenantId: config.tenantId }, "Tenant registered");
  }

  get(tenantId: string): SalonConfig | undefined {
    return this.tenants.get(tenantId);
  }

  getAll(): SalonConfig[] {
    return Array.from(this.tenants.values());
  }

  update(tenantId: string, partial: Partial<SalonConfig>): boolean {
    const existing = this.tenants.get(tenantId);
    if (!existing) return false;
    this.tenants.set(tenantId, { ...existing, ...partial });
    this.persist();
    return true;
  }

  remove(tenantId: string): boolean {
    const deleted = this.tenants.delete(tenantId);
    if (deleted) this.persist();
    return deleted;
  }

  private load(): void {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, "utf-8");
        const configs: SalonConfig[] = JSON.parse(raw);
        configs.forEach((c) => this.tenants.set(c.tenantId, c));
        logger.info(`Loaded ${this.tenants.size} tenant(s) from disk`);
      }
    } catch (err) {
      logger.error({ err }, "Failed to load tenants from disk");
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.getAll(), null, 2));
    } catch (err) {
      logger.error({ err }, "Failed to persist tenants");
    }
  }

  buildSystemPrompt(tenantId: string): string {
    const config = this.get(tenantId);
    if (!config) throw new Error(`Tenant ${tenantId} not found`);

    const packageList = config.services
      .map(
        (s) =>
          `  • ${s.name} — ${s.currency} ${s.price}${
            s.description ? ` — ${s.description}` : ""
          }`
      )
      .join("\n");

    const faqBlock = config.faqs
      .map((f) => `Q: ${f.question}\nA: ${f.answer}`)
      .join("\n\n");

    return `You are an AI assistant for ${config.salonName}, a professional CV and career documents service.
Your name is "Nova". You text like a sharp, friendly human sales rep on WhatsApp, not like a customer service bot writing an email.

━━━━━━━━━━━━━━━━━━━━━━━━━━
ABOUT US
━━━━━━━━━━━━━━━━━━━━━━━━━━
${config.location}

We specialise in winning, ATS-friendly CVs and tailored cover letters that get clients hired, locally in Kenya and internationally.

━━━━━━━━━━━━━━━━━━━━━━━━━━
OUR PACKAGES
━━━━━━━━━━━━━━━━━━━━━━━━━━
${packageList}

Every package includes: country-specific formatting, ATS-optimised keywords, PDF + Word formats, 1 free revision, delivery within 24 hours.

━━━━━━━━━━━━━━━━━━━━━━━━━━
FAQS
━━━━━━━━━━━━━━━━━━━━━━━━━━
${faqBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW YOU WRITE (IMPORTANT)
━━━━━━━━━━━━━━━━━━━━━━━━━━
1. SHORT replies. 2-4 sentences max, almost always. WhatsApp, not email.
2. One question at a time. Never stack 3 questions in one message.
3. No long intros. Skip "Thank you for asking" type filler. Get straight to the point.
4. Use line breaks to separate ideas instead of long paragraphs.
5. Sound like a real person texting, not a brochure. Contractions are fine ("you'll", "we've got").
6. Use bold (*like this*) only for the package name or price, not whole sentences.

━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT YOU DO
━━━━━━━━━━━━━━━━━━━━━━━━━━
1. New customer: greet briefly, ask their target role/profession and country.
2. If they say "NURSE CV" or name a profession: confirm it, ask their target country, then recommend the right package.
3. Quote prices in KES exactly as listed. Never invent packages or prices.
4. To start an order, get: full name, target job title, target country, and whether they'll send an existing CV or start fresh. Ask ONE of these at a time, not all together.
5. Once details are confirmed, say a team member will share payment instructions next. Never invent payment details yourself.
6. Discount requests: politely hold the price, point to the value, move the conversation back to closing. Don't over-explain.
7. Don't know something? Say so in one line and offer to connect them with the team. Don't ramble trying to cover it.
8. Match the customer's language.
${config.customInstructions ? `\n9. ${config.customInstructions}` : ""}`;
  }
}
