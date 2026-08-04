import { onCall } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/scheduler";
import nodemailer from "nodemailer";
import { db } from "../firebase.js";
import { assertOwnerScopeAccess, requireRole } from "../lib/auth.js";
import {
  twilioAccountSid,
  twilioAuthToken,
  twilioWhatsappFrom,
  twilioSmsFrom,
  webAppUrl,
  smtpHost,
  smtpPort,
  smtpUser,
  smtpPass,
  emailFrom
} from "../config.js";
import { nowIso, randomToken, rentalPeriod } from "../lib/utils.js";

type MessageChannel = "auto" | "whatsapp" | "sms" | "email";
type DeliveryChannel = "whatsapp" | "sms" | "email";
type ChargeContext = {
  id: string;
  period: string;
  rentAmount: number;
  expenseAmount: number;
  subtotal: number;
  lateFeeAmount: number;
  total: number;
  dueDate: string;
  status: string;
  paymentLink: string;
};

type ProfileCreatedContext = {
  propertyName: string;
  unitType: string;
  currentBaseRent: number;
  portalUrl: string;
  paymentDueDay: number;
  morosoAfterDays: number;
  lateFeeDailyRate: number;
  transferAlias: string;
  transferCbu: string;
  transferHolder: string;
};

const DEPARTMENT_COMMON_EXPENSES = 10000;
const BUENOS_AIRES_TIME_ZONE = "America/Argentina/Buenos_Aires";

export const sendGeneralMessage = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as {
    tenantId?: string;
    body?: string;
    channel?: MessageChannel;
    type?: string;
  };

  if (data.tenantId) {
    const tenantDoc = await db.collection("tenants").doc(String(data.tenantId)).get();
    const propertyId = String(tenantDoc.data()?.propertyId ?? "").trim();
    if (!propertyId) {
      throw new Error("No se pudo determinar la unidad del inquilino.");
    }
    await assertOwnerScopeAccess(request, propertyId);
  }

  const result = await sendTenantNotification({
    tenantId: data.tenantId ?? null,
    type: data.type ?? "general",
    body: data.body ?? "",
    channel: data.channel ?? "auto",
    createdBy: request.auth?.uid ?? "system"
  });

  return {
    ok: result.ok,
    status: result.status,
    channel: result.channel,
    requestedChannel: result.requestedChannel,
    providerConfigured: result.providerConfigured,
    messageId: result.messageId
  };
});

export const resendProfileCreatedEmail = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const tenantId = String(request.data?.tenantId ?? "").trim();
  if (!tenantId) {
    throw new Error("tenantId es obligatorio.");
  }

  const tenantDoc = await db.collection("tenants").doc(tenantId).get();
  const propertyId = String(tenantDoc.data()?.propertyId ?? "").trim();
  if (!propertyId) {
    throw new Error("No se pudo determinar la unidad del inquilino.");
  }

  await assertOwnerScopeAccess(request, propertyId);

  const tenantName = String(tenantDoc.get("fullName") ?? "inquilino");
  const tenantEmail = String(tenantDoc.get("email") ?? "").trim().toLowerCase();
  const result = await sendTenantNotification({
    tenantId,
    type: "profile_created",
    body: `Hola ${tenantName}, tu perfil de inquilino en La Casona ya quedo configurado.`,
    channel: "email",
    createdBy: request.auth?.uid ?? "system"
  });

  if (tenantEmail) {
    const invitationRef = db.collection("tenantInvitations").doc(tenantEmail);
    const invitationDoc = await invitationRef.get();
    if (invitationDoc.exists && String(invitationDoc.get("tenantId") ?? "") === tenantId) {
      await invitationRef.set({
        lastResentAt: nowIso(),
        lastResentBy: request.auth?.uid ?? "system",
        resendCount: Number(invitationDoc.get("resendCount") ?? 0) + 1,
        updatedAt: nowIso()
      }, { merge: true });
    }
  }

  return {
    ok: result.ok,
    status: result.status,
    channel: result.channel,
    requestedChannel: result.requestedChannel,
    providerConfigured: result.providerConfigured,
    messageId: result.messageId
  };
});

export const sendTenantOperationalEmail = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const tenantId = String(request.data?.tenantId ?? "").trim();
  const templateType = String(request.data?.type ?? "").trim();

  if (!tenantId) {
    throw new Error("tenantId es obligatorio.");
  }

  if (!["period_available", "due_reminder"].includes(templateType)) {
    throw new Error("Tipo de correo no permitido.");
  }

  const tenantDoc = await db.collection("tenants").doc(tenantId).get();
  const propertyId = String(tenantDoc.data()?.propertyId ?? "").trim();
  if (!propertyId) {
    throw new Error("No se pudo determinar la unidad del inquilino.");
  }

  await assertOwnerScopeAccess(request, propertyId);

  const tenantName = String(tenantDoc.get("fullName") ?? "inquilino");
  const bodies: Record<string, string> = {
    period_available: `Hola ${tenantName}, tu nuevo periodo de alquiler ya esta disponible en el portal. Revisa el importe actualizado y utiliza el link de pago si deseas abonarlo con tarjeta o ver los datos para transferencia.`,
    due_reminder: `Hola ${tenantName}, este es un recordatorio de vencimiento. Te recomendamos ingresar al portal y revisar el estado actual de tu alquiler para evitar recargos por mora.`
  };

  const result = await sendTenantNotification({
    tenantId,
    type: templateType,
    body: bodies[templateType],
    channel: "email",
    createdBy: request.auth?.uid ?? "system"
  });

  return {
    ok: result.ok,
    status: result.status,
    channel: result.channel,
    requestedChannel: result.requestedChannel,
    providerConfigured: result.providerConfigured,
    messageId: result.messageId
  };
});

export const sendAccountCompletionEmail = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const email = String(request.data?.email ?? "").trim().toLowerCase();
  if (!email) {
    throw new Error("email es obligatorio.");
  }

  const sent = await sendDirectEmail({
    to: email,
    subject: "La Casona - Completa tu acceso",
    text: buildAccountCompletionEmailText(email),
    html: buildAccountCompletionEmailHtml(email)
  });

  return {
    ok: true,
    messageId: sent.messageId
  };
});

export const sendDueReminders = onSchedule(
  {
    schedule: "30 11 * * *",
    timeZone: BUENOS_AIRES_TIME_ZONE
  },
  async () => {
    await processPaymentWarnings({
      force: false,
      createdBy: "system-scheduler"
    });
  }
);

export const sendPaymentWarningsNow = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  return processPaymentWarnings({
    force: true,
    createdBy: request.auth?.uid ?? "system"
  });
});

