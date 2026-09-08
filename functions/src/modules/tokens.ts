import { onCall, onRequest, HttpsError } from "firebase-functions/https";
import { db, storage } from "../firebase.js";
import { requireRole } from "../lib/auth.js";
import { nowIso, randomToken } from "../lib/utils.js";
import {
  backendBaseUrl,
  mercadoPagoAccessToken,
  webAppUrl,
} from "../config.js";
import { processTransferPaymentSubmission } from "./payments.js";

const DEFAULT_WEBAPP_URL = "http://127.0.0.1:5000";

function parseHttpUrl(rawValue: string) {
  const candidate = String(rawValue || "").trim();
  if (!candidate) {
    return null;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function getWebAppBaseUrl() {
  const parsed = parseHttpUrl(webAppUrl.value());
  return parsed ? parsed.toString().replace(/\/$/, "") : DEFAULT_WEBAPP_URL;
}

function getWebAppOrigin() {
  return parseHttpUrl(getWebAppBaseUrl())?.origin ?? "http://127.0.0.1:5000";
}

function getWebhookUrl() {
  const normalizedBaseUrl = parseHttpUrl(backendBaseUrl.value());
  if (!normalizedBaseUrl) {
    return "";
  }
  return new URL(
    "handleMercadoPagoWebhook",
    `${normalizedBaseUrl.toString().replace(/\/?$/, "/")}`,
  ).toString();
}

function applyCors(
  response: { set: (name: string, value: string) => unknown },
  origin?: string | null,
) {
  const configuredOrigin = getWebAppOrigin();
  const allowedOrigins = new Set([
    configuredOrigin,
    "https://alquilereslacasona.com.ar",
    "https://alquileres-la-casona.web.app",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
  ]);

  const safeOrigin =
    origin && allowedOrigins.has(origin) ? origin : configuredOrigin;
  response.set("Access-Control-Allow-Origin", safeOrigin);
  response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Vary", "Origin");
}

export const createPaymentAccessToken = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as {
    chargeId?: string;
    expiresInHours?: number;
  };

  if (!data.chargeId) {
    throw new HttpsError("invalid-argument", "chargeId es obligatorio.");
  }

  const token = randomToken(48);
  const expiresInHours = Math.max(Number(data.expiresInHours ?? 72), 1);
  const expiresAt = new Date(
    Date.now() + expiresInHours * 60 * 60 * 1000,
  ).toISOString();

  await db
    .collection("paymentAccessTokens")
    .doc(token)
    .set({
      token,
      chargeId: data.chargeId,
      status: "active",
      createdAt: nowIso(),
      expiresAt,
      createdBy: request.auth?.uid ?? "system",
    });

  return { ok: true, token, expiresAt };
});

export const resolvePaymentAccessToken = onRequest(
  async (request, response) => {
    applyCors(response, request.headers.origin);

    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }

    const token = String(request.query.token ?? "");
    if (!token) {
      response.status(400).json({ ok: false, error: "missing_token" });
      return;
    }

    const tokenDoc = await db
      .collection("paymentAccessTokens")
      .doc(token)
      .get();
    if (!tokenDoc.exists) {
      response.status(404).json({ ok: false, error: "token_not_found" });
      return;
    }

    const tokenData = tokenDoc.data() ?? {};
    if (
      tokenData.status !== "active" ||
      new Date(tokenData.expiresAt) < new Date()
    ) {
      response.status(410).json({ ok: false, error: "token_expired" });
      return;
    }

    const chargeDoc = await db
      .collection("charges")
      .doc(String(tokenData.chargeId))
      .get();
    if (!chargeDoc.exists) {
      response.status(404).json({ ok: false, error: "charge_not_found" });
      return;
    }

    const charge = chargeDoc.data() ?? {};
    const propertyDoc = charge.propertyId
      ? await db.collection("properties").doc(String(charge.propertyId)).get()
      : null;

    response.json({
      ok: true,
      chargeId: chargeDoc.id,
      charge,
      property: propertyDoc?.exists ? propertyDoc.data() : null,
    });
  },
);

