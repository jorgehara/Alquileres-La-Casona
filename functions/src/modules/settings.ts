import { onCall, HttpsError } from "firebase-functions/https";
import { db } from "../firebase.js";
import { requireRole } from "../lib/auth.js";
import { nowIso } from "../lib/utils.js";

export const upsertGeneralSettings = onCall(async (request) => {
  const claims = await requireRole(request, ["superadmin", "admin"]);

  const data = request.data as {
    lateFeeDailyRate?: number;
    reminderDaysBeforeDue?: number;
    dueDayOfMonth?: number;
    morosoAfterDays?: number;
    defaultNotificationChannel?: "auto" | "whatsapp" | "sms" | "email";
    autoNotifyNewCharge?: boolean;
    autoNotifyOverdue?: boolean;
    lastRentAdjustmentPercent?: number;
    bankAccountHolder?: string;
    bankAlias?: string;
    bankCbu?: string;
    enabledPaymentMethods?: string[];
    defaultMessageTemplates?: Record<string, string>;
    defaultRents?: {
      Departamento?: number;
      Casa?: number;
      Local?: number;
    };
  };

  if (claims.role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo un superadmin puede cambiar configuraciones sensibles."
    );
  }

  await db.collection("settings").doc("general").set(
    {
      ...data,
      updatedAt: nowIso(),
      updatedBy: request.auth?.uid ?? "system"
    },
    { merge: true }
  );

  return { ok: true };
});

export const applyRentAdjustment = onCall(async (request) => {
  const claims = await requireRole(request, ["superadmin", "admin"]);

  if (claims.role !== "superadmin") {
    throw new HttpsError(
      "permission-denied",
      "Solo un superadmin puede aplicar ajustes masivos de alquiler."
    );
  }

  const data = request.data as { percent?: number };
  const percent = Number(data.percent ?? 0);

  if (!Number.isFinite(percent) || percent === 0) {
    throw new HttpsError("invalid-argument", "Debes indicar un porcentaje distinto de cero.");
  }

  const multiplier = 1 + percent / 100;
  const tenantsSnapshot = await db.collection("tenants").where("status", "==", "active").get();
  let updated = 0;

  for (const tenantDoc of tenantsSnapshot.docs) {
    const currentBaseRent = Number(tenantDoc.get("baseRent") ?? 0);

    if (!Number.isFinite(currentBaseRent) || currentBaseRent <= 0) {
      continue;
    }

    const nextBaseRent = roundCurrency(currentBaseRent * multiplier);

    if (nextBaseRent === currentBaseRent) {
      continue;
    }

    await tenantDoc.ref.set(
      {
        baseRent: nextBaseRent,
        updatedAt: nowIso()
      },
      { merge: true }
    );
    await updateOpenChargesForTenantBaseRent(tenantDoc.id, nextBaseRent, request.auth?.uid ?? "system");
    updated += 1;
  }

  await db.collection("settings").doc("general").set(
    {
      lastRentAdjustmentPercent: percent,
      lastRentAdjustmentAppliedAt: nowIso(),
      updatedAt: nowIso(),
      updatedBy: request.auth?.uid ?? "system"
    },
    { merge: true }
  );

  return { ok: true, updated };
});

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function updateOpenChargesForTenantBaseRent(tenantId: string, baseRent: number, actorUserId: string) {
  const chargesSnapshot = await db.collection("charges").where("tenantId", "==", tenantId).get();

  for (const chargeDoc of chargesSnapshot.docs) {
    const charge = chargeDoc.data() as {
      status?: string;
      items?: Array<{ key?: string; label?: string; amount?: number }>;
      lateFeeAmount?: number;
    };

    if (["paid", "cancelled"].includes(String(charge.status ?? ""))) {
      continue;
    }

    const items = Array.isArray(charge.items) ? charge.items.map((item) => ({ ...item })) : [];
    const rentItemIndex = items.findIndex((item) => item.key === "rent");

    if (rentItemIndex >= 0) {
      items[rentItemIndex].amount = baseRent;
      items[rentItemIndex].label = "Alquiler";
      items[rentItemIndex].key = "rent";
    } else {
      items.unshift({
        key: "rent",
        label: "Alquiler",
        amount: baseRent
      });
    }

    const subtotal = roundCurrency(items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0));
    const lateFeeAmount = Number(charge.lateFeeAmount ?? 0);

    await chargeDoc.ref.set(
      {
        items,
        subtotal,
        total: roundCurrency(subtotal + lateFeeAmount),
        updatedAt: nowIso(),
        updatedBy: actorUserId
      },
      { merge: true }
    );
  }
}