async function processPaymentWarnings(input: {
  force: boolean;
  createdBy: string;
}) {
  const settingsDoc = await db.collection("settings").doc("general").get();
  const settings = settingsDoc.data() ?? {};
  const autoNotifyOverdue = settings.autoNotifyOverdue !== false;
  const reminderDaysBeforeDue = Math.max(0, Number(settings.reminderDaysBeforeDue ?? 3));
  const defaultChannel = await resolveDefaultNotificationChannel();
  const today = new Date();
  const { isoDate } = resolveBuenosAiresCalendarParts(today);
  const chargesSnapshot = await db.collection("charges").get();
  let eligible = 0;
  let sent = 0;
  let failed = 0;

  if (!input.force && !autoNotifyOverdue) {
    return { ok: true, eligible, sent, failed, disabled: true };
  }

  for (const chargeDoc of chargesSnapshot.docs) {
    const charge = chargeDoc.data() as Record<string, unknown>;
    const chargeStatus = String(charge.status ?? "").trim();
    if (!["pending", "overdue"].includes(chargeStatus)) {
      continue;
    }

    const warning = resolvePaymentWarning({
      dueDate: String(charge.dueDate ?? ""),
      status: chargeStatus,
      todayIsoDate: isoDate,
      reminderDaysBeforeDue,
      force: input.force
    });
    if (!warning) {
      continue;
    }

    const paymentWarning = (charge.paymentWarning ?? charge.portalReminder ?? {}) as Record<string, unknown>;
    const alreadySentDate = String(paymentWarning.lastSentDate ?? "").trim();
    const alreadySentStage = String(paymentWarning.lastStage ?? "").trim();
    if (!input.force && alreadySentDate === isoDate && alreadySentStage === warning.stage) {
      continue;
    }

    eligible += 1;
    const result = await sendTenantNotification({
      tenantId: String(charge.tenantId ?? ""),
      type: warning.templateType,
      body: buildPortalReminderBody(warning.variant),
      channel: defaultChannel,
      createdBy: input.createdBy
    });

    await chargeDoc.ref.set(
      {
        paymentWarning: {
          lastAttemptAt: nowIso(),
          lastAttemptStatus: result.status,
          lastStage: warning.stage,
          ...(result.ok ? { lastSentDate: isoDate, lastSentAt: nowIso() } : {})
        }
      },
      { merge: true }
    );

    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return { ok: failed === 0, eligible, sent, failed, disabled: false };
}

function resolvePaymentWarning(input: {
  dueDate: string;
  status: string;
  todayIsoDate: string;
  reminderDaysBeforeDue: number;
  force: boolean;
}) {
  const daysUntilDue = differenceInCalendarDays(input.dueDate, input.todayIsoDate);
  if (daysUntilDue === null) {
    return null;
  }

  if (input.force) {
    return input.status === "overdue" || daysUntilDue < 0
      ? { stage: "overdue_manual", variant: "followup" as const, templateType: "late_fee_notice" }
      : { stage: "pending_manual", variant: "initial" as const, templateType: "due_reminder" };
  }

  if (daysUntilDue === input.reminderDaysBeforeDue) {
    return { stage: "before_due", variant: "initial" as const, templateType: "due_reminder" };
  }

  if (daysUntilDue === 0) {
    return { stage: "due_today", variant: "alert" as const, templateType: "payment_registration_alert" };
  }

  const overdueDays = Math.abs(daysUntilDue);
  if (daysUntilDue < 0 && (overdueDays === 1 || overdueDays % 3 === 0)) {
    return {
      stage: overdueDays === 1 ? "overdue_initial" : `overdue_followup_${overdueDays}`,
      variant: "followup" as const,
      templateType: overdueDays === 1 ? "late_fee_notice" : "payment_registration_followup"
    };
  }

  return null;
}

function differenceInCalendarDays(leftIsoDate: string, rightIsoDate: string) {
  const left = parseIsoCalendarDate(leftIsoDate);
  const right = parseIsoCalendarDate(rightIsoDate);
  if (left === null || right === null) {
    return null;
  }

  return Math.round((left - right) / 86400000);
}

function parseIsoCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export async function sendTenantWhatsappNotification(input: {
  tenantId: string | null;
  type: string;
  body: string;
  createdBy: string;
}) {
  return sendTenantNotification({
    ...input,
    channel: "whatsapp"
  });
}

export async function sendTenantNotification(input: {
  tenantId: string | null;
  type: string;
  body: string;
  createdBy: string;
  channel?: MessageChannel;
}) {
  const messageRef = db.collection("messages").doc();
  const requestedChannel = input.channel ?? "auto";
  const basePayload = {
    tenantId: input.tenantId,
    requestedChannel,
    channel: requestedChannel === "auto" ? null : requestedChannel,
    type: input.type,
    body: input.body,
    status: "queued",
    sentAt: null,
    createdAt: nowIso(),
    createdBy: input.createdBy
  };

  if (!input.tenantId) {
    await messageRef.set({
      ...basePayload,
      status: "blocked",
      providerResponse: "missing_tenant"
    });
    return buildNotificationResult(false, "blocked", null, requestedChannel, false, messageRef.id);
  }

  const tenantDoc = await db.collection("tenants").doc(input.tenantId).get();
  const tenant = tenantDoc.data() ?? {};
  const phone = String(tenant.phone ?? "").trim();
  const email = String(tenant.email ?? "").trim();
  const chargeContext = await resolveChargeContext(String(input.tenantId));
  const profileCreatedContext = await resolveProfileCreatedContext(String(input.tenantId));

  const sid = twilioAccountSid.value();
  const token = twilioAuthToken.value();
  const whatsappFrom = twilioWhatsappFrom.value();
  const smsFrom = twilioSmsFrom.value();
  const configuredEmailFrom = emailFrom.value();
  const configuredSmtpHost = smtpHost.value();
  const configuredSmtpPort = Number(smtpPort.value() || 465);
  const configuredSmtpUser = smtpUser.value();
  const configuredSmtpPass = smtpPass.value();

  const providerConfigured = Boolean(
    (sid && token && (whatsappFrom || smsFrom))
    || (configuredSmtpHost && configuredSmtpUser && configuredSmtpPass && configuredEmailFrom)
  );

  const attempts = buildChannelAttempts({
    requestedChannel,
    phone,
    email,
    sid,
    token,
    whatsappFrom,
    smsFrom,
    smtpConfigured: Boolean(configuredSmtpHost && configuredSmtpUser && configuredSmtpPass && configuredEmailFrom)
  });

  if (!attempts.length) {
    await messageRef.set({
      ...basePayload,
      status: "blocked",
      providerResponse: resolveBlockedReason(requestedChannel, phone, email)
    });
    return buildNotificationResult(false, "blocked", null, requestedChannel, providerConfigured, messageRef.id);
  }

  let lastResponseText = "";
  let lastChannel: DeliveryChannel | null = null;

  for (const attempt of attempts) {
    lastChannel = attempt.channel;

    if (attempt.channel === "email") {
      try {
        const transporter = nodemailer.createTransport({
          host: configuredSmtpHost,
          port: configuredSmtpPort,
          secure: configuredSmtpPort === 465,
          auth: {
            user: configuredSmtpUser,
            pass: configuredSmtpPass
          }
        });

        const info = await transporter.sendMail({
          from: configuredEmailFrom,
          to: email,
          subject: buildEmailSubject(input.type, chargeContext),
          text: buildEmailText({
            type: input.type,
            tenantName: String(tenant.fullName ?? "Inquilino"),
            body: input.body,
            chargeContext,
            profileCreatedContext
          }),
          html: buildEmailHtml({
            type: input.type,
            tenantName: String(tenant.fullName ?? "Inquilino"),
            body: input.body,
            chargeContext,
            profileCreatedContext
          })
        });

        lastResponseText = JSON.stringify({
          messageId: info.messageId,
          accepted: info.accepted
        });

        await messageRef.set({
          ...basePayload,
          channel: "email",
          status: "sent",
          sentAt: nowIso(),
          providerResponse: lastResponseText
        });

        return buildNotificationResult(true, "sent", "email", requestedChannel, providerConfigured, messageRef.id);
      } catch (error) {
        lastResponseText = error instanceof Error ? error.message : "email_send_failed";
        continue;
      }
    }

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        To: attempt.channel === "whatsapp" ? normalizeWhatsappPhone(phone) : normalizeSmsPhone(phone),
        From: attempt.from,
        Body: input.body
      }).toString()
    });

    lastResponseText = await response.text();

    if (response.ok) {
      await messageRef.set({
        ...basePayload,
        channel: attempt.channel,
        status: "sent",
        sentAt: nowIso(),
        providerResponse: lastResponseText
      });
      return buildNotificationResult(true, "sent", attempt.channel, requestedChannel, providerConfigured, messageRef.id);
    }
  }

  await messageRef.set({
    ...basePayload,
    channel: lastChannel,
    status: "failed",
    providerResponse: lastResponseText
  });

  return buildNotificationResult(false, "failed", lastChannel, requestedChannel, providerConfigured, messageRef.id);
}

