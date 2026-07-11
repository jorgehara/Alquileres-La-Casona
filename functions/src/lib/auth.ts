import { HttpsError, CallableRequest } from "firebase-functions/https";
import { db } from "../firebase.js";
import { AuthClaims, AppRole, OwnerScope } from "../types.js";

export function getClaims(request: CallableRequest): AuthClaims {
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  return {
    role: token.role as AppRole | undefined,
    tenantId: token.tenantId as string | undefined,
    ownerScope: token.ownerScope as OwnerScope | undefined
  };
}

export async function resolveClaims(request: CallableRequest): Promise<AuthClaims> {
  const tokenClaims = getClaims(request);
  if (!request.auth?.uid) {
    return tokenClaims;
  }

  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!userDoc.exists) {
    return tokenClaims;
  }

  const userData = userDoc.data() ?? {};
  return {
    role: (userData.role as AppRole | undefined) ?? tokenClaims.role,
    tenantId: (userData.tenantId as string | undefined) ?? tokenClaims.tenantId,
    ownerScope: (userData.ownerScope as OwnerScope | undefined) ?? tokenClaims.ownerScope
  };
}

export async function requireRole(
  request: CallableRequest,
  allowedRoles: AppRole[]
): Promise<AuthClaims> {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  const claims = await resolveClaims(request);

  if (!claims.role || !allowedRoles.includes(claims.role)) {
    throw new HttpsError("permission-denied", "No tienes permisos para esta accion.");
  }

  return claims;
}

export function normalizeOwnerScope(value: unknown): OwnerScope {
  const scope = String(value ?? "").trim().toLowerCase();
  if (scope === "enzo" || scope === "ivo") {
    return scope;
  }

  return "all";
}

export function transferBlockToOwnerScope(value: unknown): OwnerScope {
  return String(value ?? "").trim() === "block_2" ? "ivo" : "enzo";
}

export async function assertOwnerScopeAccess(
  request: CallableRequest,
  propertyId: string
): Promise<AuthClaims> {
  const claims = await requireRole(request, ["admin", "superadmin"]);

  if (claims.role === "superadmin" || normalizeOwnerScope(claims.ownerScope) === "all") {
    return claims;
  }

  const propertyDoc = await db.collection("properties").doc(propertyId).get();
  if (!propertyDoc.exists) {
    throw new HttpsError("not-found", "No existe la unidad indicada.");
  }

  const property = propertyDoc.data() ?? {};
  const propertyOwnerScope = normalizeOwnerScope(
    property.ownerScope ?? property.ownerId ?? transferBlockToOwnerScope(property.transferBlock)
  );

  if (normalizeOwnerScope(claims.ownerScope) !== propertyOwnerScope) {
    throw new HttpsError(
      "permission-denied",
      "Tu cuenta no tiene alcance para operar sobre esta unidad."
    );
  }

  return claims;
}

export async function requireTenantOwner(
  request: CallableRequest,
  tenantId: string
): Promise<AuthClaims> {
  const claims = await requireRole(request, ["tenant", "admin", "superadmin"]);

  if (claims.role === "tenant" && claims.tenantId !== tenantId) {
    throw new HttpsError("permission-denied", "Solo puedes operar sobre tus propios datos.");
  }

  return claims;
}
