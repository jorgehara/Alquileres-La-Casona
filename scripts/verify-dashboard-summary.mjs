import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const source = readFileSync(
  new URL("../public/app.js", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /function resolveSummaryPeriod\(_charges = \[\]\) \{\s*return resolveCurrentPeriodValue\(\);\s*\}/s,
  "Dashboard summary period must stay on the current month instead of falling back to stale charge periods.",
);

assert.match(
  source,
  /const openCharges = scopedCharges\.filter\(\(charge\) =>\s*\["pending", "overdue", "in_review"\]\.includes\(String\(charge\.status \|\| ""\)\),\s*\);/s,
  "Dashboard must define open charges by active receivable statuses only.",
);

assert.match(
  source,
  /const pendingCharges = openCharges;/,
  "Dashboard urgent/account-state list must exclude paid and cancelled charges.",
);

assert.doesNotMatch(
  source,
  /const pendingCharges = scopedCharges\.filter\(\s*\(charge\) => charge\.status !== "paid",\s*\);/s,
  "Dashboard must not treat cancelled charges as pending account debt.",
);

assert.match(
  source,
  /const monthlyConfirmedPayments = scopedPayments\.filter\(\(payment\) =>\s*isPaymentConfirmedInPeriod\(payment, summaryPeriod\),\s*\);/s,
  "Monthly collection must be based on payments confirmed during the current month.",
);

assert.match(
  source,
  /function resolvePaymentConfirmedAt\(payment\) \{\s*return resolveDisplayDate\([\s\S]*?payment\?\.approvedAt \?\?[\s\S]*?payment\?\.providerConfirmedAt \?\?[\s\S]*?payment\?\.paidAt \?\?[\s\S]*?payment\?\.reportedPaidAt \?\?[\s\S]*?payment\?\.createdAt,[\s\S]*?\);\s*\}/s,
  "Confirmed payment date must include approved/provider/contingency paid dates before falling back to creation time.",
);

assert.match(
  source,
  /function sumPaymentTotals\(payments\) \{[\s\S]*?amountConfirmed \?\? payment\.amountReported/s,
  "Monthly collection must sum confirmed payment amounts, including contingency payments.",
);

console.log("Dashboard summary regression checks passed.");