function buildChannelAttempts(input: {
  requestedChannel: MessageChannel;
  phone: string;
  email: string;
  sid: string;
  token: string;
  whatsappFrom: string;
  smsFrom: string;
  smtpConfigured: boolean;
}): Array<{ channel: DeliveryChannel; from: string }> {
  const hasPhone = Boolean(input.phone);
  const hasEmail = Boolean(input.email);

  if (input.requestedChannel === "whatsapp") {
    return hasPhone && input.whatsappFrom
      ? [{ channel: "whatsapp", from: input.whatsappFrom.startsWith("whatsapp:") ? input.whatsappFrom : `whatsapp:${input.whatsappFrom}` }]
      : [];
  }

  if (input.requestedChannel === "sms") {
    return hasPhone && input.smsFrom ? [{ channel: "sms", from: input.smsFrom }] : [];
  }

  if (input.requestedChannel === "email") {
    return hasEmail && input.smtpConfigured ? [{ channel: "email", from: "" }] : [];
  }

  const attempts: Array<{ channel: DeliveryChannel; from: string }> = [];

  if (hasPhone && input.whatsappFrom) {
    attempts.push({
      channel: "whatsapp",
      from: input.whatsappFrom.startsWith("whatsapp:") ? input.whatsappFrom : `whatsapp:${input.whatsappFrom}`
    });
  }

  if (hasPhone && input.smsFrom) {
    attempts.push({ channel: "sms", from: input.smsFrom });
  }

  if (hasEmail && input.smtpConfigured) {
    attempts.push({ channel: "email", from: "" });
  }

  return attempts;
}

function resolveBlockedReason(requestedChannel: MessageChannel, phone: string, email: string) {
  if (requestedChannel === "email") {
    return email ? "missing_email_config" : "missing_email";
  }

  if (requestedChannel === "sms") {
    return phone ? "missing_sms_config" : "missing_phone";
  }

  if (requestedChannel === "whatsapp") {
    return phone ? "missing_whatsapp_config" : "missing_phone";
  }

  if (!phone && !email) {
    return "missing_phone_and_email";
  }

  return "missing_delivery_config";
}

async function resolveChargeContext(tenantId: string, options?: { generatePaymentLink?: boolean }) {
  const openCharges = await db
    .collection("charges")
    .where("tenantId", "==", tenantId)
    .get();

  const currentPeriod = rentalPeriod();
  const generatePaymentLink = options?.generatePaymentLink !== false;
  const charges = (openCharges.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as Array<Record<string, unknown>>)
    .sort((left, right) => String(right.period ?? "").localeCompare(String(left.period ?? "")));

  const activeCharges = charges.filter((charge) => charge.status !== "paid" && charge.status !== "cancelled");
  const currentCharge = (
    activeCharges.find((charge) => String(charge.period ?? "") === currentPeriod)
    || activeCharges.find((charge) => String(charge.period ?? "") <= currentPeriod)
    || activeCharges[0]
    || charges[0]
  ) as Record<string, unknown> | undefined;

  if (!currentCharge) {
    return null;
  }

  let paymentLink = webAppUrl.value();

  if (generatePaymentLink && currentCharge.status !== "paid" && currentCharge.status !== "cancelled") {
    const token = randomToken(48);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

    await db.collection("paymentAccessTokens").doc(token).set({
      token,
      chargeId: currentCharge.id,
      status: "active",
      createdAt: nowIso(),
      expiresAt,
      createdBy: "notification-email"
    });

    paymentLink = `${webAppUrl.value()}/?token=${token}`;
  }

  return {
    id: String(currentCharge.id ?? ""),
    period: String(currentCharge.period ?? ""),
    rentAmount: resolveChargeRentAmount(currentCharge),
    expenseAmount: resolveChargeExpenseAmount(currentCharge),
    subtotal: Number(currentCharge.subtotal ?? 0),
    lateFeeAmount: Number(currentCharge.lateFeeAmount ?? 0),
    total: Number(currentCharge.total ?? 0),
    dueDate: String(currentCharge.dueDate ?? ""),
    status: String(currentCharge.status ?? "pending"),
    paymentLink
  } satisfies ChargeContext;
}

function buildEmailSubject(type: string, chargeContext?: ChargeContext | null) {
  const baseSubject = buildBaseEmailSubject(type);
  if (!chargeContext?.period) {
    return baseSubject;
  }

  return `${baseSubject} - ${chargeContext.period}`;
}

