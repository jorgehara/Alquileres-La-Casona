import { onCall } from "firebase-functions/https";
import { onSchedule } from "firebase-functions/scheduler";
import { db } from "../firebase.js";
import { requireRole } from "../lib/auth.js";
import { collectionPeriod, nowIso, rentalPeriod, sumAmounts } from "../lib/utils.js";
import { DEPARTMENT_COMMON_EXPENSES } from "../lib/constants.js";
import { ChargeItem, ChargeRecord } from "../types.js";
import { sendTenantNotification } from "./notifications.js";

type GeneralSettings = {
  lateFeeDailyRate: number;
  reminderDaysBeforeDue: number;
  dueDayOfMonth: number;
  morosoAfterDays: number;
  defaultNotificationChannel: "auto" | "whatsapp" | "sms" | "email";
  autoNotifyNewCharge: boolean;
  autoNotifyOverdue: boolean;
};

type UtilityBillLike = {
  id: string;
  period?: string;
  appliedToCharges?: boolean;
  billingGroup?: string;
  serviceType?: string;
  amount?: number;
};

type PropertyLike = {
  id: string;
  unitType?: string;
  unitCode?: string;
};

const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  lateFeeDailyRate: 0.001,
  reminderDaysBeforeDue: 3,
  dueDayOfMonth: 10,
  morosoAfterDays: 15,
  defaultNotificationChannel: "email",
  autoNotifyNewCharge: true,
  autoNotifyOverdue: true
};

export const generateMonthlyCharges = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);
  return createMonthlyCharges(request.auth?.uid ?? "system");
});

export const scheduledGenerateMonthlyCharges = onSchedule("0 8 1 * *", async () => {
  await createMonthlyCharges("system-scheduler");
});

export const syncChargeStatuses = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);
  return reconcileOpenCharges(request.auth?.uid ?? "system");
});

export const scheduledSyncChargeStatuses = onSchedule("0 7 * * *", async () => {
  await reconcileOpenCharges("system-scheduler");
});

export async function ensureCurrentChargeForTenant(tenantId: string, actorUserId: string) {
  const period = rentalPeriod();
  const duePeriod = collectionPeriod();
  const generationDate = new Date();
  const generatedAt = generationDate.toISOString();
  const existing = await db
    .collection("charges")
    .where("tenantId", "==", tenantId)
    .where("period", "==", period)
    .limit(1)
    .get();

  if (!existing.empty) {
    return { ok: true, created: false, period };
  }

  const settings = await getGeneralSettings();
  const tenantDoc = await db.collection("tenants").doc(tenantId).get();
  if (!tenantDoc.exists) {
    return { ok: false, created: false, period };
  }

  const data = tenantDoc.data() ?? {};
  if (String(data.status ?? "") !== "active") {
    return { ok: true, created: false, period };
  }

  const propertyId = String(data.propertyId ?? "");
  const propertyDoc = propertyId ? await db.collection("properties").doc(propertyId).get() : null;
  const property = propertyDoc?.exists ? ({ id: propertyDoc.id, ...propertyDoc.data() } as PropertyLike) : undefined;

  const billsSnapshot = await db.collection("utilityBills").where("period", "==", period).get();
  const bills = billsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as UtilityBillLike[];

  const serviceItems = bills
    .filter((bill) => {
      const amount = Number(bill.amount ?? NaN);
      return (
        bill.period === period
        && bill.appliedToCharges === true
        && !Number.isNaN(amount)
        && canAutoApplyBillToProperty(bill.billingGroup, property)
      );
    })
    .map((bill) => ({
      key: bill.serviceType === "electricity" ? "electricity" : "water",
      label: bill.serviceType === "electricity" ? "Luz" : "Agua",
      amount: Number(bill.amount ?? 0)
    })) as ChargeItem[];

  const items: ChargeItem[] = buildBaseChargeItemsForTenant(data, property, period).concat(serviceItems);
  const subtotal = sumAmounts(items.map((item) => item.amount));
  const dueDayOfMonth = resolveTenantDueDayOfMonth(data, settings);
  const nominalDueDate = `${duePeriod}-${String(dueDayOfMonth).padStart(2, "0")}`;
  const dueDate = resolveInitialDueDate(nominalDueDate, generationDate);
  const initialState = buildInitialChargeState(dueDate, subtotal, settings);

  const charge: ChargeRecord = {
    tenantId,
    propertyId,
    period,
    items,
    subtotal,
    lateFeeAmount: initialState.lateFeeAmount,
    lateFeeDailyRate: settings.lateFeeDailyRate,
    overdueDays: initialState.overdueDays,
    total: initialState.total,
    dueDate,
    status: initialState.status,
    paymentPolicy: "full_only",
    generatedAt,
    generatedBy: actorUserId
  };

  await db.collection("charges").doc().set(charge);
  return { ok: true, created: true, period };
}

