// No package test runner is configured. Run with Node's built-in test runner.
// Extract and transpile only the submission function: no Firebase initialization,
// credentials, network access, or execution of the regularization script.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const require = createRequire(new URL("functions/package.json", root));
const ts = require("typescript");
const source = read("functions/src/modules/payments.ts");
const submission = source
  .slice(
    source.indexOf("export async function processTransferPaymentSubmission"),
    source.indexOf("function inferTransferBlock"),
  )
  .replace("export async function", "async function");
const compiled = ts.transpileModule(submission, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

async function submit(
  payments,
  tenantId = "tenant-1",
  chargeId = "charge-1",
  chargeTenantId = tenantId,
) {
  const reads = [];
  const continueSubmission = new Error("continue normal receipt processing");
  const db = {
    collection(name) {
      reads.push(name);
      if (name === "charges")
        return {
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => ({ tenantId: chargeTenantId }),
            }),
          }),
        };
      if (name === "payments") {
        const filters = [];
        const query = {
          where(field, operator, value) {
            assert.equal(operator, "==");
            filters.push([field, value]);
            return query;
          },
          async get() {
            return {
              docs: payments
                .filter((payment) =>
                  filters.every(([field, value]) => payment[field] === value),
                )
                .map((payment) => ({ id: payment.id, data: () => payment })),
            };
          },
        };
        return query;
      }
      // Reaching this boundary means the existing submission path is preserved.
      if (name === "tenants") throw continueSubmission;
      throw new Error(`Unexpected access or write: ${name}`);
    },
  };
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const fn = vm.runInNewContext(
    `${compiled}\nprocessTransferPaymentSubmission`,
    { db, HttpsError },
  );
  try {
    return {
      result: await fn({
        tenantId,
        chargeId,
        amountReported: 366715,
        receiptIds: ["receipt-1"],
        createdBy: "actor",
      }),
      reads,
    };
  } catch (error) {
    if (error === continueSubmission) return { continued: true, reads };
    throw error;
  }
}
const payment = (overrides = {}) => ({
  id: "existing",
  tenantId: "tenant-1",
  chargeId: "charge-1",
  method: "transfer",
  status: "in_review",
  ...overrides,
});

for (const status of ["in_review", "approved", "reported"]) {
  test(`retry reuses ${status} payment before touching receipts`, async () => {
    const { result, reads } = await submit([payment({ status })]);
    assert.equal(result?.ok, true);
    assert.equal(result?.paymentId, "existing");
    assert.equal(result?.status, status);
    assert.deepEqual(reads, ["charges", "payments"]);
  });
}
for (const [name, records] of [
  ["no previous payment", []],
  ["rejected payment", [payment({ status: "rejected" })]],
  ["distinct charge", [payment({ chargeId: "other-charge" })]],
  ["distinct tenant", [payment({ tenantId: "other-tenant" })]],
  ["different method", [payment({ method: "mercado_pago" })]],
]) {
  test(`${name} preserves normal submission`, async () => {
    assert.equal((await submit(records)).continued, true);
  });
}
test("rejected record does not hide a reusable payment", async () => {
  const { result } = await submit([
    payment({ id: "rejected", status: "rejected" }),
    payment(),
  ]);
  assert.equal(result?.paymentId, "existing");
});
test("charge ownership is checked before payment reuse", async () => {
  await assert.rejects(
    submit([payment()], "tenant-1", "charge-1", "other-tenant"),
    { code: "permission-denied" },
  );
});
test("admin receipt list is the only receipt link source", () => {
  const app = read("public/app.js");
  const card = app.slice(
    app.indexOf('<div class="receipt-review-list">'),
    app.indexOf(
      'data-open-section="mensajes"',
      app.indexOf('<div class="receipt-review-list">'),
    ),
  );
  assert.ok(card.includes("${receipt.downloadURL}"));
  assert.equal((card.match(/>Ver comprobante<\/a>/g) ?? []).length, 1);
  assert.ok(!card.includes("paymentReceipts[0]"));
});
for (const status of ["paid", "cancelled", "pending"]) {
  test(`${status} charge respects current displayed base rent precedence`, () => {
    const app = read("public/app.js");
    const resolveRent = vm.runInNewContext(
      `${app.slice(
        app.indexOf("function resolveDisplayedBaseRent("),
        app.indexOf("function resolveChargeExpenseAmount("),
      )}\nresolveDisplayedBaseRent`,
      {
        resolveCurrentPeriodValue: () => "2026-10",
        addMonthsToPeriod: () => "",
        getDefaultRentForUnitType: (unitType) => {
          assert.equal(unitType, "Departamento");
          return 366715;
        },
      },
    );
    const property = { unitType: "Departamento" };
    const charge = {
      status,
      period: "2026-09",
      items: [{ key: "rent", amount: 100000 }],
    };
    const expected = status === "pending" ? 100000 : 366715;
    assert.equal(resolveRent({ baseRent: 366715 }, property, charge), expected);
    assert.equal(resolveRent(null, property, charge), expected);
    assert.equal(
      resolveRent(
        {
          baseRent: 400000,
          rentUpdateConfig: {
            currentBaseRent: 366715,
            billingEffectivePeriod: "2026-11",
          },
        },
        property,
        charge,
      ),
      expected,
    );
  });
}
test("missing-charge recovery advances past a terminal billed period", () => {
  const charges = read("functions/src/modules/charges.ts");
  const helperSource = charges.slice(
    charges.indexOf("function resolveEnsureChargePeriod("),
    charges.indexOf("function resolveTenantDueDayOfMonth("),
  );
  const helperCompiled = ts.transpileModule(helperSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const resolvePeriod = vm.runInNewContext(
    `${helperCompiled}\nresolveEnsureChargePeriod`,
  );

  assert.equal(resolvePeriod("2026-09", "2026-10", []), "2026-09");
  assert.equal(resolvePeriod("2026-09", "2026-10", ["paid"]), "2026-10");
  assert.equal(resolvePeriod("2026-09", "2026-10", ["cancelled"]), "2026-10");
  assert.equal(resolvePeriod("2026-09", "2026-10", ["pending"]), null);
  assert.equal(resolvePeriod("2026-10", "2026-10", ["paid"]), null);
});

test("confirmed rent feeds tenant, open charge, and default paths", () => {
  const regularize = read("functions/scripts/regularize-tenant-launch.mjs");
  assert.match(regularize, /const DEPARTMENT_RENT = 366715;/);
  for (const pattern of [
    /baseRent: DEPARTMENT_RENT/,
    /currentBaseRent: DEPARTMENT_RENT/,
    /key: "rent", label: "Alquiler", amount: DEPARTMENT_RENT/,
    /Departamento: DEPARTMENT_RENT/,
  ]) {
    assert.match(regularize, pattern);
  }
});
