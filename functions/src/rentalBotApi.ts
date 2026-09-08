import express, { type Response } from "express";
import { onRequest } from "firebase-functions/v2/https";
import { financialBotApiSecret } from "./config.js";
import { db } from "./firebase.js";
import { normalizeOwnerScope, transferBlockToOwnerScope } from "./lib/auth.js";
import { deriveChargeState } from "./lib/chargeState.js";
import { sendTenantNotification } from "./modules/notifications.js";

type OwnerScope = "all" | "enzo" | "ivo";
type ScopedRecord = Record<string, unknown> & { id: string };
type ScopedCharge = ScopedRecord & {
  derivedChargeState: ReturnType<typeof deriveChargeState>;
};

const app = express();
app.use(express.json());
app.use((request, response, next) => {
  const secret = financialBotApiSecret.value();
  if (!secret || request.header("x-bot-secret") !== secret) {
    response.status(401).json({ ok: false, error: "No autorizado." });
    return;
  }
  next();
});

app.post("/overview", async (request, response) => {
  await handle(response, async () => {
    const scope = requireScope(request.body?.ownerScope);
    const data = await loadScopedRentalData(scope);
    const openCharges = data.charges.filter(
      (charge) => charge.derivedChargeState.isOpen,
    );
    const overdueCharges = openCharges.filter(
      (charge) => charge.derivedChargeState.isOverdue,
    );
    const delinquentCharges = openCharges.filter(
      (charge) => charge.derivedChargeState.isDelinquent,
    );
    const pendingTotal = openCharges.reduce(
      (sum, charge) => sum + Number(charge.total ?? 0),
      0,
    );
    const paidTotal = data.charges
      .filter((charge) => String(charge.status ?? "") === "paid")
      .reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);

    return {
      ok: true,
      whatsappMessage: [
        `Estado de alquileres (${scope === "all" ? "todos" : scope}):`,
        `Unidades: ${data.properties.length}`,
        `Inquilinos activos: ${data.tenants.filter((tenant) => String(tenant.status ?? "") === "active").length}`,
        `Cobros abiertos: ${openCharges.length} (${formatCurrency(pendingTotal)})`,
        `Cobros vencidos: ${overdueCharges.length}`,
        `Cobrado registrado: ${formatCurrency(paidTotal)}`,
        delinquentCharges.length
          ? `Morosos: ${buildTenantNames(delinquentCharges, data.tenants)}`
          : "No hay morosos.",
      ].join("\n"),
    };
  });
});

