// ============================================================
// src/types.ts — Shared types across the entire platform
// ============================================================

export interface SalonService {
  id: string;
  name: string;
  duration: number;       // minutes
  price: number;          // in local currency
  currency: string;       // e.g. "KES", "USD"
  description?: string;
}

export interface StaffMember {
  id: string;
  name: string;
  specialties: string[];
  workingHours: WeeklySchedule;
}

export interface WeeklySchedule {
  monday?: DaySchedule;
  tuesday?: DaySchedule;
  wednesday?: DaySchedule;
  thursday?: DaySchedule;
  friday?: DaySchedule;
  saturday?: DaySchedule;
  sunday?: DaySchedule;
}

export interface DaySchedule {
  open: string;   // "09:00"
  close: string;  // "18:00"
  breakStart?: string;
  breakEnd?: string;
}

export interface SalonConfig {
  tenantId: string;
  salonName: string;
  ownerName: string;
  location: string;
  timezone: string;         // e.g. "Africa/Nairobi"
  phoneNumber?: string;     // linked WhatsApp number (auto-filled after auth)
  services: SalonService[];
  staff: StaffMember[];
  businessHours: WeeklySchedule;
  policies: {
    cancellationPolicy: string;
    depositRequired: boolean;
    depositAmount?: number;
    advanceBookingDays: number;
  };
  faqs: FAQ[];
  customInstructions?: string; // extra system prompt context
}

export interface FAQ {
  question: string;
  answer: string;
}

// ---------------------------------------------------------------
// WhatsApp Session
// ---------------------------------------------------------------

export type SessionStatus =
  | "INITIALIZING"
  | "QR_READY"
  | "AUTHENTICATED"
  | "READY"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "BANNED";

export interface TenantSession {
  tenantId: string;
  status: SessionStatus;
  qrCode?: string;           // base64 PNG of QR
  connectedNumber?: string;
  connectedAt?: Date;
  lastSeen?: Date;
  reconnectAttempts: number;
}

// ---------------------------------------------------------------
// Conversation & AI
// ---------------------------------------------------------------

export type MessageRole = "user" | "assistant" | "system";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
}

export interface ConversationState {
  tenantId: string;
  customerPhone: string;       // WhatsApp JID
  messages: ConversationMessage[];
  metadata: {
    customerName?: string;
    bookingIntent?: BookingIntent;
    lastActivity: number;
    messageCount: number;
  };
}

export interface BookingIntent {
  service?: string;
  staffPreference?: string;
  preferredDate?: string;
  preferredTime?: string;
  confirmed: boolean;
}

// ---------------------------------------------------------------
// API Payloads
// ---------------------------------------------------------------

export interface RegisterTenantPayload {
  tenantId: string;
  salonConfig: SalonConfig;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
