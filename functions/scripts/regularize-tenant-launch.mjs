import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const PROJECT_ID = "alquileres-la-casona";
const DEPARTMENT_RENT = 321680;
const DEPARTMENT_EXPENSES = 10000;
const ORPHAN_EMAILS_TO_NOTIFY = [
  "carlagauna1980@gmail.com",
  "aguirreevelynj@gmail.com",
  "galatoro81@gmail.com",
  "adricolman2802@gmail.com",
  "eaguirre@carplan.com.ar",
  "celes_017@hotmail.com"
];
const EMAILS_TO_EXCLUDE = new Set([
  "sophiadulka6@gmail.com",
  "celes_017@hotmai.com"
]);
const EMAIL_TO_DELETE = "claramentepodcast@gmail.com";

main().catch((error) => {
  console.error("regularize-tenant-launch failed");
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const env = await loadEnvFiles();
  const accessToken = await readFirebaseCliAccessToken();
  const authAccounts = await queryAuthAccounts(accessToken);
  const authByEmail = new Map(
    authAccounts
      .filter((account) => account.email)
      .map((account) => [String(account.email).trim().toLowerCase(), account])
  );

  const [properties, tenants, charges] = await Promise.all([
    listCollection(accessToken, "properties"),
    listCollection(accessToken, "tenants"),
    listCollection(accessToken, "charges")
  ]);

  const propertiesById = new Map(properties.map((doc) => [doc.id, doc]));
  const departmentTenantIds = new Set();

  for (const tenant of tenants) {
    const propertyId = String(tenant.data.propertyId ?? "").trim();
    const property = propertiesById.get(propertyId);
    if (String(property?.data.unitType ?? "").trim() !== "Departamento") {
      continue;
    }

    departmentTenantIds.add(tenant.id);
    await patchDocument(
      accessToken,
      `tenants/${tenant.id}`,
      {
        baseRent: DEPARTMENT_RENT,
        rentUpdateConfig: {
          ...(asPlainObject(tenant.data.rentUpdateConfig)),
          currentBaseRent: DEPARTMENT_RENT
        }
      },
      ["baseRent", "rentUpdateConfig.currentBaseRent"]
    );
  }

  for (const charge of charges) {
    if (!departmentTenantIds.has(String(charge.data.tenantId ?? "").trim())) {
      continue;
    }

    const status = String(charge.data.status ?? "").trim();
    if (status === "paid" || status === "cancelled") {
      continue;
    }

    const currentItems = Array.isArray(charge.data.items) ? charge.data.items : [];
    const preservedItems = currentItems.filter((item) => {
      const key = String(item?.key ?? "").trim();
      return key !== "rent" && key !== "expenses";
    });
    const updatedItems = [
      { key: "rent", label: "Alquiler", amount: DEPARTMENT_RENT },
      { key: "expenses", label: "Expensas", amount: DEPARTMENT_EXPENSES },
      ...preservedItems
    ];
    const subtotal = roundCurrency(
      updatedItems.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    );
    const lateFeeAmount = Number(charge.data.lateFeeAmount ?? 0);
    const total = roundCurrency(subtotal + lateFeeAmount);

    await patchDocument(
      accessToken,
      `charges/${charge.id}`,
      {
        items: updatedItems,
        subtotal,
        total
      },
      ["items", "subtotal", "total"]
    );
  }

  await patchDocument(
    accessToken,
    "settings/general",
    {
      defaultRents: {
        Departamento: DEPARTMENT_RENT
      }
    },
    ["defaultRents.Departamento"]
  );

  const deleteTarget = authByEmail.get(EMAIL_TO_DELETE);
  if (deleteTarget?.localId) {
    await deleteAuthAccount(accessToken, String(deleteTarget.localId));
  }

  const smtpTransporter = createTransporter(env);
  const sentEmails = [];
  for (const email of ORPHAN_EMAILS_TO_NOTIFY) {
    const normalizedEmail = String(email).trim().toLowerCase();
    if (EMAILS_TO_EXCLUDE.has(normalizedEmail)) {
      continue;
    }
    if (!authByEmail.has(normalizedEmail)) {
      continue;
    }

    await smtpTransporter.sendMail({
      from: env.EMAIL_FROM,
      to: normalizedEmail,
      subject: "La Casona - Completa tu acceso",
      text: buildAccountCompletionEmailText(env.WEBAPP_URL, normalizedEmail),
      html: buildAccountCompletionEmailHtml(env.WEBAPP_URL, normalizedEmail)
    });
    sentEmails.push(normalizedEmail);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        deletedAuthEmail: deleteTarget?.email ?? null,
        notified: sentEmails,
        updatedDepartmentTenants: departmentTenantIds.size
      },
      null,
      2
    )
  );
}