app.post("/tenantStatus", async (request, response) => {
  await handle(response, async () => {
    const scope = requireScope(request.body?.ownerScope);
    const query = String(request.body?.query ?? "")
      .trim()
      .toLocaleLowerCase("es-AR");
    if (!query) {
      throw new ApiError(400, "Indicá el nombre del inquilino.");
    }

    const data = await loadScopedRentalData(scope);
    const tenant = data.tenants.find((item) =>
      String(item.fullName ?? item.name ?? "")
        .toLocaleLowerCase("es-AR")
        .includes(query),
    );
    if (!tenant) {
      throw new ApiError(
        404,
        "No encontré ese inquilino dentro de tus departamentos.",
      );
    }

    const property = data.properties.find(
      (item) => item.id === String(tenant.propertyId ?? ""),
    );
    const charges = data.charges
      .filter((charge) => String(charge.tenantId ?? "") === tenant.id)
      .sort((left, right) =>
        String(right.period ?? "").localeCompare(String(left.period ?? "")),
      );
    const current = charges[0];

    return {
      ok: true,
      whatsappMessage: [
        `${String(tenant.fullName ?? tenant.name ?? "Inquilino")} - ${String(property?.name ?? "Unidad")}`,
        current
          ? `Período: ${String(current.period ?? "sin período")}`
          : "Sin cobros registrados.",
        current
          ? `Estado: ${humanizeChargeStatus(current.derivedChargeState.statusLabel ?? current.status)}`
          : "",
        current ? `Total: ${formatCurrency(Number(current.total ?? 0))}` : "",
        current?.dueDate ? `Vencimiento: ${String(current.dueDate)}` : "",
        Number(
          current?.derivedChargeState.overdueDays ?? current?.overdueDays ?? 0,
        ) > 0
          ? `Atraso: ${Number(current?.derivedChargeState.overdueDays ?? current?.overdueDays ?? 0)} días`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  });
});

app.post("/sendWarnings", async (request, response) => {
  await handle(response, async () => {
    const scope = requireScope(request.body?.ownerScope);
    const data = await loadScopedRentalData(scope);
    const settingsDoc = await db.collection("settings").doc("general").get();
    const channel = String(
      settingsDoc.get("defaultNotificationChannel") ?? "email",
    ) as "auto" | "whatsapp" | "sms" | "email";
    const openCharges = data.charges.filter(
      (charge) =>
        charge.derivedChargeState.isOpen &&
        !charge.derivedChargeState.isPreContract,
    );
    let sent = 0;
    let failed = 0;

    for (const charge of openCharges) {
      const overdue = charge.derivedChargeState.isOverdue;
      const result = await sendTenantNotification({
        tenantId: String(charge.tenantId ?? ""),
        type: overdue ? "late_fee_notice" : "due_reminder",
        body: overdue
          ? "Tu alquiler registra vencimiento o mora. Te recomendamos revisar el estado y regularizarlo cuanto antes."
          : "Te recordamos que tenés un cobro de alquiler pendiente. Podés revisar el detalle y las formas de pago desde el portal.",
        channel,
        createdBy: `financial-bot:${scope}`,
      });
      result.ok ? (sent += 1) : (failed += 1);
    }

    return {
      ok: failed === 0,
      whatsappMessage: failed
        ? `Se enviaron ${sent} avisos y ${failed} no pudieron entregarse.`
        : `Se enviaron ${sent} avisos de pago.`,
      sent,
      failed,
    };
  });
});

app.use((_request, response) => {
  response.status(404).json({ ok: false, error: "Ruta no encontrada." });
});

export const rentalBotApi = onRequest({ region: "us-central1" }, app);

async function loadScopedRentalData(scope: OwnerScope) {
  const [propertiesSnapshot, tenantsSnapshot, chargesSnapshot, settingsDoc] =
    await Promise.all([
      db.collection("properties").get(),
      db.collection("tenants").get(),
      db.collection("charges").get(),
      db.collection("settings").doc("general").get(),
    ]);
  const properties = propertiesSnapshot.docs
    .map(mapDoc)
    .filter(
      (property) => scope === "all" || resolvePropertyScope(property) === scope,
    );
  const propertyIds = new Set(properties.map((property) => property.id));
  const tenants = tenantsSnapshot.docs
    .map(mapDoc)
    .filter((tenant) => propertyIds.has(String(tenant.propertyId ?? "")));
  const tenantIds = new Set(tenants.map((tenant) => tenant.id));
  const tenantsById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const morosoAfterDays = Math.max(
    1,
    Number(settingsDoc.get("morosoAfterDays") ?? 15),
  );
  const charges: ScopedCharge[] = chargesSnapshot.docs
    .map(mapDoc)
    .filter(
      (charge) =>
        propertyIds.has(String(charge.propertyId ?? "")) ||
        tenantIds.has(String(charge.tenantId ?? "")),
    )
    .map((charge) => {
      const tenant = tenantsById.get(String(charge.tenantId ?? ""));
      return {
        ...charge,
        derivedChargeState: deriveChargeState({
          status: charge.status,
          dueDate: charge.dueDate,
          overdueDays: charge.overdueDays,
          morosoAfterDays,
          contractStartDate: tenant?.contractStartDate,
          period: charge.period,
        }),
      };
    });
  return { properties, tenants, charges };
}

function mapDoc(document: FirebaseFirestore.QueryDocumentSnapshot) {
  return { id: document.id, ...document.data() } as ScopedRecord;
}

function resolvePropertyScope(property: Record<string, unknown>): OwnerScope {
  const explicit = normalizeOwnerScope(property.ownerScope);
  if (explicit !== "all") {
    return explicit;
  }
  return transferBlockToOwnerScope(property.transferBlock);
}

function requireScope(value: unknown): OwnerScope {
  const scope = normalizeOwnerScope(value);
  if (!["all", "enzo", "ivo"].includes(scope)) {
    throw new ApiError(400, "ownerScope inválido.");
  }
  return scope;
}

function buildTenantNames(
  charges: Array<Record<string, unknown>>,
  tenants: ScopedRecord[],
) {
  const names = new Set(
    charges.map((charge) => {
      const tenant = tenants.find(
        (item) => item.id === String(charge.tenantId ?? ""),
      );
      return String(tenant?.fullName ?? tenant?.name ?? "Sin inquilino");
    }),
  );
  return [...names].join(", ");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function humanizeChargeStatus(value: unknown) {
  const labels: Record<string, string> = {
    pending: "Pendiente",
    overdue: "Vencido",
    delinquent: "Moroso",
    in_review: "En revisión",
    paid: "Pagado",
    cancelled: "Cancelado",
  };
  return labels[String(value ?? "")] ?? "Sin estado";
}

class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function handle(
  response: Response,
  operation: () => Promise<Record<string, unknown>>,
) {
  try {
    response.json(await operation());
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 500;
    response.status(status).json({
      ok: false,
      error:
        status === 500
          ? "Error interno."
          : error instanceof Error
            ? error.message
            : "Error interno.",
    });
  }
}
