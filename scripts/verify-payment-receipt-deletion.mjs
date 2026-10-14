import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const ts = createRequire(new URL("functions/package.json", root))(
  "typescript",
);

function loadCore(symbol, nextSymbol, dependencies) {
  const source = read("functions/src/modules/receiptDeletion.ts");
  const start = source.indexOf(`export async function ${symbol}`);
  const end = source.indexOf(nextSymbol, start);
  assert.notEqual(start, -1, `missing ${symbol} core`);
  assert.notEqual(end, -1, `missing ${symbol} boundary`);
  const compiled = ts.transpileModule(
    source.slice(start, end).replace("export async function", "async function"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return vm.runInNewContext(`${compiled}\n${symbol}`, dependencies);
}

const loadDeletionCore = (dependencies) =>
  loadCore(
    "deletePaymentReceiptRecord",
    "export const deletePaymentReceipt",
    dependencies,
  );

const loadPaymentDeletionCore = (dependencies) =>
  loadCore(
    "deletePaymentSubmissionRecord",
    "export const deletePaymentSubmission",
    dependencies,
  );

function createDependencies({ storageError = null } = {}) {
  const calls = [];
  const batch = {
    delete(ref) {
      calls.push(["delete-document", ref.path]);
    },
    set(ref, value) {
      calls.push([
        ref.path.startsWith("auditLogs/") ? "audit" : "set-document",
        ref.path,
        value,
      ]);
    },
    async commit() {
      calls.push(["commit"]);
    },
  };
  const db = {
    collection(name) {
      return {
        doc(id = "generated-audit-id") {
          return { path: `${name}/${id}` };
        },
      };
    },
    batch() {
      return batch;
    },
  };
  const storage = {
    bucket() {
      return {
        file(path) {
          return {
            async delete() {
              calls.push(["delete-file", path]);
              if (storageError) throw storageError;
            },
          };
        },
      };
    },
  };
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  return {
    calls,
    dependencies: {
      db,
      storage,
      HttpsError,
      nowIso: () => "2026-10-14T12:00:00.000Z",
    },
  };
}

const deletionInput = {
  receiptId: "receipt-1",
  receipt: {
    paymentId: "payment-1",
    tenantId: "tenant-1",
    fileName: "duplicado.jpg",
    storagePath: "payment-receipts/user/payment/duplicado.jpg",
  },
  actor: {
    uid: "admin-1",
    profile: { email: "admin@example.com", displayName: "Admin" },
  },
};

test("deletion removes the stored file and atomically records document deletion plus audit", async () => {
  const { calls, dependencies } = createDependencies();
  const remove = loadDeletionCore(dependencies);

  const result = await remove(deletionInput);

  assert.equal(result.ok, true);
  assert.equal(result.receiptId, "receipt-1");
  assert.deepEqual(calls[0], [
    "delete-file",
    "payment-receipts/user/payment/duplicado.jpg",
  ]);
  assert.deepEqual(calls[1], ["delete-document", "paymentReceipts/receipt-1"]);
  assert.equal(calls[2][0], "audit");
  assert.equal(calls[2][2].action, "payment_receipt_deleted");
  assert.equal(calls[2][2].metadata.fileName, "duplicado.jpg");
  assert.deepEqual(calls[3], ["commit"]);
});

test("missing storage objects do not prevent stale receipt cleanup", async () => {
  const error = Object.assign(new Error("not found"), { code: 404 });
  const { calls, dependencies } = createDependencies({ storageError: error });
  const remove = loadDeletionCore(dependencies);

  await remove(deletionInput);

  assert.ok(calls.some(([name]) => name === "delete-document"));
  assert.ok(calls.some(([name]) => name === "commit"));
});

test("unexpected storage failures preserve the Firestore record", async () => {
  const error = Object.assign(new Error("storage unavailable"), { code: 503 });
  const { calls, dependencies } = createDependencies({ storageError: error });
  const remove = loadDeletionCore(dependencies);

  await assert.rejects(remove(deletionInput), { code: "internal" });
  assert.ok(!calls.some(([name]) => name === "delete-document"));
  assert.ok(!calls.some(([name]) => name === "commit"));
});

test("deleting a duplicate payment removes its complete local graph and preserves a valid payment", async () => {
  const { calls, dependencies } = createDependencies();
  const remove = loadPaymentDeletionCore(dependencies);
  const result = await remove({
    paymentId: "payment-duplicate",
    payment: {
      chargeId: "charge-1",
      tenantId: "tenant-1",
      status: "approved",
    },
    charge: { status: "paid" },
    paymentReceipts: [
      {
        id: "receipt-1",
        data: {
          storagePath: "payment-receipts/user/payment/duplicate.jpg",
        },
      },
    ],
    rentReceipts: [
      {
        id: "payment_payment-duplicate",
        data: {
          pdfStoragePath:
            "rent-receipts/tenant-1/payment_payment-duplicate/receipt.pdf",
        },
      },
    ],
    remainingPayments: [
      {
        id: "payment-valid",
        data: {
          status: "approved",
          reportedPaidAt: "2026-10-10T12:00:00.000Z",
        },
      },
    ],
    actor: deletionInput.actor,
  });

  assert.equal(result.ok, true);
  assert.equal(result.paymentId, "payment-duplicate");
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "delete-document" &&
        call[1] === "payments/payment-duplicate",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "delete-document" &&
        call[1] === "paymentReceipts/receipt-1",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "delete-document" &&
        call[1] === "rentReceipts/payment_payment-duplicate",
    ),
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "set-document" &&
        call[1] === "charges/charge-1" &&
        call[2].status === "paid",
    ),
  );
  assert.ok(
    calls.some(
      (call) => call[0] === "audit" && call[2].action === "payment_deleted",
    ),
  );
});