function buildBaseEmailSubject(type: string) {
  const subjects: Record<string, string> = {
      general: "La Casona - Mensaje de administracion",
      period_available: "La Casona - Nuevo periodo disponible",
      due_reminder: "La Casona - Recordatorio de vencimiento",
      payment_registration_reminder: "La Casona - Recordatorio para registrar tu pago",
      payment_registration_alert: "La Casona - Regulariza tu pago del mes",
      payment_registration_followup: "La Casona - Regularizacion pendiente de tu alquiler",
      late_fee_notice: "La Casona - Aviso por mora",
      profile_created: "La Casona - Perfil creado",
      payment_in_review: "La Casona - Pago en revision",
      payment_approved: "La Casona - Pago aprobado",
      payment_rejected: "La Casona - Pago rechazado",
      contract_renewed: "La Casona - Contrato renovado",
      contract_finalized: "La Casona - Fin de contrato"
    };

  return subjects[type] || "La Casona - Notificacion";
}

function buildEmailText(input: {
  type: string;
  tenantName: string;
  body: string;
  chargeContext: ChargeContext | null;
  profileCreatedContext: ProfileCreatedContext | null;
}) {
  if (input.type === "profile_created" && input.profileCreatedContext) {
    return buildProfileCreatedEmailText({
      tenantName: input.tenantName,
      body: input.body,
      profileCreatedContext: input.profileCreatedContext
    });
  }

  if (isPortalPaymentReminderType(input.type) && input.chargeContext) {
    return buildPortalReminderEmailText({
      tenantName: input.tenantName,
      chargeContext: input.chargeContext,
      variant: resolvePortalReminderVariantFromType(input.type)
    });
  }

  const lines = [
    `Hola ${input.tenantName},`,
    "",
    input.body
  ];

  if (input.chargeContext) {
    lines.push(
      "",
      `Periodo: ${input.chargeContext.period}`,
      `Alquiler: ${formatCurrency(input.chargeContext.rentAmount)}`,
      ...(input.chargeContext.expenseAmount > 0 ? [`Expensas: ${formatCurrency(input.chargeContext.expenseAmount)}`] : []),
      `Subtotal: ${formatCurrency(input.chargeContext.subtotal)}`,
      `Mora acumulada: ${formatCurrency(input.chargeContext.lateFeeAmount)}`,
      `Total actual: ${formatCurrency(input.chargeContext.total)}`,
      `Vencimiento: ${formatDate(input.chargeContext.dueDate)}`,
      `Estado: ${humanizeChargeStatus(input.chargeContext.status)}`,
      `Link de pago: ${input.chargeContext.paymentLink}`
    );
  }

  lines.push(
    "",
    "Si necesitas ayuda, responde este correo o comunicate con administracion.",
    "La Casona"
  );

  return lines.join("\n");
}

