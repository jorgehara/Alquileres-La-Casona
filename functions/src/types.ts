import type { Timestamp } from "firebase-admin/firestore";

export type AppRole = "superadmin" | "admin" | "tenant";
export type OwnerScope = "all" | "enzo" | "ivo";
export type UserStatus = "active" | "inactive" | "disabled";

export type ChargeStatus =
  | "pending"
  | "overdue"
  | "in_review"
  | "paid"
  | "cancelled";

export type DerivedChargeStatus =
  | "pending"
  | "overdue"
  | "delinquent"
  | "in_review"
  | "paid"
  | "cancelled";

export type PaymentMethod = "transfer" | "mercado_pago";

export type PaymentStatus =
  | "reported"
  | "in_review"
  | "approved"
  | "rejected"
  | "provider_confirmed";

export interface AuthClaims {
  role?: AppRole;
  tenantId?: string;
  ownerScope?: OwnerScope;
  authVersion?: number;
  claimsUpdatedAt?: string;
}

export interface UserAuthProfile extends AuthClaims {
  role: AppRole;
  status: UserStatus;
  email?: string;
  displayName?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AuthContext {
  uid: string;
  role: AppRole;
  tenantId?: string;
  ownerScope: OwnerScope;
  profile: UserAuthProfile;
}

export type TenantInvitationStatus =
  | "pending"
  | "claimed"
  | "accepted"
  | "revoked";

export interface TenantInvitationRecord {
  tenantId: string;
  email: string;
  displayName?: string;
  status: TenantInvitationStatus;
  userId?: string;
  createdAt?: string | Timestamp;
  createdBy?: string;
  updatedAt?: string | Timestamp;
  claimedAt?: string | Timestamp;
  claimedBy?: string;
  legacyInvitationToken?: string;
  legacyInvitationId?: string;
  migratedFromLegacyId?: string;
}

export type TenantOnboardingStatus =
  | "not_sent"
  | "pending"
  | "claimed"
  | "accepted"
  | "revoked"
  | "self_registered";

export interface ChargeItem {
  key: "rent" | "expenses" | "electricity" | "water" | "late_fee" | "other";
  label: string;
  amount: number;
}

export interface ChargeRecord {
  tenantId: string;
  propertyId: string;
  period: string;
  items: ChargeItem[];
  subtotal: number;
  lateFeeAmount: number;
  lateFeeDailyRate?: number;
  overdueDays?: number;
  total: number;
  dueDate: string;
  status: ChargeStatus;
  paymentPolicy: "full_only" | "partial_allowed";
  generatedAt: string;
  generatedBy: string;
}
