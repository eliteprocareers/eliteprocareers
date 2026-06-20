// ============================================================
// src/tenants/eliteproConfig.ts
// ElitePro Career Solutions - default tenant configuration.
// This is auto-registered on every server startup so the tenant
// survives restarts/spin-downs without manual re-registration.
// ============================================================
import { SalonConfig } from "../types";

export const eliteproConfig: SalonConfig = {
  tenantId: "elitepro",
  salonName: "ElitePro Career Solutions",
  ownerName: "ElitePro Team",
  location: "Nairobi, Kenya",
  timezone: "Africa/Nairobi",
  services: [
    {
      id: "cv-writing",
      name: "CV Writing / Revamp",
      duration: 0,
      price: 0,
      currency: "KES",
      description: "Professional CV writing or full revamp of an existing CV. Price depends on role, experience level, and complexity - always quote case by case, never a fixed number.",
    },
    {
      id: "cover-letter",
      name: "Cover Letter",
      duration: 0,
      price: 0,
      currency: "KES",
      description: "Tailored cover letter writing. Can be combined with CV writing or LinkedIn optimization. Price depends on complexity - always quote case by case.",
    },
    {
      id: "linkedin-optimization",
      name: "LinkedIn Optimization",
      duration: 0,
      price: 0,
      currency: "KES",
      description: "Full LinkedIn profile optimization to improve visibility to recruiters. Can be combined with CV writing and/or cover letter. Price depends on complexity - always quote case by case.",
    },
  ],
  staff: [],
  businessHours: {
    monday: { open: "08:00", close: "18:00" },
    tuesday: { open: "08:00", close: "18:00" },
    wednesday: { open: "08:00", close: "18:00" },
    thursday: { open: "08:00", close: "18:00" },
    friday: { open: "08:00", close: "18:00" },
    saturday: { open: "09:00", close: "14:00" },
  },
  policies: {
    cancellationPolicy: "No cancellations needed for digital services.",
    depositRequired: false,
    advanceBookingDays: 0,
  },
  faqs: [
    {
      question: "How much does it cost?",
      answer: "Pricing depends on your role, experience level, and how much work is needed - we always give a custom quote, never a fixed price. Message us your job title, experience level, and target country and we'll get you a quote.",
    },
    {
      question: "How long does it take?",
      answer: "Most orders are turned around same day, often within a few hours.",
    },
    {
      question: "How do I pay?",
      answer: "We accept M-Pesa payments once you've agreed on a quote.",
    },
    {
      question: "Can I get a combo of services?",
      answer: "Yes - any single service or any combination (CV, cover letter, LinkedIn optimization) is available. Let us know what you need and we'll quote accordingly.",
    },
  ],
  customInstructions: `
You are the WhatsApp assistant for ElitePro Career Solutions, a CV/cover letter/LinkedIn optimization service based in Nairobi, Kenya.

CRITICAL PRICING RULE: Never state a specific price or number under any circumstances, even if asked directly or pressured. Pricing is always negotiated case-by-case based on the complexity of the customer's CV. Always respond to pricing questions by asking for: (1) their job title/role, (2) their experience level (e.g. entry-level, mid-level, senior, executive), and (3) their target country. Once you have these details, tell them a team member will follow up with a personalized quote - do not estimate or guess a number yourself.

SERVICES: We offer three individual services that can be purchased separately or combined in any way: CV writing/revamp, cover letter writing, and LinkedIn profile optimization. Always clarify which service(s) the customer wants.

TURNAROUND: Same day, usually within a few hours.

PAYMENT: M-Pesa, only after a quote has been agreed on.

TONE: Keep replies short, punchy, and WhatsApp-style - not long paragraphs. Be friendly and professional.
`.trim(),
};
