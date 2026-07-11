import { onCall, HttpsError } from "firebase-functions/https";
import JSZip = require("jszip");
import { db, storage } from "../firebase.js";
import { normalizeOwnerScope, requireRole, transferBlockToOwnerScope } from "../lib/auth.js";

type RentReceiptData = {
  paymentId?: string;
  tenantId?: string;
  apartmentId?: string;
  period?: string;
  receiptNumber?: string;
  pdfStoragePath?: string;
  ownerScope?: string;
};

type PaymentData = {
  propertyId?: string;
};

type PropertyData = {
  name?: string;
  unitCode?: string;
  ownerScope?: string;
  ownerId?: string;
  transferBlock?: string;
};

type TenantData = {
  fullName?: string;
  propertyId?: string;
  ownerScope?: string;
};

export const prepareRentReceiptsZip = onCall(async (request) => {
  const claims = await requireRole(request, ["admin", "superadmin"]);
  const receiptIds = Array.isArray(request.data?.receiptIds)
    ? request.data.receiptIds.map((value: unknown) => String(value || "").trim()).filter(Boolean)
    : [];
  const requestedPeriod = String(request.data?.period || "").trim();

  if (!receiptIds.length) {
    throw new HttpsError("invalid-argument", "No se recibieron recibos para descargar.");
  }

  const receiptSnapshots = await Promise.all(
    receiptIds.map((receiptId: string) => db.collection("rentReceipts").doc(receiptId).get())
  );

  const receiptRecords = receiptSnapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => ({
      id: snapshot.id,
      ...(snapshot.data() as RentReceiptData)
    }))
    .filter((receipt) => receipt.pdfStoragePath);

  if (!receiptRecords.length) {
    throw new HttpsError("not-found", "No encontramos recibos válidos para empaquetar.");
  }

  const paymentIds = [...new Set(receiptRecords.map((receipt) => String(receipt.paymentId || "")).filter(Boolean))];
  const tenantIds = [...new Set(receiptRecords.map((receipt) => String(receipt.tenantId || "")).filter(Boolean))];
  const propertyIdsFromReceipts = [...new Set(receiptRecords.map((receipt) => String(receipt.apartmentId || "")).filter(Boolean))];

  const [paymentSnapshots, tenantSnapshots, propertySnapshots] = await Promise.all([
    Promise.all(paymentIds.map((paymentId) => db.collection("payments").doc(paymentId).get())),
    Promise.all(tenantIds.map((tenantId) => db.collection("tenants").doc(tenantId).get())),
    Promise.all(propertyIdsFromReceipts.map((propertyId) => db.collection("properties").doc(propertyId).get()))
  ]);

  const paymentsById = new Map<string, PaymentData>(
    paymentSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() as PaymentData])
  );
  const tenantsById = new Map<string, TenantData>(
    tenantSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data() as TenantData])
  );

  const propertyIds = new Set(propertyIdsFromReceipts);
  receiptRecords.forEach((receipt) => {
    const tenant = tenantsById.get(String(receipt.tenantId || ""));
    const payment = paymentsById.get(String(receipt.paymentId || ""));
    if (tenant?.propertyId) {
      propertyIds.add(String(tenant.propertyId));
    }
    if (payment?.propertyId) {
      propertyIds.add(String(payment.propertyId));
    }
  });

  const extraPropertySnapshots = await Promise.all(
    [...propertyIds]
      .filter((propertyId) => !propertySnapshots.some((snapshot) => snapshot.id === propertyId))
      .map((propertyId) => db.collection("properties").doc(propertyId).get())
  );

  const propertiesById = new Map<string, PropertyData>(
    [...propertySnapshots, ...extraPropertySnapshots]
      .filter((snapshot) => snapshot.exists)
      .map((snapshot) => [snapshot.id, snapshot.data() as PropertyData])
  );

  const allowedReceipts = receiptRecords.filter((receipt) => {
    if (claims.role === "superadmin" || normalizeOwnerScope(claims.ownerScope) === "all") {
      return true;
    }

    const tenant = tenantsById.get(String(receipt.tenantId || ""));
    const payment = paymentsById.get(String(receipt.paymentId || ""));
    const propertyId = String(receipt.apartmentId || payment?.propertyId || tenant?.propertyId || "");
    const property = propertiesById.get(propertyId);
    return resolvePropertyOwnerScope(property, tenant, receipt) === normalizeOwnerScope(claims.ownerScope);
  });

  if (!allowedReceipts.length) {
    throw new HttpsError("permission-denied", "Tu cuenta no tiene acceso a esos recibos.");
  }

  const shouldGroupByOwner = claims.role === "superadmin" && new Set(
    allowedReceipts.map((receipt) => {
      const tenant = tenantsById.get(String(receipt.tenantId || ""));
      const payment = paymentsById.get(String(receipt.paymentId || ""));
      const property = propertiesById.get(String(receipt.apartmentId || payment?.propertyId || tenant?.propertyId || ""));
      return resolvePropertyOwnerScope(property, tenant, receipt);
    }).filter((scope) => scope === "enzo" || scope === "ivo")
  ).size > 1;

  const zip = new JSZip();
  for (const receipt of allowedReceipts) {
    const tenant = tenantsById.get(String(receipt.tenantId || ""));
    const payment = paymentsById.get(String(receipt.paymentId || ""));
    const property = propertiesById.get(String(receipt.apartmentId || payment?.propertyId || tenant?.propertyId || ""));
    const ownerScope = resolvePropertyOwnerScope(property, tenant, receipt);
    const folder = shouldGroupByOwner ? `${ownerLabel(ownerScope)}/` : "";
    const fileName = buildReceiptFileName(receipt, tenant, property);
    const [buffer] = await storage.bucket().file(String(receipt.pdfStoragePath)).download();
    zip.file(`${folder}${fileName}`, buffer);
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const fileName = buildZipName(allowedReceipts, requestedPeriod);
  const storagePath = `exports/rent-receipt-zips/${request.auth?.uid || "admin"}/${Date.now()}-${fileName}`;
  const downloadUrl = await uploadZipFile(storagePath, zipBuffer);

  return {
    ok: true,
    fileName,
    downloadUrl,
    count: allowedReceipts.length
  };
});

