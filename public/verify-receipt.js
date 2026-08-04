const form = document.querySelector("#receipt-verify-form");
const codeInput = document.querySelector("#receipt-verify-code");
const message = document.querySelector("#receipt-verify-message");
const result = document.querySelector("#receipt-verify-result");

const codeFromUrl = new URLSearchParams(window.location.search).get("code") || "";
if (codeFromUrl) {
  codeInput.value = codeFromUrl;
  verifyReceipt(codeFromUrl);
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await verifyReceipt(codeInput.value.trim());
});

async function verifyReceipt(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();

  if (!code) {
    setMessage("Ingresá un código de verificación válido.", "error");
    result.innerHTML = "";
    return;
  }

  setMessage("Verificando comprobante...");
  result.innerHTML = `<article class="entity-card"><p>Buscando datos del comprobante...</p></article>`;

  try {
    const response = await fetch(resolveRuntimeApiUrl("verifyPaymentReceipt", { code }));
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error("No encontramos un comprobante con ese código.");
    }

    const receipt = payload.receipt || {};
    setMessage("Comprobante verificado correctamente.", "success");
    result.innerHTML = `
      <article class="entity-card receipt-verify-result-card">
        <div class="charge-tags">
          <span class="status ${toneFromReceiptStatus(receipt.status)}">${humanizeReceiptStatus(receipt.status)}</span>
        </div>
        <h3>${receipt.receiptNumber || "Comprobante"}</h3>
        <p><strong>Locador:</strong> ${receipt.ownerName || "No informado"}</p>
        <p><strong>Inquilino:</strong> ${receipt.tenantName || "No informado"}</p>
        <p><strong>Unidad:</strong> ${receipt.apartmentLabel || "No informada"}</p>
        <p><strong>Monto:</strong> ${formatCurrency(receipt.amount || 0)}</p>
        <p><strong>Período:</strong> ${receipt.period || "No informado"}</p>
        <p><strong>Fecha de emisión:</strong> ${formatDateTime(receipt.issuedAt)}</p>
        <p><strong>Fecha de pago:</strong> ${formatDateTime(receipt.effectivePaidAt)}</p>
        <p><strong>Payment ID:</strong> ${receipt.paymentId || "No informado"}</p>
        <p><strong>Código:</strong> ${receipt.verificationCode || code}</p>
        ${receipt.pdfUrl ? `<a class="entity-link" href="${receipt.pdfUrl}" target="_blank" rel="noreferrer">Abrir PDF del comprobante</a>` : ""}
      </article>
    `;
  } catch (error) {
    console.error(error);
    setMessage(error.message || "No pudimos verificar el comprobante.", "error");
    result.innerHTML = "";
  }
}

function resolveRuntimeApiUrl(functionName, params = {}) {
  if (!window.LaCasonaRuntime?.resolveApiUrl) {
    throw new Error(
      "No se pudo resolver el endpoint de verificación. Revisá la configuración pública del sitio."
    );
  }

  return window.LaCasonaRuntime.resolveApiUrl(functionName, params);
}

function setMessage(text, tone = "info") {
  if (!message) {
    return;
  }
  message.textContent = text;
  message.classList.remove("error", "success", "warning");
  if (tone && tone !== "info") {
    message.classList.add(tone);
  }
}

function toneFromReceiptStatus(status) {
  if (status === "sent" || status === "resent") {
    return "success";
  }
  if (status === "send_error") {
    return "danger";
  }
  return "warning";
}

function humanizeReceiptStatus(status) {
  const labels = {
    generated: "Generado",
    sent: "Enviado",
    resent: "Reenviado",
    send_error: "Error de envío"
  };

  return labels[status] || "Generado";
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function formatDateTime(value) {
  if (!value) {
    return "No informada";
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