function buildEmailHtml(input: {
  type: string;
  tenantName: string;
  body: string;
  chargeContext: ChargeContext | null;
  profileCreatedContext: ProfileCreatedContext | null;
}) {
  if (input.type === "profile_created" && input.profileCreatedContext) {
    return buildProfileCreatedEmailHtml({
      tenantName: input.tenantName,
      body: input.body,
      profileCreatedContext: input.profileCreatedContext
    });
  }

  if (isPortalPaymentReminderType(input.type) && input.chargeContext) {
    return buildPortalReminderEmailHtml({
      tenantName: input.tenantName,
      chargeContext: input.chargeContext,
      variant: resolvePortalReminderVariantFromType(input.type)
    });
  }

  const accent = resolveEmailAccent(input.chargeContext?.status ?? "pending");
  const chargeCard = input.chargeContext
    ? `
      <div style="margin-top:28px;padding:24px;border-radius:20px;background:#ffffff;border:1px solid ${accent.border};">
        <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Estado del alquiler</p>
        <h2 style="margin:0 0 12px;font-size:28px;line-height:1;color:#17352a;">${escapeHtml(input.chargeContext.period)}</h2>
        <div style="display:grid;gap:10px;margin-top:18px;">
          ${buildStatRow("Alquiler", formatCurrency(input.chargeContext.rentAmount))}
          ${input.chargeContext.expenseAmount > 0 ? buildStatRow("Expensas", formatCurrency(input.chargeContext.expenseAmount)) : ""}
          ${buildStatRow("Subtotal", formatCurrency(input.chargeContext.subtotal))}
          ${buildStatRow("Mora acumulada", formatCurrency(input.chargeContext.lateFeeAmount), input.chargeContext.lateFeeAmount > 0 ? "#8a3a30" : "#17352a")}
          ${buildStatRow("Total actual", formatCurrency(input.chargeContext.total), "#17352a", true)}
          ${buildStatRow("Vencimiento", formatDate(input.chargeContext.dueDate))}
        </div>
        <div style="margin-top:18px;">
          <span style="display:inline-block;padding:8px 12px;border-radius:999px;background:${accent.badgeBg};color:${accent.badgeText};font-size:12px;font-weight:800;">
            ${escapeHtml(humanizeChargeStatus(input.chargeContext.status))}
          </span>
        </div>
        <a href="${escapeAttribute(input.chargeContext.paymentLink)}" style="display:block;margin-top:22px;text-align:center;text-decoration:none;background:#17352a;color:#ffffff;padding:16px 18px;border-radius:999px;font-weight:800;">
          Ver detalle y pagar
        </a>
      </div>
    `
    : "";

  return `
    <div style="margin:0;padding:0;background:#edf2ea;font-family:Arial,sans-serif;color:#17352a;">
      <div style="max-width:720px;margin:0 auto;padding:24px 16px;">
        <div style="background:#17352a;border-radius:24px 24px 0 0;padding:28px 24px;text-align:center;">
          <div style="font-size:32px;font-weight:800;letter-spacing:-0.04em;color:#ffffff;">La Casona</div>
          <div style="margin-top:8px;color:#dfe9e1;font-size:14px;">Administracion de alquileres</div>
        </div>
        <div style="background:#fff5cc;padding:22px 24px;color:#17352a;">
          <p style="margin:0;font-size:18px;line-height:1.5;">
            <strong>${escapeHtml(input.tenantName)}</strong>, ${escapeHtml(input.body)}
          </p>
        </div>
        <div style="background:#f7faf7;padding:28px 24px 36px;border-radius:0 0 24px 24px;">
          ${chargeCard}
          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #d6e0d6;color:#5b7266;font-size:14px;line-height:1.7;">
            Si necesitas ayuda, responde este correo o comunicate con administracion.
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildProfileCreatedEmailText(input: {
  tenantName: string;
  body: string;
  profileCreatedContext: ProfileCreatedContext;
}) {
  const context = input.profileCreatedContext;
  const expenseAmount = resolveProfileCreatedExpenseAmount(context);
  const referenceTotal = context.currentBaseRent + expenseAmount;
  const transferLines = context.transferAlias || context.transferCbu || context.transferHolder
    ? [
        "",
        "Datos para transferencia:",
        context.transferHolder ? `Titular: ${context.transferHolder}` : "",
        context.transferAlias ? `Alias: ${context.transferAlias}` : "",
        context.transferCbu ? `CBU: ${context.transferCbu}` : ""
      ].filter(Boolean)
    : [];

  const lines = [
    `Hola ${input.tenantName},`,
    "",
    "Tu perfil en La Casona Alquileres fue creado correctamente.",
    "",
    `Unidad asociada: ${context.propertyName}`,
    `Valor actual del alquiler: ${formatCurrency(context.currentBaseRent)}`,
    ...(expenseAmount > 0
      ? [
          `Expensas fijas: ${formatCurrency(expenseAmount)}`,
          `Total de referencia del período: ${formatCurrency(referenceTotal)}`
        ]
      : []),
    "",
    "A partir de ahora podrás ingresar a tu portal personal para:",
    "- revisar tu alquiler actual;",
    "- ver el período pendiente;",
    "- consultar el vencimiento;",
    "- cargar comprobantes de pago;",
    "- ver pagos anteriores;",
    "- consultar tus recibos emitidos.",
    "",
    `Acceso al portal: ${context.portalUrl}`,
    "",
    "Funcionamiento general:",
    "1. Cada período se genera tu cobro correspondiente.",
    "2. Desde el portal podrás ver el importe actualizado.",
    "3. Si pagás por transferencia, deberás subir el comprobante para revisión administrativa.",
    "4. Una vez aprobado el pago, el sistema emitirá el recibo oficial.",
    "5. El recibo también podrá enviarse por correo electrónico.",
    "",
    "Importante sobre los pagos:",
    `- El vencimiento ordinario se calcula con día ${context.paymentDueDay} de cada mes, salvo que administración indique otra cosa.`,
    "- El estado del cobro puede figurar como pendiente, en revisión o pagado según la instancia del proceso.",
    "- Si el comprobante enviado requiere validación, el pago no se considera aprobado hasta la confirmación administrativa.",
    "- Si se usa tarjeta, el enlace de Mercado Pago es exclusivo para débito/crédito."
  ];

  lines.push(...transferLines);

  lines.push(
    "",
    "Mora y recargos:",
    `- Si el pago vence y no fue abonado en término, podrán aplicarse recargos por mora.`,
    `- El sistema considera morosidad a partir de ${context.morosoAfterDays} días de atraso.`,
    `- La tasa diaria configurada actualmente es del ${(context.lateFeeDailyRate * 100).toFixed(2)}%.`,
    "- El importe actualizado con mora se reflejará en el portal según la configuración vigente.",
    "",
    "Si necesitás ayuda, comunicate con administración por los canales habituales.",
    "La Casona Alquileres"
  );

  return lines.join("\n");
}

function buildProfileCreatedEmailHtml(input: {
  tenantName: string;
  body: string;
  profileCreatedContext: ProfileCreatedContext;
}) {
  const context = input.profileCreatedContext;
  const hasTransferData = Boolean(context.transferAlias || context.transferCbu || context.transferHolder);
  const expenseAmount = resolveProfileCreatedExpenseAmount(context);
  const referenceTotal = context.currentBaseRent + expenseAmount;

  return `
    <div style="margin:0;padding:0;background:#edf2ea;font-family:Arial,sans-serif;color:#17352a;">
      <div style="max-width:720px;margin:0 auto;padding:24px 16px;">
        <div style="background:#17352a;border-radius:24px 24px 0 0;padding:28px 24px;text-align:center;">
          <div style="font-size:32px;font-weight:800;letter-spacing:-0.04em;color:#ffffff;">La Casona</div>
          <div style="margin-top:8px;color:#dfe9e1;font-size:14px;">Administración de alquileres</div>
        </div>
        <div style="background:#fff5cc;padding:22px 24px;color:#17352a;">
          <p style="margin:0;font-size:18px;line-height:1.6;">
            <strong>${escapeHtml(input.tenantName)}</strong>, tu perfil en La Casona Alquileres fue creado correctamente.
          </p>
        </div>
        <div style="background:#f7faf7;padding:28px 24px 36px;border-radius:0 0 24px 24px;">
          <div style="padding:24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.10);">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Alta confirmada</p>
            <h2 style="margin:0 0 12px;font-size:28px;line-height:1;color:#17352a;">${escapeHtml(context.propertyName)}</h2>
            <div style="display:grid;gap:10px;margin-top:18px;">
              ${buildStatRow("Valor actual del alquiler", formatCurrency(context.currentBaseRent), "#17352a", true)}
              ${expenseAmount > 0 ? buildStatRow("Expensas fijas", formatCurrency(expenseAmount)) : ""}
              ${expenseAmount > 0 ? buildStatRow("Total de referencia", formatCurrency(referenceTotal), "#17352a", true) : ""}
              ${buildStatRow("Tipo de unidad", context.unitType)}
              ${buildStatRow("Vencimiento base", `Día ${String(context.paymentDueDay)}`)}
            </div>
            <a href="${escapeAttribute(context.portalUrl)}" style="display:block;margin-top:22px;text-align:center;text-decoration:none;background:#17352a;color:#ffffff;padding:16px 18px;border-radius:999px;font-weight:800;">
              Ingresar al portal
            </a>
          </div>

          <div style="margin-top:24px;padding:22px 24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.08);">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Cómo funciona</p>
            <ol style="margin:0;padding-left:18px;color:#17352a;line-height:1.7;">
              <li>Cada período se genera tu cobro correspondiente.</li>
              <li>Desde el portal podrás ver el importe actualizado.</li>
              <li>Si pagás por transferencia, deberás subir el comprobante para revisión administrativa.</li>
              <li>Una vez aprobado el pago, el sistema emitirá el recibo oficial.</li>
              <li>El recibo también podrá enviarse por correo electrónico.</li>
            </ol>
          </div>

          <div style="margin-top:24px;padding:22px 24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.08);">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Importante sobre los pagos</p>
            <ul style="margin:0;padding-left:18px;color:#17352a;line-height:1.7;">
              <li>El vencimiento ordinario se calcula con día ${String(context.paymentDueDay)} de cada mes, salvo indicación administrativa.</li>
              <li>El cobro puede figurar como pendiente, en revisión o pagado según la instancia del proceso.</li>
              <li>Si el comprobante enviado requiere validación, el pago no se considera aprobado hasta la confirmación administrativa.</li>
              <li>Si se usa tarjeta, el enlace de Mercado Pago es exclusivo para débito/crédito.</li>
            </ul>
          </div>

          ${hasTransferData ? `
            <div style="margin-top:24px;padding:22px 24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.08);">
              <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Datos para transferencia</p>
              <div style="display:grid;gap:10px;">
                ${context.transferHolder ? buildStatRow("Titular", context.transferHolder) : ""}
                ${context.transferAlias ? buildStatRow("Alias", context.transferAlias) : ""}
                ${context.transferCbu ? buildStatRow("CBU", context.transferCbu) : ""}
              </div>
            </div>
          ` : ""}

          <div style="margin-top:24px;padding:22px 24px;border-radius:20px;background:#fff8f2;border:1px solid rgba(183,121,31,.18);">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#8e6d1b;font-weight:700;">Mora y recargos</p>
            <ul style="margin:0;padding-left:18px;color:#17352a;line-height:1.7;">
              <li>Si el pago vence y no fue abonado en término, podrán aplicarse recargos por mora.</li>
              <li>El sistema considera morosidad a partir de ${String(context.morosoAfterDays)} días de atraso.</li>
              <li>La tasa diaria configurada actualmente es del ${(context.lateFeeDailyRate * 100).toFixed(2)}%.</li>
              <li>El importe actualizado con mora se reflejará en el portal según la configuración vigente.</li>
            </ul>
          </div>

          <div style="margin-top:28px;padding-top:20px;border-top:1px solid #d6e0d6;color:#5b7266;font-size:14px;line-height:1.7;">
            Si necesitás ayuda, comunicate con administración por los canales habituales.
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildStatRow(label: string, value: string, color = "#17352a", strong = false) {
  return `
    <div style="display:flex;justify-content:space-between;gap:16px;align-items:center;">
      <span style="color:#5b7266;font-size:14px;">${escapeHtml(label)}</span>
      <strong style="margin:0;color:${color};font-size:${strong ? "20px" : "16px"};font-weight:${strong ? "800" : "700"};">${escapeHtml(value)}</strong>
    </div>
  `;
}

function resolveEmailAccent(status: string) {
  if (status === "paid") {
    return {
      border: "rgba(32,98,72,.18)",
      badgeBg: "#d9efe5",
      badgeText: "#206248"
    };
  }

  if (status === "overdue") {
    return {
      border: "rgba(138,58,48,.22)",
      badgeBg: "#f8dedd",
      badgeText: "#8a3a30"
    };
  }

  return {
    border: "rgba(142,109,27,.18)",
    badgeBg: "#f5ebc7",
    badgeText: "#8e6d1b"
  };
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(Number(value ?? 0));
}

function formatDate(value: string) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-AR").format(new Date(`${value}T00:00:00`));
}