async function createMonthlyCharges(actorUserId: string) {
  const period = rentalPeriod();
  const duePeriod = collectionPeriod();
  const generationDate = new Date();
  const generatedAt = generationDate.toISOString();
  const settings = await getGeneralSettings();
  const tenantsSnapshot = await db.collection("tenants").where("status", "==", "active").get();
  const billsSnapshot = await db.collection("utilityBills").where("period", "==", period).get();
  const propertiesSnapshot = await db.collection("properties").get();
  const properties = propertiesSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as PropertyLike[];
  const bills = billsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })) as UtilityBillLike[];
  let created = 0;

  for (const tenantDoc of tenantsSnapshot.docs) {
    const existing = await db
      .collection("charges")
      .where("tenantId", "==", tenantDoc.id)
      .where("period", "==", period)
      .limit(1)
      .get();

    if (!existing.empty) {
      continue;
    }

    const data = tenantDoc.data();
    const propertyId = String(data.propertyId ?? "");
    const property = properties.find((item) => item.id === propertyId);

    const serviceItems = bills
      .filter((bill) => {
        const amount = Number(bill.amount ?? NaN);
        return (
          bill.period === period
          && bill.appliedToCharges === true
          && !Number.isNaN(amount)
          && canAutoApplyBillToProperty(bill.billingGroup, property)
        );
      })
      .map((bill) => ({
        key: bill.serviceType === "electricity" ? "electricity" : "water",
        label: bill.serviceType === "electricity" ? "Luz" : "Agua",
        amount: Number(bill.amount ?? 0)
      })) as ChargeItem[];

    const items: ChargeItem[] = buildBaseChargeItemsForTenant(data, property, period).concat(serviceItems);

    const subtotal = sumAmounts(items.map((item) => item.amount));
    const dueDayOfMonth = resolveTenantDueDayOfMonth(data, settings);
    const nominalDueDate = `${duePeriod}-${String(dueDayOfMonth).padStart(2, "0")}`;
    const dueDate = resolveInitialDueDate(nominalDueDate, generationDate);
    const initialState = buildInitialChargeState(dueDate, subtotal, settings);
    const charge: ChargeRecord = {
      tenantId: tenantDoc.id,
      propertyId,
      period,
      items,
      subtotal,
      lateFeeAmount: initialState.lateFeeAmount,
      lateFeeDailyRate: settings.lateFeeDailyRate,
      overdueDays: initialState.overdueDays,
      total: initialState.total,
      dueDate,
      status: initialState.status,
      paymentPolicy: "full_only",
      generatedAt,
      generatedBy: actorUserId
    };

    const chargeRef = db.collection("charges").doc();
    await chargeRef.set(charge);

    if (settings.autoNotifyNewCharge && subtotal > 0) {
      const notification = await sendTenantNotification({
        tenantId: tenantDoc.id,
        type: "period_available",
        body: `Hola ${String(data.fullName ?? "inquilino")}, ya esta disponible tu nuevo periodo de pago ${period}.`,
        channel: settings.defaultNotificationChannel,
        createdBy: actorUserId
      });

      if (notification.ok) {
        await chargeRef.set(
          {
            periodNotificationSentAt: nowIso()
          },
          { merge: true }
        );
      }
    }

    created += 1;
  }

  const syncResult = await reconcileOpenCharges(actorUserId);
  return { ok: true, created, synced: syncResult.updated };
}

function buildBaseChargeItemsForTenant(
  tenantData: Record<string, unknown>,
  property: PropertyLike | undefined,
  period: string
) {
  const items: ChargeItem[] = [
    {
      key: "rent",
      label: "Alquiler",
      amount: resolveTenantBaseRentForPeriod(tenantData, period)
    }
  ];

  const expensesAmount = resolveDepartmentExpenseAmount(property);
  if (expensesAmount > 0) {
    items.push({
      key: "expenses",
      label: "Expensas",
      amount: expensesAmount
    });
  }

  return items;
}