async function loadEnvFiles() {
  const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const files = [
    path.join(baseDir, ".env"),
    path.join(baseDir, `.env.${PROJECT_ID}`)
  ];
  const env = {};
  for (const file of files) {
    try {
      const content = await fs.readFile(file, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
          continue;
        }
        const separatorIndex = trimmed.indexOf("=");
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim();
        env[key] = value;
      }
    } catch {
      // optional env file
    }
  }

  for (const key of ["WEBAPP_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"]) {
    if (!env[key]) {
      throw new Error(`Missing ${key} in functions env files.`);
    }
  }

  return env;
}

async function readFirebaseCliAccessToken() {
  const configPath = path.join(
    os.homedir(),
    ".config",
    "configstore",
    "firebase-tools.json"
  );
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const token = String(parsed?.tokens?.access_token ?? "").trim();
  if (!token) {
    throw new Error("No Firebase CLI access token found.");
  }
  return token;
}

async function queryAuthAccounts(accessToken) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        returnUserInfo: true,
        maxResults: 1000
      })
    }
  );
  await ensureOk(response, "query auth accounts");
  const payload = await response.json();
  return Array.isArray(payload.userInfo) ? payload.userInfo : [];
}

async function deleteAuthAccount(accessToken, localId) {
  const attempts = [
    () =>
      fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:delete`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            localId
          })
        }
      ),
    () =>
      fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchDelete`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            localIds: [localId],
            force: true
          })
        }
      ),
    () =>
      fetch(
        `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT_ID}/accounts/${localId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      )
  ];

  const failures = [];
  for (const attempt of attempts) {
    const response = await attempt();
    if (response.ok) {
      return;
    }
    failures.push(`${response.status} ${await response.text()}`);
  }

  throw new Error(`delete auth account failed: ${failures.join(" | ")}`);
}

async function listCollection(accessToken, collectionId) {
  const results = [];
  let nextPageToken = "";

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collectionId}`
    );
    url.searchParams.set("pageSize", "200");
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    await ensureOk(response, `list ${collectionId}`);
    const payload = await response.json();
    for (const document of payload.documents ?? []) {
      results.push({
        name: document.name,
        id: document.name.split("/").at(-1),
        data: fromFirestoreFields(document.fields ?? {})
      });
    }
    nextPageToken = String(payload.nextPageToken ?? "").trim();
  } while (nextPageToken);

  return results;
}

