import { defineString } from "firebase-functions/params";

export const webAppUrl = defineString("WEBAPP_URL", {
  default: "http://127.0.0.1:5000",
});

// Must be the public Functions base URL in production so external webhooks can reach HTTP handlers.
export const backendBaseUrl = defineString("BACKEND_BASE_URL", {
  default: "http://127.0.0.1:5001/demo-alquileres-la-casona/us-central1",
});

export const mercadoPagoAccessToken = defineString(
  "MERCADO_PAGO_ACCESS_TOKEN",
  {
    default: "",
  },
);

export const mercadoPagoWebhookSecret = defineString(
  "MERCADO_PAGO_WEBHOOK_SECRET",
  {
    default: "",
  },
);

// WhatsApp Cloud API (Meta)
export const whatsappCloudApiToken = defineString("WHATSAPP_CLOUD_API_TOKEN", {
  default: "",
});

export const whatsappPhoneNumberId = defineString("WHATSAPP_PHONE_NUMBER_ID", {
  default: "",
});

// Optional for current flows; kept for compatibility with future Meta Graph API features.
export const whatsappBusinessAccountId = defineString(
  "WHATSAPP_BUSINESS_ACCOUNT_ID",
  {
    default: "",
  },
);

// SMS fallback (Twilio — optional)
export const twilioAccountSid = defineString("TWILIO_ACCOUNT_SID", {
  default: "",
});

export const twilioAuthToken = defineString("TWILIO_AUTH_TOKEN", {
  default: "",
});

export const twilioSmsFrom = defineString("TWILIO_SMS_FROM", {
  default: "",
});

export const smtpHost = defineString("SMTP_HOST", {
  default: "",
});

export const smtpPort = defineString("SMTP_PORT", {
  default: "465",
});

export const smtpUser = defineString("SMTP_USER", {
  default: "",
});

export const smtpPass = defineString("SMTP_PASS", {
  default: "",
});

export const emailFrom = defineString("EMAIL_FROM", {
  default: "",
});

export const claudeApiKey = defineString("CLAUDE_API_KEY", {
  default: "",
});

export const financialBotApiUrl = defineString("FINANCIAL_BOT_API_URL", {
  default: "",
});

export const financialBotApiSecret = defineString("FINANCIAL_BOT_API_SECRET", {
  default: "",
});