function humanizeChargeStatus(status: string) {
  const labels: Record<string, string> = {
    pending: "Pendiente",
    overdue: "Vencido",
    in_review: "En revision",
    paid: "Pagado",
    cancelled: "Cancelado"
  };

  return labels[status] || "Pendiente";
}

async function resolveDefaultNotificationChannel(): Promise<MessageChannel> {
  const settingsDoc = await db.collection("settings").doc("general").get();
  const configured = String(settingsDoc.get("defaultNotificationChannel") ?? "email");
  if (configured === "auto" || configured === "whatsapp" || configured === "sms" || configured === "email") {
    return configured;
  }
  return "email";
}

async function resolveProfileCreatedContext(tenantId: string): Promise<ProfileCreatedContext | null> {
  const tenantDoc = await db.collection("tenants").doc(tenantId).get();
  if (!tenantDoc.exists) {
    return null;
  }

  const tenant = tenantDoc.data() ?? {};
  const propertyId = String(tenant.propertyId ?? "");
  const propertyDoc = propertyId ? await db.collection("properties").doc(propertyId).get() : null;
  const property = propertyDoc?.data() ?? {};
  const settingsDoc = await db.collection("settings").doc("general").get();
  const settings = settingsDoc.data() ?? {};
  const bankAccountsDoc = await db.collection("settings").doc("bankAccounts").get();
  const bankAccounts = bankAccountsDoc.data() ?? {};
  const chargeContext = await resolveChargeContext(tenantId, { generatePaymentLink: false });
  const transferBlock = String(property.transferBlock ?? "block_1");
  const account = (bankAccounts[transferBlock] ?? {}) as Record<string, unknown>;
  const rentUpdateConfig = (tenant.rentUpdateConfig ?? {}) as Record<string, unknown>;
  const currentPeriod = rentalPeriod();
  const currentBaseRent = chargeContext?.rentAmount
    || resolveCurrentTenantBaseRent(tenant, rentUpdateConfig, currentPeriod);

  return {
    propertyName: String(property.name ?? "Unidad asignada"),
    unitType: String(property.unitType ?? "Unidad"),
    currentBaseRent,
    portalUrl: webAppUrl.value(),
    paymentDueDay: Number(settings.dueDayOfMonth ?? 10),
    morosoAfterDays: Number(settings.morosoAfterDays ?? 15),
    lateFeeDailyRate: Number(settings.lateFeeDailyRate ?? 0),
    transferAlias: String(account.alias ?? ""),
    transferCbu: String(account.cbu ?? ""),
    transferHolder: String(account.holderName ?? "")
  };
}

function resolveChargeRentAmount(charge: Record<string, unknown>) {
  const items = Array.isArray(charge.items) ? charge.items : [];
  const rentItem = items.find((item) => String((item as Record<string, unknown>).key ?? "") === "rent") as Record<string, unknown> | undefined;
  const rentAmount = Number(rentItem?.amount ?? 0);
  return Number.isFinite(rentAmount) && rentAmount > 0 ? rentAmount : Number(charge.subtotal ?? 0);
}

function resolveChargeExpenseAmount(charge: Record<string, unknown>) {
  const items = Array.isArray(charge.items) ? charge.items : [];
  const expenseItem = items.find((item) => String((item as Record<string, unknown>).key ?? "") === "expenses") as Record<string, unknown> | undefined;
  const expenseAmount = Number(expenseItem?.amount ?? 0);
  return Number.isFinite(expenseAmount) && expenseAmount > 0 ? expenseAmount : 0;
}

function resolveCurrentTenantBaseRent(
  tenant: Record<string, unknown>,
  rentUpdateConfig: Record<string, unknown>,
  currentPeriod: string
) {
  const billingEffectivePeriod = String(
    rentUpdateConfig.billingEffectivePeriod
      ?? addMonthsToPeriod(String(rentUpdateConfig.effectivePeriod ?? "").trim(), 1)
  ).trim();
  const storedCurrentBaseRent = Number(rentUpdateConfig.currentBaseRent ?? 0);
  const pendingBaseRent = Number(rentUpdateConfig.pendingBaseRent ?? rentUpdateConfig.nextBaseRent ?? 0);
  const currentBaseRent = Number(tenant.baseRent ?? 0);

  if (
    billingEffectivePeriod
    && billingEffectivePeriod > currentPeriod
    && Number.isFinite(storedCurrentBaseRent)
    && storedCurrentBaseRent > 0
  ) {
    return storedCurrentBaseRent;
  }

  if (
    billingEffectivePeriod
    && billingEffectivePeriod <= currentPeriod
    && Number.isFinite(pendingBaseRent)
    && pendingBaseRent > 0
  ) {
    return pendingBaseRent;
  }

  return Number.isFinite(currentBaseRent) && currentBaseRent > 0 ? currentBaseRent : 0;
}