test("deleting the only payment reopens the monthly charge", async () => {
  const { calls, dependencies } = createDependencies();
  const remove = loadPaymentDeletionCore(dependencies);
  const result = await remove({
    paymentId: "payment-only",
    payment: {
      chargeId: "charge-1",
      tenantId: "tenant-1",
      status: "in_review",
    },
    charge: { status: "in_review" },
    paymentReceipts: [],
    rentReceipts: [],
    remainingPayments: [],
    actor: deletionInput.actor,
  });

  assert.equal(result.chargeStatus, "pending");
  assert.ok(
    calls.some(
      (call) =>
        call[0] === "set-document" &&
        call[1] === "charges/charge-1" &&
        call[2].status === "pending" &&
        call[2].paidAt === null &&
        call[2].reportedPaidAt === null,
    ),
  );
});

test("payment deletion callable is exported and enforces scoped admin access", () => {
  const index = read("functions/src/index.ts");
  const backend = read("functions/src/modules/receiptDeletion.ts");
  assert.match(index, /deletePaymentSubmission/);
  assert.match(backend, /requireRole\(request, \["admin", "superadmin"\]\)/);
  assert.match(backend, /assertOwnerScopeAccess\(request, propertyId\)/);
});

test("the previously deployed receipt action deletes its linked payment too", () => {
  const backend = read("functions/src/modules/receiptDeletion.ts");
  const receiptCallable = backend.slice(
    backend.indexOf("export const deletePaymentReceipt"),
    backend.indexOf("async function resolveReceiptPropertyId"),
  );
  assert.match(receiptCallable, /receipt\.paymentId/);
  assert.match(receiptCallable, /deletePaymentSubmissionForRequest/);
});

test("admin payment cards delete the payment submission and then refresh", () => {
  const app = read("public/app.js");
  const card = app.slice(
    app.indexOf('<div class="receipt-review-list">'),
    app.indexOf(
      'data-open-section="mensajes"',
      app.indexOf('<div class="receipt-review-list">'),
    ),
  );
  const handlerStart = app.indexOf("async function handlePaymentReviewAction");
  const handler = app.slice(
    handlerStart,
    app.indexOf("async function handleRentReceiptSend", handlerStart),
  );

  assert.doesNotMatch(card, /data-delete-payment-receipt/);
  assert.match(handler, /data-delete-payment-submission/);
  assert.match(handler, /window\.confirm/);
  assert.match(
    handler,
    /httpsCallable\(\s*functions,\s*"deletePaymentSubmission",?\s*\)/,
  );
  assert.match(handler, /reloadScopedAdminOperation\(\)/);
});
