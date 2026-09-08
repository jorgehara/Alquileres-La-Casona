import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const isDryRun = !args.has("--no-dry-run");

function loadServiceAccount() {
  const explicit = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (explicit && existsSync(explicit)) {
    return readServiceAccountCredential(explicit) ?? applicationDefault();
  }

  const localPath = resolve(process.cwd(), "serviceAccountKey.json");
  if (existsSync(localPath)) {
    return readServiceAccountCredential(localPath) ?? applicationDefault();
  }

  return applicationDefault();
}

function readServiceAccountCredential(path) {
  try {
    return cert(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    console.warn(
      `Could not read service account credentials from ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

const app = initializeApp({ credential: loadServiceAccount() });
const db = getFirestore(app);

function resolveContractStartPeriod(contractStartDate) {
  const value = String(contractStartDate ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[1]}-${match[2]}` : "";
}

async function main() {
  const [chargesSnapshot, tenantsSnapshot, paymentsSnapshot] =
    await Promise.all([
      db.collection("charges").get(),
      db.collection("tenants").get(),
      db.collection("payments").where("method", "==", "mercado_pago").get(),
    ]);

  const tenantsById = new Map(
    tenantsSnapshot.docs.map((doc) => [doc.id, doc.data() ?? {}]),
  );
  const invalidPreContractCharges = chargesSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((charge) => {
      const tenant = tenantsById.get(String(charge.tenantId ?? "")) ?? {};
      const contractStartPeriod = resolveContractStartPeriod(
        tenant.contractStartDate,
      );
      const period = String(charge.period ?? "").trim();
      return contractStartPeriod && period && period < contractStartPeriod;
    })
    .map((charge) => {
      const tenant = tenantsById.get(String(charge.tenantId ?? "")) ?? {};
      return {
        chargeId: charge.id,
        tenantId: String(charge.tenantId ?? ""),
        tenantName: String(tenant.fullName ?? tenant.name ?? "Sin inquilino"),
        propertyId: String(charge.propertyId ?? ""),
        period: String(charge.period ?? ""),
        status: String(charge.status ?? ""),
        total: Number(charge.total ?? 0),
        contractStartDate: String(tenant.contractStartDate ?? ""),
      };
    });

  const stuckMercadoPagoPayments = paymentsSnapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((payment) => String(payment.status ?? "") === "reported")
    .map((payment) => ({
      paymentId: payment.id,
      tenantId: String(payment.tenantId ?? ""),
      chargeId: String(payment.chargeId ?? ""),
      mercadoPagoPaymentId: String(payment.mercadoPagoPaymentId ?? ""),
      mercadoPagoPreferenceId: String(payment.mercadoPagoPreferenceId ?? ""),
      mercadoPagoStatus: String(payment.mercadoPagoStatus ?? ""),
      mercadoPagoStatusDetail: String(payment.mercadoPagoStatusDetail ?? ""),
      mercadoPagoSyncStatus: String(payment.mercadoPagoSyncStatus ?? ""),
      mercadoPagoLastSyncAt: String(payment.mercadoPagoLastSyncAt ?? ""),
      mercadoPagoLastSyncSource: String(
        payment.mercadoPagoLastSyncSource ?? "",
      ),
      mercadoPagoLastSyncError: String(payment.mercadoPagoLastSyncError ?? ""),
      mercadoPagoSyncAttempts: Number(payment.mercadoPagoSyncAttempts ?? 0),
      amountReported: Number(payment.amountReported ?? 0),
      createdAt: String(payment.createdAt ?? ""),
      updatedAt: String(payment.updatedAt ?? ""),
    }));

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: isDryRun ? "dry-run" : "report-only",
        invalidPreContractCharges,
        stuckMercadoPagoPayments,
        counts: {
          invalidPreContractCharges: invalidPreContractCharges.length,
          stuckMercadoPagoPayments: stuckMercadoPagoPayments.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
