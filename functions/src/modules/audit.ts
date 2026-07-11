import { onCall, HttpsError } from "firebase-functions/https";
import { db } from "../firebase.js";
import { requireRole } from "../lib/auth.js";
import { nowIso } from "../lib/utils.js";

export const writeAuditLog = onCall(async (request) => {
  await requireRole(request, ["admin", "superadmin"]);

  const data = request.data as {
    action?: string;
    entityType?: string;
    entityId?: string;
    summary?: string;
    metadata?: Record<string, unknown>;
  };

  if (!data.action || !data.entityType || !data.summary) {
    throw new HttpsError("invalid-argument", "action, entityType y summary son obligatorios.");
  }

  const actorDoc = request.auth?.uid
    ? await db.collection("users").doc(request.auth.uid).get()
    : null;
  const actor = actorDoc?.exists ? actorDoc.data() ?? {} : {};

  const logRef = await db.collection("auditLogs").add({
    action: String(data.action),
    entityType: String(data.entityType),
    entityId: String(data.entityId ?? ""),
    summary: String(data.summary),
    metadata: data.metadata ?? {},
    actorUid: request.auth?.uid ?? "system",
    actorEmail: request.auth?.token.email ?? actor.email ?? "",
    actorName: actor.displayName ?? request.auth?.token.email ?? "Administrador",
    createdAt: nowIso()
  });

  return { ok: true, auditLogId: logRef.id };
});