function addMonthsToPeriod(period: string, months: number) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period ?? "").trim());
  if (!match) {
    return "";
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const shifted = new Date(year, monthIndex + months, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

async function sendDirectEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const configuredEmailFrom = emailFrom.value();
  const configuredSmtpHost = smtpHost.value();
  const configuredSmtpPort = Number(smtpPort.value() || 465);
  const configuredSmtpUser = smtpUser.value();
  const configuredSmtpPass = smtpPass.value();

  if (!configuredSmtpHost || !configuredSmtpUser || !configuredSmtpPass || !configuredEmailFrom) {
    throw new Error("La configuración de correo no está completa.");
  }

  const transporter = nodemailer.createTransport({
    host: configuredSmtpHost,
    port: configuredSmtpPort,
    secure: configuredSmtpPort === 465,
    auth: {
      user: configuredSmtpUser,
      pass: configuredSmtpPass
    }
  });

  return transporter.sendMail({
    from: configuredEmailFrom,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html
  });
}

function buildAccountCompletionEmailText(email: string) {
  return [
    `Hola,`,
    "",
    "Tu cuenta en La Casona ya fue creada, pero tu perfil de inquilino todavía no quedó terminado.",
    "",
    "Qué debes hacer ahora:",
    "1. Ingresa al portal con tu correo y contraseña.",
    "2. Si aparece Acceso pendiente, toca Completar perfil de inquilino.",
    "3. Completa tus datos y guarda el perfil.",
    "",
    `Portal: ${webAppUrl.value()}`,
    `Correo asociado: ${email}`,
    "",
    "Importante:",
    "- No vuelvas a crear otra cuenta con el mismo correo.",
    "- Si ya tienes cuenta, debes iniciar sesión con esa cuenta.",
    "- Si no recuerdas la contraseña, utiliza la opción de recuperación en el acceso.",
    "",
    "Si necesitas ayuda, comunícate con administración.",
    "La Casona Alquileres"
  ].join("\n");
}

function buildAccountCompletionEmailHtml(email: string) {
  return `
    <div style="margin:0;padding:0;background:#edf2ea;font-family:Arial,sans-serif;color:#17352a;">
      <div style="max-width:720px;margin:0 auto;padding:24px 16px;">
        <div style="background:#17352a;border-radius:24px 24px 0 0;padding:28px 24px;text-align:center;">
          <div style="font-size:32px;font-weight:800;letter-spacing:-0.04em;color:#ffffff;">La Casona</div>
          <div style="margin-top:8px;color:#dfe9e1;font-size:14px;">Completa tu acceso</div>
        </div>
        <div style="background:#f7faf7;padding:28px 24px 36px;border-radius:0 0 24px 24px;">
          <p style="margin:0 0 18px;font-size:18px;line-height:1.6;">Tu cuenta ya fue creada, pero tu perfil de inquilino todavía no quedó terminado.</p>
          <div style="padding:24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.10);">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Qué debes hacer</p>
            <ol style="margin:0;padding-left:18px;line-height:1.8;">
              <li>Ingresa al portal con tu correo y contraseña.</li>
              <li>Si aparece <strong>Acceso pendiente</strong>, toca <strong>Completar perfil de inquilino</strong>.</li>
              <li>Completa tus datos y guarda el perfil.</li>
            </ol>
            <div style="margin-top:18px;">
              ${buildStatRow("Correo asociado", email)}
            </div>
            <a href="${escapeAttribute(webAppUrl.value())}" style="display:block;margin-top:22px;text-align:center;text-decoration:none;background:#17352a;color:#ffffff;padding:16px 18px;border-radius:999px;font-weight:800;">
              Ingresar al portal
            </a>
          </div>
          <div style="margin-top:24px;padding:22px 24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.08);">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Importante</p>
            <ul style="margin:0;padding-left:18px;line-height:1.7;">
              <li>No vuelvas a crear otra cuenta con el mismo correo.</li>
              <li>Si ya tienes cuenta, debes iniciar sesión con esa cuenta.</li>
              <li>Si no recuerdas la contraseña, utiliza la opción de recuperación en el acceso.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;
}

function resolveProfileCreatedExpenseAmount(context: ProfileCreatedContext) {
  return String(context.unitType ?? "").trim() === "Departamento"
    ? DEPARTMENT_COMMON_EXPENSES
    : 0;
}

function isPortalPaymentReminderType(type: string) {
  return [
    "payment_registration_reminder",
    "payment_registration_alert",
    "payment_registration_followup"
  ].includes(String(type ?? "").trim());
}

function resolvePortalReminderVariantFromType(type: string) {
  if (type === "payment_registration_alert") {
    return "alert";
  }
  if (type === "payment_registration_followup") {
    return "followup";
  }
  return "initial";
}

function buildPortalReminderEmailText(input: {
  tenantName: string;
  chargeContext: ChargeContext;
  variant: "initial" | "alert" | "followup";
}) {
  const intro = {
    initial:
      "Todavía no registramos tu pago del mes en el portal. Para que podamos validarlo correctamente, es importante que cargues tu comprobante en la web cuanto antes.",
    alert:
      "Al día de hoy todavía no registramos tu pago del mes en el portal. Te pedimos que regularices esta situación cuanto antes para evitar intereses y demoras en la validación.",
    followup:
      `Tu pago del mes sigue sin registrarse en el portal. Te pedimos que regularices tu situación a la brevedad. Actualmente tu deuda informada en el sistema es de ${formatCurrency(input.chargeContext.total)}.`
  }[input.variant];

  return [
    `Hola ${input.tenantName},`,
    "",
    intro,
    "",
    "Cómo cargar tu comprobante:",
    "1. Ingresá a tu portal de inquilino.",
    "2. Abrí el cobro del período actual.",
    "3. Elegí la opción para subir comprobante.",
    "4. Adjuntá la imagen o archivo del pago realizado.",
    "5. Confirmá el envío para revisión administrativa.",
    "",
    `Período: ${input.chargeContext.period}`,
    `Alquiler: ${formatCurrency(input.chargeContext.rentAmount)}`,
    ...(input.chargeContext.expenseAmount > 0 ? [`Expensas: ${formatCurrency(input.chargeContext.expenseAmount)}`] : []),
    `Total actual: ${formatCurrency(input.chargeContext.total)}`,
    `Vencimiento: ${formatDate(input.chargeContext.dueDate)}`,
    `Estado: ${humanizeChargeStatus(input.chargeContext.status)}`,
    `Acceso al portal: ${input.chargeContext.paymentLink}`,
    "",
    "Si ya realizaste el pago, completá este paso lo antes posible para evitar demoras en la confirmación.",
    "La Casona Alquileres"
  ].join("\n");
}

function buildPortalReminderEmailHtml(input: {
  tenantName: string;
  chargeContext: ChargeContext;
  variant: "initial" | "alert" | "followup";
}) {
  const intro = {
    initial:
      "Todavía no registramos tu pago del mes en el portal. Para que podamos validarlo correctamente, es importante que cargues tu comprobante en la web cuanto antes.",
    alert:
      "Al día de hoy todavía no registramos tu pago del mes en el portal. Te pedimos que regularices esta situación cuanto antes para evitar intereses y demoras en la validación.",
    followup:
      `Tu pago del mes sigue sin registrarse en el portal. Te pedimos que regularices tu situación a la brevedad. Actualmente tu deuda informada en el sistema es de ${formatCurrency(input.chargeContext.total)}.`
  }[input.variant];
  const accent = input.variant === "initial"
    ? { border: "rgba(142,109,27,.18)", badgeBg: "#f5ebc7", badgeText: "#8e6d1b" }
    : { border: "rgba(138,58,48,.22)", badgeBg: "#f8dedd", badgeText: "#8a3a30" };

  return `
    <div style="margin:0;padding:0;background:#edf2ea;font-family:Arial,sans-serif;color:#17352a;">
      <div style="max-width:720px;margin:0 auto;padding:24px 16px;">
        <div style="background:#17352a;border-radius:24px 24px 0 0;padding:28px 24px;text-align:center;">
          <div style="font-size:32px;font-weight:800;letter-spacing:-0.04em;color:#ffffff;">La Casona</div>
          <div style="margin-top:8px;color:#dfe9e1;font-size:14px;">Recordatorio de pago</div>
        </div>
        <div style="background:#f7faf7;padding:28px 24px 36px;border-radius:0 0 24px 24px;">
          <p style="margin:0;font-size:18px;line-height:1.6;">
            <strong>${escapeHtml(input.tenantName)}</strong>, ${escapeHtml(intro)}
          </p>

          <div style="margin-top:28px;padding:24px;border-radius:20px;background:#ffffff;border:1px solid ${accent.border};">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Estado del período</p>
            <h2 style="margin:0 0 12px;font-size:28px;line-height:1;color:#17352a;">${escapeHtml(input.chargeContext.period)}</h2>
            <div style="display:grid;gap:10px;margin-top:18px;">
              ${buildStatRow("Alquiler", formatCurrency(input.chargeContext.rentAmount))}
              ${input.chargeContext.expenseAmount > 0 ? buildStatRow("Expensas", formatCurrency(input.chargeContext.expenseAmount)) : ""}
              ${buildStatRow("Total actual", formatCurrency(input.chargeContext.total), "#17352a", true)}
              ${buildStatRow("Vencimiento", formatDate(input.chargeContext.dueDate))}
            </div>
            <div style="margin-top:18px;">
              <span style="display:inline-block;padding:8px 12px;border-radius:999px;background:${accent.badgeBg};color:${accent.badgeText};font-size:12px;font-weight:800;">
                ${escapeHtml(humanizeChargeStatus(input.chargeContext.status))}
              </span>
            </div>
          </div>

          <div style="margin-top:24px;padding:22px 24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.08);">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Cómo cargar tu comprobante</p>
            <ol style="margin:0;padding-left:18px;line-height:1.8;">
              <li>Ingresá a tu portal de inquilino.</li>
              <li>Abrí el cobro del período actual.</li>
              <li>Elegí la opción para subir comprobante.</li>
              <li>Adjuntá la imagen o archivo del pago realizado.</li>
              <li>Confirmá el envío para revisión administrativa.</li>
            </ol>
            <a href="${escapeAttribute(input.chargeContext.paymentLink)}" style="display:block;margin-top:22px;text-align:center;text-decoration:none;background:#17352a;color:#ffffff;padding:16px 18px;border-radius:999px;font-weight:800;">
              Ingresar al portal
            </a>
          </div>

          <div style="margin-top:24px;padding:22px 24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.08);color:#5b7266;font-size:14px;line-height:1.7;">
            Si ya realizaste el pago, completá este paso lo antes posible para evitar demoras en la confirmación.
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildPortalReminderBody(variant: "initial" | "alert" | "followup") {
  if (variant === "alert") {
    return "Todavía no registramos tu pago del mes en el portal. Regularizá tu situación cuanto antes para evitar intereses y demoras en la validación.";
  }

  if (variant === "followup") {
    return "Tu pago del mes sigue sin registrarse en el portal. Te pedimos que regularices tu situación a la brevedad.";
  }

  return "Todavía no registramos tu pago del mes en el portal. Es importante que subas tu comprobante en la web para que podamos confirmarlo correctamente.";
}

function resolvePortalReminderCadence(date: Date) {
  const { isoDate, dayOfMonth } = resolveBuenosAiresCalendarParts(date);

  if (dayOfMonth === 8) {
    return {
      isoDate,
      variant: "initial" as const,
      templateType: "payment_registration_reminder"
    };
  }

  if (dayOfMonth === 10) {
    return {
      isoDate,
      variant: "alert" as const,
      templateType: "payment_registration_alert"
    };
  }

  if (dayOfMonth > 10 && (dayOfMonth - 10) % 3 === 0) {
    return {
      isoDate,
      variant: "followup" as const,
      templateType: "payment_registration_followup"
    };
  }

  return null;
}

function resolveMonthPeriodInBuenosAires(date: Date) {
  const { year, month } = resolveBuenosAiresCalendarParts(date);
  return `${year}-${month}`;
}

function resolveBuenosAiresCalendarParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUENOS_AIRES_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return {
    year,
    month,
    day,
    dayOfMonth: Number(day),
    isoDate: `${year}-${month}-${day}`
  };
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

function buildNotificationResult(
  ok: boolean,
  status: string,
  channel: DeliveryChannel | null,
  requestedChannel: MessageChannel,
  providerConfigured: boolean,
  messageId: string
) {
  return {
    ok,
    status,
    channel,
    requestedChannel,
    providerConfigured,
    messageId
  };
}

function normalizeWhatsappPhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.startsWith("whatsapp:")
    ? digits
    : `whatsapp:${digits.startsWith("+") ? digits : `+${digits}`}`;
}

function normalizeSmsPhone(value: string) {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}
