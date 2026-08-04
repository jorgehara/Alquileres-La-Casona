import { defineString } from "firebase-functions/params";

export const webAppUrl = defineString("WEBAPP_URL", {
  default: "http://127.0.0.1:5000"
});

export const backendBaseUrl = defineString("BACKEND_BASE_URL", {
  default: "http://127.0.0.1:5001/demo-alquileres-la-casona/us-central1"
});

export const mercadoPagoAccessToken = defineString("MERCADO_PAGO_ACCESS_TOKEN", {
  default: ""
});

export const mercadoPagoWebhookSecret = defineString("MERCADO_PAGO_WEBHOOK_SECRET", {
  default: ""
});

export const twilioAccountSid = defineString("TWILIO_ACCOUNT_SID", {
  default: ""
});

export const twilioAuthToken = defineString("TWILIO_AUTH_TOKEN", {
  default: ""
});

export const twilioWhatsappFrom = defineString("TWILIO_WHATSAPP_FROM", {
  default: ""
});

export const twilioSmsFrom = defineString("TWILIO_SMS_FROM", {
  default: ""
});

export const smtpHost = defineString("SMTP_HOST", {
  default: ""
});

export const smtpPort = defineString("SMTP_PORT", {
  default: "465"
});

export const smtpUser = defineString("SMTP_USER", {
  default: ""
});

export const smtpPass = defineString("SMTP_PASS", {
  default: ""
});

export const emailFrom = defineString("EMAIL_FROM", {
  default: ""
});

export const claudeApiKey = defineString("CLAUDE_API_KEY", {
  default: ""
});

export const financialBotApiUrl = defineString("FINANCIAL_BOT_API_URL", {
  default: ""
});

export const financialBotApiSecret = defineString("FINANCIAL_BOT_API_SECRET", {
  default: ""
});
