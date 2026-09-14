import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const source = readFileSync(
  new URL("../public/app.js", import.meta.url),
  "utf8",
);

assert.match(
  source,
  /function resolveSummaryPeriod\(charges = \[\]\) \{\s*return resolveCurrentPeriodValue\(\);\s*\}/s,
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

console.log("Dashboard summary regression checks passed.");