async function patchDocument(accessToken, documentPath, data, fieldPaths) {
  const url = new URL(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${documentPath}`
  );
  for (const fieldPath of fieldPaths) {
    url.searchParams.append("updateMask.fieldPaths", fieldPath);
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      fields: toFirestoreFields(data)
    })
  });
  await ensureOk(response, `patch ${documentPath}`);
}

function toFirestoreFields(object) {
  const fields = {};
  for (const [key, value] of Object.entries(object)) {
    fields[key] = toFirestoreValue(value);
  }
  return fields;
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => toFirestoreValue(item))
      }
    };
  }
  if (typeof value === "number") {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (typeof value === "object") {
    return { mapValue: { fields: toFirestoreFields(value) } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreFields(fields) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    result[key] = fromFirestoreValue(value);
  }
  return result;
}

function fromFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) {
    return Array.isArray(value.arrayValue?.values)
      ? value.arrayValue.values.map((item) => fromFirestoreValue(item))
      : [];
  }
  if ("mapValue" in value) {
    return fromFirestoreFields(value.mapValue?.fields ?? {});
  }
  if ("timestampValue" in value) return value.timestampValue;
  return null;
}

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function createTransporter(env) {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT || 465),
    secure: Number(env.SMTP_PORT || 465) === 465,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  });
}

function buildAccountCompletionEmailText(portalUrl, email) {
  return [
    "Hola,",
    "",
    "Tu cuenta en La Casona ya fue creada, pero tu perfil de inquilino todavía no quedó terminado.",
    "",
    "Qué debes hacer ahora:",
    "1. Ingresa al portal con tu correo y contraseña.",
    "2. Si aparece Acceso pendiente, toca Completar perfil de inquilino.",
    "3. Completa tus datos y guarda el perfil.",
    "",
    `Portal: ${portalUrl}`,
    `Correo asociado: ${email}`,
    "",
    "Importante:",
    "- No vuelvas a crear otra cuenta con el mismo correo.",
    "- Si ya tienes cuenta, debes iniciar sesión con esa cuenta.",
    "- Si no recuerdas la contraseña, utiliza la opción de recuperación en el acceso.",
    "",
    "Si necesitas ayuda, comunícate con administración.",
    "La Casona Alquileres"
  ].join("\n");
}

function buildAccountCompletionEmailHtml(portalUrl, email) {
  return `
    <div style="margin:0;padding:0;background:#edf2ea;font-family:Arial,sans-serif;color:#17352a;">
      <div style="max-width:720px;margin:0 auto;padding:24px 16px;">
        <div style="background:#17352a;border-radius:24px 24px 0 0;padding:28px 24px;text-align:center;">
          <div style="font-size:32px;font-weight:800;letter-spacing:-0.04em;color:#ffffff;">La Casona</div>
          <div style="margin-top:8px;color:#dfe9e1;font-size:14px;">Completa tu acceso</div>
        </div>
        <div style="background:#f7faf7;padding:28px 24px 36px;border-radius:0 0 24px 24px;">
          <p style="margin:0 0 18px;font-size:18px;line-height:1.6;">Tu cuenta ya fue creada, pero tu perfil de inquilino todavía no quedó terminado.</p>
          <div style="padding:24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.10);">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Qué debes hacer</p>
            <ol style="margin:0;padding-left:18px;line-height:1.8;">
              <li>Ingresa al portal con tu correo y contraseña.</li>
              <li>Si aparece <strong>Acceso pendiente</strong>, toca <strong>Completar perfil de inquilino</strong>.</li>
              <li>Completa tus datos y guarda el perfil.</li>
            </ol>
            <div style="margin-top:18px;display:flex;justify-content:space-between;gap:16px;align-items:center;">
              <span style="color:#5b7266;font-size:14px;">Correo asociado</span>
              <strong style="margin:0;color:#17352a;font-size:16px;font-weight:700;">${escapeHtml(email)}</strong>
            </div>
            <a href="${escapeAttribute(portalUrl)}" style="display:block;margin-top:22px;text-align:center;text-decoration:none;background:#17352a;color:#ffffff;padding:16px 18px;border-radius:999px;font-weight:800;">
              Ingresar al portal
            </a>
          </div>
          <div style="margin-top:24px;padding:22px 24px;border-radius:20px;background:#ffffff;border:1px solid rgba(23,63,44,.08);">
            <p style="margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#6b7f73;font-weight:700;">Importante</p>
            <ul style="margin:0;padding-left:18px;line-height:1.7;">
              <li>No vuelvas a crear otra cuenta con el mismo correo.</li>
              <li>Si ya tienes cuenta, debes iniciar sesión con esa cuenta.</li>
              <li>Si no recuerdas la contraseña, utiliza la opción de recuperación en el acceso.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function roundCurrency(value) {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

async function ensureOk(response, action) {
  if (response.ok) {
    return;
  }
  const text = await response.text();
  throw new Error(`${action} failed: ${response.status} ${text}`);
}
