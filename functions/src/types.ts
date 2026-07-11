export type AppRole = "superadmin" | "admin" | "tenant";
export type OwnerScope = "all" | "enzo" | "ivo";

export type ChargeStatus =
  | "pending"
  | "overdue"
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
}

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
