import type { ChargeStatus } from "../types.js";

type OpenChargeStatus = Extract<
  ChargeStatus,
  "pending" | "overdue" | "in_review"
>;

export type DerivedDelinquencyBucket =
  | "current"
  | "overdue"
  | "delinquent"
  | "in_review"
  | "closed"
  | "pre_contract";

export type DerivedChargeState = {
  bucket: DerivedDelinquencyBucket;
  statusLabel:
    | "pending"
    | "overdue"
    | "delinquent"
    | "in_review"
    | "paid"
    | "cancelled";
  overdueDays: number;
  isOpen: boolean;
  isOverdue: boolean;
  isDelinquent: boolean;
  isPreContract: boolean;
};

export function canGenerateChargeForPeriod(
  contractStartDate: unknown,
  period: string,
) {
  const contractStartPeriod = resolveContractStartPeriod(contractStartDate);
  if (!contractStartPeriod) {
    return true;
  }

  return period >= contractStartPeriod;
}

export function resolveContractStartPeriod(contractStartDate: unknown) {
  const value = String(contractStartDate ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return "";
  }

  return `${match[1]}-${match[2]}`;
}

export function deriveChargeState(input: {
  status: unknown;
  dueDate: unknown;
  overdueDays?: unknown;
  morosoAfterDays: number;
  contractStartDate?: unknown;
  period?: unknown;
  today?: Date;
}): DerivedChargeState {
  const status = String(input.status ?? "pending").trim() as
    | ChargeStatus
    | string;
  const isPreContract = isChargeBeforeContractStart(
    input.period,
    input.contractStartDate,
  );
  if (status === "paid") {
    return buildClosedState("paid");
  }
  if (status === "cancelled") {
    return buildClosedState("cancelled");
  }
  if (status === "in_review") {
    return {
      bucket: isPreContract ? "pre_contract" : "in_review",
      statusLabel: "in_review",
      overdueDays: 0,
      isOpen: true,
      isOverdue: false,
      isDelinquent: false,
      isPreContract,
    };
  }

  if (isPreContract) {
    return {
      bucket: "pre_contract",
      statusLabel: "pending",
      overdueDays: 0,
      isOpen: true,
      isOverdue: false,
      isDelinquent: false,
      isPreContract: true,
    };
  }

  const overdueDays = resolveOverdueDays(
    input.dueDate,
    input.overdueDays,
    input.today,
  );
  if (overdueDays <= 0) {
    return {
      bucket: "current",
      statusLabel: "pending",
      overdueDays: 0,
      isOpen: true,
      isOverdue: false,
      isDelinquent: false,
      isPreContract: false,
    };
  }

  const isDelinquent =
    overdueDays >= Math.max(1, Math.trunc(input.morosoAfterDays || 0));
  return {
    bucket: isDelinquent ? "delinquent" : "overdue",
    statusLabel: isDelinquent ? "delinquent" : "overdue",
    overdueDays,
    isOpen: true,
    isOverdue: true,
    isDelinquent,
    isPreContract: false,
  };
}

export function resolvePersistedOpenChargeStatus(input: {
  currentStatus: string;
  dueDate: unknown;
  overdueDays?: unknown;
  morosoAfterDays: number;
  contractStartDate?: unknown;
  period?: unknown;
  today?: Date;
}): OpenChargeStatus {
  if (input.currentStatus === "in_review") {
    return "in_review";
  }

  const derived = deriveChargeState({
    status: input.currentStatus,
    dueDate: input.dueDate,
    overdueDays: input.overdueDays,
    morosoAfterDays: input.morosoAfterDays,
    contractStartDate: input.contractStartDate,
    period: input.period,
    today: input.today,
  });
  return derived.isOverdue ? "overdue" : "pending";
}

export function isChargeBeforeContractStart(
  period: unknown,
  contractStartDate: unknown,
) {
  const normalizedPeriod = normalizePeriod(period);
  const contractStartPeriod = resolveContractStartPeriod(contractStartDate);
  return Boolean(
    normalizedPeriod &&
      contractStartPeriod &&
      normalizedPeriod < contractStartPeriod,
  );
}

function buildClosedState(
  statusLabel: "paid" | "cancelled",
): DerivedChargeState {
  return {
    bucket: "closed",
    statusLabel,
    overdueDays: 0,
    isOpen: false,
    isOverdue: false,
    isDelinquent: false,
    isPreContract: false,
  };
}

function resolveOverdueDays(
  dueDate: unknown,
  storedOverdueDays: unknown,
  today = new Date(),
) {
  const parsedDueDate = parseDateOnly(dueDate);
  if (!parsedDueDate) {
    const fallback = Number(storedOverdueDays ?? 0);
    return Number.isFinite(fallback) && fallback > 0 ? Math.trunc(fallback) : 0;
  }

  const delta = Math.floor(
    (startOfDay(today).getTime() - parsedDueDate.getTime()) / 86400000,
  );
  return delta > 0 ? delta : 0;
}

function normalizePeriod(value: unknown) {
  const normalized = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : "";
}

function parseDateOnly(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }

  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return startOfDay(parsed);
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}