function resolvePropertyOwnerScope(property?: PropertyData, tenant?: TenantData, receipt?: RentReceiptData) {
  const explicitScope = normalizeOwnerScope(property?.ownerScope);
  if (explicitScope === "enzo" || explicitScope === "ivo") {
    return explicitScope;
  }

  const ownerId = String(property?.ownerId || "").trim().toLowerCase();
  if (ownerId === "owner_block_1" || ownerId === "enzo") {
    return "enzo";
  }
  if (ownerId === "owner_block_2" || ownerId === "ivo") {
    return "ivo";
  }

  const tenantScope = normalizeOwnerScope(tenant?.ownerScope);
  if (tenantScope === "enzo" || tenantScope === "ivo") {
    return tenantScope;
  }

  const receiptScope = normalizeOwnerScope(receipt?.ownerScope);
  if (receiptScope === "enzo" || receiptScope === "ivo") {
    return receiptScope;
  }

  return transferBlockToOwnerScope(property?.transferBlock);
}

function buildReceiptFileName(receipt: RentReceiptData & { id: string }, tenant?: TenantData, property?: PropertyData) {
  const period = String(receipt.period || "sin-periodo");
  const unit = sanitizeSegment(property?.unitCode || property?.name || "unidad");
  const tenantName = sanitizeSegment(tenant?.fullName || "inquilino");
  return `recibo-${period}-${unit}-${tenantName}.pdf`;
}

function buildZipName(receipts: Array<RentReceiptData & { id: string }>, requestedPeriod: string) {
  if (requestedPeriod) {
    return `recibos-${requestedPeriod}.zip`;
  }

  const periods = [...new Set(receipts.map((receipt) => String(receipt.period || "sin-periodo")))].sort();
  if (periods.length <= 1) {
    return `recibos-${periods[0] || "seleccion"}.zip`;
  }

  return `recibos-${periods[0]}-a-${periods[periods.length - 1]}.zip`;
}

function sanitizeSegment(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "archivo";
}

function ownerLabel(scope: string) {
  if (scope === "enzo") {
    return "Enzo";
  }
  if (scope === "ivo") {
    return "Ivo";
  }
  return "La-Casona";
}

async function uploadZipFile(storagePath: string, buffer: Buffer) {
  const downloadToken = randomToken(32);
  const bucket = storage.bucket();
  const file = bucket.file(storagePath);

  await file.save(buffer, {
    contentType: "application/zip",
    resumable: false,
    metadata: {
      cacheControl: "private, max-age=0, no-cache",
      metadata: {
        firebaseStorageDownloadTokens: downloadToken
      }
    }
  });

  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
}

function randomToken(length: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}