export const createCheckoutFromPaymentAccessToken = onRequest(
  async (request, response) => {
    applyCors(response, request.headers.origin);

    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }

    const token = String(request.query.token ?? request.body?.token ?? "");
    if (!token) {
      response.status(400).json({ ok: false, error: "missing_token" });
      return;
    }

    const tokenDoc = await db
      .collection("paymentAccessTokens")
      .doc(token)
      .get();
    if (!tokenDoc.exists) {
      response.status(404).json({ ok: false, error: "token_not_found" });
      return;
    }

    const tokenData = tokenDoc.data() ?? {};
    if (
      tokenData.status !== "active" ||
      new Date(tokenData.expiresAt) < new Date()
    ) {
      response.status(410).json({ ok: false, error: "token_expired" });
      return;
    }

    const chargeDoc = await db
      .collection("charges")
      .doc(String(tokenData.chargeId))
      .get();
    if (!chargeDoc.exists) {
      response.status(404).json({ ok: false, error: "charge_not_found" });
      return;
    }

    const charge = chargeDoc.data() ?? {};
    const accessToken = mercadoPagoAccessToken.value();
    const webhookUrl = getWebhookUrl();

    if (!accessToken || !webhookUrl) {
      response
        .status(500)
        .json({ ok: false, error: "provider_not_configured" });
      return;
    }

    const paymentRef = await db.collection("payments").add({
      tenantId: String(charge.tenantId ?? ""),
      chargeId: chargeDoc.id,
      method: "mercado_pago",
      amountReported: Number(charge.total ?? 0),
      amountConfirmed: 0,
      status: "reported",
      createdAt: nowIso(),
      createdBy: "payment-access-token",
    });

    const preferencePayload = {
      items: [
        {
          id: chargeDoc.id,
          title: `Alquiler ${charge.period ?? ""}`.trim(),
          quantity: 1,
          currency_id: "ARS",
          unit_price: Number(charge.total ?? 0),
        },
      ],
      external_reference: paymentRef.id,
      notification_url: webhookUrl,
      back_urls: {
        success: `${getWebAppBaseUrl()}/?token=${token}&mp_status=success`,
        failure: `${getWebAppBaseUrl()}/?token=${token}&mp_status=failure`,
        pending: `${getWebAppBaseUrl()}/?token=${token}&mp_status=pending`,
      },
      auto_return: "approved",
      metadata: {
        paymentId: paymentRef.id,
        chargeId: chargeDoc.id,
        tenantId: String(charge.tenantId ?? ""),
      },
    };

    const preferenceResponse = await fetch(
      "https://api.mercadopago.com/checkout/preferences",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(preferencePayload),
      },
    );

    if (!preferenceResponse.ok) {
      const errorBody = await preferenceResponse.text();
      response
        .status(502)
        .json({
          ok: false,
          error: "mercado_pago_preference_failed",
          detail: errorBody,
        });
      return;
    }

    const preference = (await preferenceResponse.json()) as {
      id: string;
      init_point?: string;
      sandbox_init_point?: string;
    };

    await paymentRef.set(
      {
        mercadoPagoPreferenceId: preference.id,
        mercadoPagoStatus: "preference_created",
        updatedAt: nowIso(),
      },
      { merge: true },
    );

    response.json({
      ok: true,
      checkoutUrl: preference.init_point ?? preference.sandbox_init_point ?? "",
    });
  },
);

