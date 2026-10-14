import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const require = createRequire(new URL("functions/package.json", root));
const ts = require("typescript");

function loadDeletionCore(dependencies) {
  const source = read("functions/src/modules/receiptDeletion.ts");
  const start = source.indexOf(
    "export async function deletePaymentReceiptRecord",
  );
  const end = source.indexOf("export const deletePaymentReceipt", start);
  assert.notEqual(start, -1, "missing deletion core");
  assert.notEqual(end, -1, "missing deletion callable boundary");
  const compiled = ts.transpileModule(
    source.slice(start, end).replace("export async function", "async function"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  return vm.runInNewContext(
    `${compiled}\ndeletePaymentReceiptRecord`,
    dependencies,
  );
}

function createDependencies({ storageError = null } = {}) {
  const calls = [];
  const batch = {
    delete(ref) {
      calls.push(["delete-document", ref.path]);
    },
    set(ref, value) {
      calls.push(["audit", ref.path, value]);
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

test("callable is exported and enforces scoped admin access", () => {
  const index = read("functions/src/index.ts");
  const backend = read("functions/src/modules/receiptDeletion.ts");
  assert.match(index, /deletePaymentReceipt/);
  assert.match(backend, /requireRole\(request, \["admin", "superadmin"\]\)/);
  assert.match(backend, /assertOwnerScopeAccess\(request, propertyId\)/);
});

test("admin receipt cards expose deletion and the handler confirms then refreshes", () => {
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

  assert.match(card, /data-delete-payment-receipt="\$\{receipt\.id\}"/);
  assert.match(handler, /window\.confirm/);
  assert.match(handler, /httpsCallable\(functions, "deletePaymentReceipt"\)/);
  assert.match(handler, /reloadScopedAdminOperation\(\)/);
});