function resolveDepartmentExpenseAmount(property: PropertyLike | undefined) {
  return String(property?.unitType ?? "").trim() === "Departamento"
    ? DEPARTMENT_COMMON_EXPENSES
    : 0;
}

function resolveTenantBaseRentForPeriod(tenantData: Record<string, unknown>, period: string) {
  const currentBaseRent = Number(tenantData.baseRent ?? 0);
  const rentUpdateConfig = (tenantData.rentUpdateConfig ?? {}) as Record<string, unknown>;
  const billingEffectivePeriod = String(
    rentUpdateConfig.billingEffectivePeriod
      ?? addMonthsToPeriod(String(rentUpdateConfig.effectivePeriod ?? "").trim(), 1)
  ).trim();
  const pendingBaseRent = Number(
    rentUpdateConfig.pendingBaseRent
      ?? rentUpdateConfig.nextBaseRent
      ?? 0
  );

  if (
    billingEffectivePeriod
    && period >= billingEffectivePeriod
    && Number.isFinite(pendingBaseRent)
    && pendingBaseRent > 0
  ) {
    return pendingBaseRent;
  }

  return Number.isFinite(currentBaseRent) && currentBaseRent > 0 ? currentBaseRent : 0;
}

function resolveTenantDueDayOfMonth(tenantData: Record<string, unknown>, settings: GeneralSettings) {
  const tenantDueDay = Number(tenantData.dueDayOfMonth ?? 0);
  if (Number.isFinite(tenantDueDay) && tenantDueDay >= 1 && tenantDueDay <= 28) {
    return Math.trunc(tenantDueDay);
  }

  return settings.dueDayOfMonth;
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

function buildInitialChargeState(dueDate: string, subtotal: number, settings: GeneralSettings) {
  const today = startOfDay(new Date());
  const chargeDay = startOfDay(new Date(`${dueDate}T00:00:00`));
  const overdueDays = chargeDay < today
    ? Math.max(0, Math.floor((today.getTime() - chargeDay.getTime()) / 86400000))
    : 0;
  const lateFeeAmount = overdueDays > 0
    ? roundCurrency(subtotal * settings.lateFeeDailyRate * overdueDays)
    : 0;
  const total = roundCurrency(subtotal + lateFeeAmount);

  return {
    overdueDays,
    lateFeeAmount,
    total,
    status: overdueDays > 0 ? "overdue" : "pending"
  } as const;
}

function resolveInitialDueDate(nominalDueDate: string, generationDate: Date) {
  const generatedDay = startOfDay(generationDate);
  const nominalDay = startOfDay(new Date(`${nominalDueDate}T00:00:00`));

  if (Number.isNaN(nominalDay.getTime()) || nominalDay >= generatedDay) {
    return nominalDueDate;
  }

  const nextMonthDueDay = new Date(nominalDay);
  nextMonthDueDay.setMonth(nextMonthDueDay.getMonth() + 1);
  return formatDateOnly(nextMonthDueDay);
}

async function reconcileOpenCharges(actorUserId: string) {
  const settings = await getGeneralSettings();
  const snapshot = await db.collection("charges").get();
  const today = startOfDay(new Date());
  let updated = 0;

  for (const chargeDoc of snapshot.docs) {
    const charge = chargeDoc.data() as Partial<ChargeRecord> & {
      status?: string;
      tenantId?: string;
      overdueNotificationSentAt?: string;
    };

    if (!charge || ["paid", "cancelled"].includes(String(charge.status ?? ""))) {
      continue;
    }

    const subtotal = Number(charge.subtotal ?? 0);
    const dueDate = String(charge.dueDate ?? "");

    if (!subtotal || !dueDate) {
      continue;
    }

    const chargeDay = startOfDay(new Date(`${dueDate}T00:00:00`));
    const overdueDays = chargeDay < today
      ? Math.max(0, Math.floor((today.getTime() - chargeDay.getTime()) / 86400000))
      : 0;

    const effectiveRate = Number(charge.lateFeeDailyRate ?? settings.lateFeeDailyRate ?? DEFAULT_GENERAL_SETTINGS.lateFeeDailyRate);
    const lateFeeAmount = overdueDays > 0
      ? roundCurrency(subtotal * effectiveRate * overdueDays)
      : 0;
    const total = roundCurrency(subtotal + lateFeeAmount);
    const currentStatus = String(charge.status ?? "pending");
    const nextStatus = resolveChargeStatus(currentStatus, overdueDays);
    const currentLateFee = Number(charge.lateFeeAmount ?? 0);
    const currentOverdueDays = Number(charge.overdueDays ?? 0);
    const currentTotal = Number(charge.total ?? subtotal);

    if (
      nextStatus === currentStatus
      && currentLateFee === lateFeeAmount
      && currentOverdueDays === overdueDays
      && currentTotal === total
    ) {
      continue;
    }

      await chargeDoc.ref.set(
        {
          status: nextStatus,
        overdueDays,
        lateFeeAmount,
        lateFeeDailyRate: effectiveRate,
        total,
        updatedAt: nowIso(),
        updatedBy: actorUserId
      },
        { merge: true }
      );

      if (settings.autoNotifyOverdue && overdueDays > 0 && !charge.overdueNotificationSentAt) {
        const notification = await sendTenantNotification({
          tenantId: String(charge.tenantId ?? ""),
          type: "late_fee_notice",
          body: "Tu alquiler ya registra mora o vencimiento. Te recomendamos revisarlo cuanto antes.",
          channel: settings.defaultNotificationChannel,
          createdBy: actorUserId
        });

        if (notification.ok) {
          await chargeDoc.ref.set(
            {
              overdueNotificationSentAt: nowIso()
            },
            { merge: true }
          );
        }
      }

      updated += 1;
    }

  return { ok: true, updated };
}

async function getGeneralSettings(): Promise<GeneralSettings> {
  const snap = await db.collection("settings").doc("general").get();
  const data = snap.exists ? snap.data() ?? {} : {};

  return {
    lateFeeDailyRate: normalizeRate(data.lateFeeDailyRate, DEFAULT_GENERAL_SETTINGS.lateFeeDailyRate),
    reminderDaysBeforeDue: normalizeInteger(data.reminderDaysBeforeDue, DEFAULT_GENERAL_SETTINGS.reminderDaysBeforeDue),
    dueDayOfMonth: clamp(normalizeInteger(data.dueDayOfMonth, DEFAULT_GENERAL_SETTINGS.dueDayOfMonth), 1, 28),
    morosoAfterDays: clamp(normalizeInteger(data.morosoAfterDays, DEFAULT_GENERAL_SETTINGS.morosoAfterDays), 1, 120),
    defaultNotificationChannel: normalizeChannel(data.defaultNotificationChannel),
    autoNotifyNewCharge: normalizeBoolean(data.autoNotifyNewCharge, DEFAULT_GENERAL_SETTINGS.autoNotifyNewCharge),
    autoNotifyOverdue: normalizeBoolean(data.autoNotifyOverdue, DEFAULT_GENERAL_SETTINGS.autoNotifyOverdue)
  };
}

function canAutoApplyBillToProperty(
  billingGroup: unknown,
  property: PropertyLike | undefined
) {
  if (!billingGroup || !property) {
    return false;
  }

  const group = String(billingGroup);
  const unitType = String(property.unitType ?? "");
  const unitCode = String(property.unitCode ?? "");

  if (group === "electricity_departments") {
    return false;
  }

  if (group === "electricity_house") {
    return unitType === "Casa";
  }

  if (group.startsWith("electricity_local_")) {
    return unitType === "Local" && unitCode === group.replace("electricity_local_", "");
  }

  if (group === "water_departments_local_1") {
    return unitType === "Departamento" || (unitType === "Local" && unitCode === "1");
  }

  if (group === "water_locals_2_3") {
    return unitType === "Local" && ["2", "3"].includes(unitCode);
  }

  if (group === "water_house") {
    return unitType === "Casa";
  }

  return false;
}

function resolveChargeStatus(currentStatus: string, overdueDays: number) {
  if (currentStatus === "in_review") {
    return "in_review";
  }

  return overdueDays > 0 ? "overdue" : "pending";
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDateOnly(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function normalizeRate(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

function normalizeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) {
    return Math.round(parsed);
  }
  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeChannel(value: unknown): GeneralSettings["defaultNotificationChannel"] {
  const channel = String(value ?? "").trim();
  if (channel === "auto" || channel === "whatsapp" || channel === "sms" || channel === "email") {
    return channel;
  }
  return DEFAULT_GENERAL_SETTINGS.defaultNotificationChannel;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