export const submitTransferFromPaymentAccessToken = onRequest(
  async (request, response) => {
    applyCors(response, request.headers.origin);

    if (request.method === "OPTIONS") {
      response.status(204).send("");
      return;
    }

    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "method_not_allowed" });
      return;
    }

    try {
      const token = String(
        request.query.token ?? request.body?.token ?? "",
      ).trim();
      const amountReported = Number(request.body?.amountReported ?? 0);
      const files = Array.isArray(request.body?.files)
        ? request.body.files
        : [];

      if (!token) {
        response.status(400).json({ ok: false, error: "missing_token" });
        return;
      }

      if (!amountReported) {
        response.status(400).json({ ok: false, error: "missing_amount" });
        return;
      }

      if (!files.length) {
        response.status(400).json({ ok: false, error: "missing_files" });
        return;
      }

      const tokenDoc = await db
        .collection("paymentAccessTokens")
        .doc(token)
        .get();
      if (!tokenDoc.exists) {
        response.status(404).json({ ok: false, error: "token_not_found" });
        return;
      }

      const tokenData = tokenDoc.data() ?? {};
      if (
        tokenData.status !== "active" ||
        new Date(tokenData.expiresAt) < new Date()
      ) {
        response.status(410).json({ ok: false, error: "token_expired" });
        return;
      }

      const chargeId = String(tokenData.chargeId ?? "");
      const chargeDoc = await db.collection("charges").doc(chargeId).get();
      if (!chargeDoc.exists) {
        response.status(404).json({ ok: false, error: "charge_not_found" });
        return;
      }

      const charge = chargeDoc.data() ?? {};
      const tenantId = String(charge.tenantId ?? "");
      if (!tenantId) {
        response.status(400).json({ ok: false, error: "tenant_not_found" });
        return;
      }

      const receiptIds: string[] = [];
      for (const file of files.slice(0, 2)) {
        const savedReceiptId = await saveTokenReceipt({
          token,
          tenantId,
          file: {
            name: String(file?.name ?? "comprobante"),
            type: String(file?.type ?? "application/octet-stream"),
            dataBase64: String(file?.dataBase64 ?? ""),
          },
        });
        receiptIds.push(savedReceiptId);
      }

      const result = await processTransferPaymentSubmission({
        tenantId,
        chargeId,
        amountReported,
        receiptIds,
        createdBy: `payment-access-token:${token}`,
      });

      response.json(result);
    } catch (error) {
      const message =
        error instanceof HttpsError
          ? error.message
          : error instanceof Error
            ? error.message
            : "No se pudo validar el comprobante.";
      const status =
        error instanceof HttpsError ? mapHttpsStatus(error.code) : 500;
      response
        .status(status)
        .json({
          ok: false,
          error: "transfer_validation_failed",
          detail: message,
        });
    }
  },
);

async function saveTokenReceipt(input: {
  token: string;
  tenantId: string;
  file: {
    name: string;
    type: string;
    dataBase64: string;
  };
}) {
  if (!input.file.dataBase64) {
    throw new HttpsError(
      "invalid-argument",
      "Uno de los comprobantes llego vacio.",
    );
  }

  const fileBuffer = decodeBase64File(input.file.dataBase64);
  if (!fileBuffer.length) {
    throw new HttpsError(
      "invalid-argument",
      "Uno de los comprobantes no pudo procesarse.",
    );
  }

  if (fileBuffer.length > 6 * 1024 * 1024) {
    throw new HttpsError(
      "invalid-argument",
      "Cada comprobante debe pesar menos de 6 MB.",
    );
  }

  const receiptRef = db.collection("paymentReceipts").doc();
  const safeName = `${Date.now()}-${sanitizeFileName(input.file.name || "comprobante")}`;
  const storagePath = `payment-receipts/payment-access/${input.token}/${receiptRef.id}/${safeName}`;
  const downloadToken = randomToken(24);

  await storage
    .bucket()
    .file(storagePath)
    .save(fileBuffer, {
      contentType: input.file.type || "application/octet-stream",
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
        },
      },
    });

  const bucketName = storage.bucket().name;
  const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

  await receiptRef.set({
    paymentId: null,
    tenantId: input.tenantId,
    storagePath,
    downloadURL,
    fileName: input.file.name,
    fileType: input.file.type || "application/octet-stream",
    source: "payment_access_token",
    claudeExtractionStatus: "pending",
    createdAt: nowIso(),
  });

  return receiptRef.id;
}

function decodeBase64File(value: string) {
  const normalized = value.includes(",")
    ? (value.split(",").pop() ?? "")
    : value;
  return Buffer.from(normalized, "base64");
}

function sanitizeFileName(value: string) {
  return value.replace(/[^\w.-]+/g, "-");
}

function mapHttpsStatus(code: string) {
  switch (code) {
    case "invalid-argument":
      return 400;
    case "permission-denied":
      return 403;
    case "not-found":
      return 404;
    case "failed-precondition":
      return 412;
    default:
      return 500;
  }
}
