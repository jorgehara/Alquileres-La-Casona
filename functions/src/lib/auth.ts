import { HttpsError, CallableRequest } from "firebase-functions/https";
import { db } from "../firebase.js";
import { AuthClaims, AppRole, AuthContext, OwnerScope, UserAuthProfile } from "../types.js";

export function getClaims(request: CallableRequest): AuthClaims {
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  return {
    role: token.role as AppRole | undefined,
    tenantId: token.tenantId as string | undefined,
    ownerScope: token.ownerScope as OwnerScope | undefined,
    authVersion: typeof token.authVersion === "number" ? token.authVersion : undefined,
    claimsUpdatedAt: typeof token.claimsUpdatedAt === "string" ? token.claimsUpdatedAt : undefined
  };
}

export function claimsFromProfile(profile: UserAuthProfile): AuthClaims {
  if (profile.status !== "active") {
    return {};
  }

  if (profile.role === "tenant") {
    return withoutUndefined({
      role: "tenant",
      tenantId: profile.tenantId,
      authVersion: profile.authVersion,
      claimsUpdatedAt: profile.claimsUpdatedAt
    });
  }

  return withoutUndefined({
    role: profile.role,
    ownerScope: profile.role === "superadmin" ? "all" : normalizeOwnerScope(profile.ownerScope),
    authVersion: profile.authVersion,
    claimsUpdatedAt: profile.claimsUpdatedAt
  });
}

export async function resolveAuthContext(request: CallableRequest): Promise<AuthContext> {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesion.");
  }

  const userDoc = await db.collection("users").doc(request.auth.uid).get();
  if (!userDoc.exists) {
    throw new HttpsError("permission-denied", "Tu cuenta no tiene un perfil de acceso activo.");
  }

  const userData = userDoc.data() ?? {};
  const profile = normalizeAuthProfile(userData);

  if (profile.status !== "active") {
    throw new HttpsError("permission-denied", "Tu cuenta no esta activa.");
  }

  const context = normalizeAuthContext(request.auth.uid, profile);
  assertTokenDoesNotEscalate(getClaims(request), context);
  return context;
}

export async function resolveClaims(request: CallableRequest): Promise<AuthContext> {
  return resolveAuthContext(request);
}

function normalizeAuthProfile(data: Record<string, unknown>): UserAuthProfile {
  const role = data.role as AppRole | undefined;
  if (!role || !["superadmin", "admin", "tenant"].includes(role)) {
    throw new HttpsError("failed-precondition", "El perfil de acceso no tiene un rol valido.");
  }

  return withoutUndefined({
    role,
    status: normalizeUserStatus(data.status),
    tenantId: typeof data.tenantId === "string" ? data.tenantId : undefined,
    ownerScope: data.ownerScope as OwnerScope | undefined,
    email: typeof data.email === "string" ? data.email : undefined,
    displayName: typeof data.displayName === "string" ? data.displayName : undefined,
    authVersion: typeof data.authVersion === "number" ? data.authVersion : undefined,
    claimsUpdatedAt: typeof data.claimsUpdatedAt === "string" ? data.claimsUpdatedAt : undefined,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined
  }) as UserAuthProfile;
}

function normalizeAuthContext(uid: string, profile: UserAuthProfile): AuthContext {
  if (profile.role === "tenant") {
    if (!profile.tenantId) {
      throw new HttpsError("failed-precondition", "El perfil de inquilino no tiene tenantId.");
    }

    return {
      uid,
      role: "tenant",
      tenantId: profile.tenantId,
      ownerScope: "all",
      profile
    };
  }

  return {
    uid,
    role: profile.role,
    ownerScope: profile.role === "superadmin" ? "all" : normalizeOwnerScope(profile.ownerScope),
    profile
  };
}

function normalizeUserStatus(value: unknown) {
  const status = String(value ?? "active").trim().toLowerCase();
  return status === "active" ? "active" : status === "disabled" ? "disabled" : "inactive";
}

function assertTokenDoesNotEscalate(tokenClaims: AuthClaims, context: AuthContext) {
  if (tokenClaims.role && tokenClaims.role !== context.role) {
    throw new HttpsError("failed-precondition", "Tu sesion necesita actualizar permisos antes de continuar.");
  }

  if (context.role === "tenant" && tokenClaims.tenantId && tokenClaims.tenantId !== context.tenantId) {
    throw new HttpsError("failed-precondition", "Tu sesion necesita actualizar el inquilino asignado.");
  }

  if (context.role !== "tenant" && tokenClaims.ownerScope && normalizeOwnerScope(tokenClaims.ownerScope) !== context.ownerScope) {
    throw new HttpsError("failed-precondition", "Tu sesion necesita actualizar el alcance de administracion.");
  }

  if (typeof context.profile.authVersion === "number" && typeof tokenClaims.authVersion === "number" && tokenClaims.authVersion !== context.profile.authVersion) {
    throw new HttpsError("failed-precondition", "Tu sesion necesita refrescar permisos.");
  }
}

export async function requireRole(
  request: CallableRequest,
  allowedRoles: AppRole[]
): Promise<AuthContext> {
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
): Promise<AuthContext> {
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
): Promise<AuthContext> {
  const claims = await requireRole(request, ["tenant", "admin", "superadmin"]);

  if (claims.role === "tenant" && claims.tenantId !== tenantId) {
    throw new HttpsError("permission-denied", "Solo puedes operar sobre tus propios datos.");
  }

  return claims;
}

function withoutUndefined<T extends object>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}
