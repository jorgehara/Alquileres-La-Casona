import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  getIdTokenResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  deleteUser,
  signOut,
  setPersistence,
  browserLocalPersistence,
  connectAuthEmulator,
  updateEmail,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  connectFirestoreEmulator,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getStorage,
  ref,
  connectStorageEmulator,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-functions.js";

const runtimeConfig = assertRuntimeIsSafe();
const firebaseApp = initializeApp(runtimeConfig.firebase);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);
const functions = getFunctions(firebaseApp, runtimeConfig.functions.region);

connectFirebaseEmulatorsIfNeeded();

function assertRuntimeIsSafe() {
  try {
    if (!window.LaCasonaRuntime?.assertSafeRuntime) {
      throw new Error("No se cargó LaCasonaRuntime. Revisá el orden de scripts: firebase-config.js, runtime-config.js y app.js.");
    }
    return window.LaCasonaRuntime.assertSafeRuntime();
  } catch (error) {
    renderRuntimeStartupFailure(error);
    throw error;
  }
}

function connectFirebaseEmulatorsIfNeeded() {
  try {
    window.LaCasonaRuntime.connectEmulatorsIfNeeded({
      auth,
      db,
      storage,
      functions,
      connectors: {
        connectAuthEmulator,
        connectFirestoreEmulator,
        connectStorageEmulator,
        connectFunctionsEmulator
      }
    });
  } catch (error) {
    renderRuntimeStartupFailure(error);
    throw error;
  }
}

function renderRuntimeStartupFailure(error) {
  console.error("La Casona runtime configuration is unsafe", error?.details || error);
  document.body.classList.add("session-pending");
  document.querySelector("#loading-session-panel")?.classList.add("hidden");
  document.querySelector("#login-panel")?.classList.add("hidden");
  document.querySelector("#tenant-onboarding-panel")?.classList.add("hidden");
  document.querySelector("#payment-token-panel")?.classList.add("hidden");

  const accessDeniedPanel = document.querySelector("#access-denied-panel");
  accessDeniedPanel?.classList.remove("hidden");

  const title = document.querySelector("#access-denied-title");
  const copy = document.querySelector("#access-denied-copy");
  const message = document.querySelector("#access-denied-message");
  let mode = "desconocido";
  try {
    mode = window.LaCasonaRuntime?.getMode ? window.LaCasonaRuntime.getMode() : "desconocido";
  } catch (_) {
    mode = "inválido";
  }
  const origin = window.location?.origin || "origen desconocido";
  const details = error?.details;

  if (title) {
    title.textContent = "Configuración local insegura";
  }
  if (copy) {
    copy.textContent = "La app bloqueó el inicio antes de autenticar o leer datos para evitar mezclar emuladores con Firebase productivo.";
  }
  if (message) {
    message.classList.add("error");
    message.textContent = [
      error?.message || "Revisá la configuración pública de Firebase.",
      `Modo: ${mode}. Origen: ${origin}.`,
      details?.field ? `Campo: ${details.field}.` : "",
      details?.expected ? `Esperado: ${details.expected}.` : ""
    ].filter(Boolean).join(" ");
  }
}

const state = {
  authUser: null,
  authClaims: null,
  profile: null,
  role: null,
  currentTenant: null,
  currentProperty: null,
  properties: [],
  tenants: [],
  utilityBills: [],
  charges: [],
  payments: [],
  receipts: [],
  rentReceipts: [],
  rentAdjustments: [],
  rentAdjustmentPolicies: [],
  auditLogs: [],
  users: [],
  messages: [],
  generalSettings: null,
  checkoutStatus: null,
  bankAccounts: null,
  adminDiagnostics: null,
  activeSection: "",
  sectionHistory: [],
  propertyCardExpanded: {},
  tenantCardExpanded: {},
  rentUpdatePreview: null,
  chargePeriodSelections: {},
  comprobanteFilters: {
    tab: "pending",
    period: "",
    propertyId: "",
    status: "all",
    tenantSearch: "",
    owner: "all"
  },
  tenantDocumentTab: "receipts",
  tokenPortalActive: false,
  authPending: false,
  tenantOnboardingPending: false,
  privateShellCache: {},
  unsubscribers: [],
  scopedAdminRefreshPending: false,
  scopedAdminRefreshScope: "",
  sessionIdleMonitorBound: false,
  sessionTimeoutCheckTimer: null,
  lastActivityWriteAt: 0,
  postSignOutAuthMessage: "",
  recentAuthAttemptAt: 0,
  designModeEnabled: new URLSearchParams(window.location.search).get("design") === "1",
  designModeOpen: true
};

const SESSION_IDLE_LIMIT_MS = 30 * 60 * 1000;
const SESSION_IDLE_STORAGE_KEY = "lc_last_activity_at_v2";
const SESSION_IDLE_WRITE_THROTTLE_MS = 15000;
const SCOPED_ADMIN_REFRESH_INTERVAL_MS = 60000;

document.body.classList.add("session-pending");

const elements = {
  authScreen: document.querySelector("#auth-screen"),
  loadingSessionPanel: document.querySelector("#loading-session-panel"),
  loginPanel: document.querySelector("#login-panel"),
  tenantOnboardingPanel: document.querySelector("#tenant-onboarding-panel"),
  paymentTokenPanel: document.querySelector("#payment-token-panel"),
  accessDeniedPanel: document.querySelector("#access-denied-panel"),
  accessDeniedTitle: document.querySelector("#access-denied-title"),
  accessDeniedCopy: document.querySelector("#access-denied-copy"),
  accessDeniedActions: document.querySelector("#access-denied-actions"),
  accessDeniedMessage: document.querySelector("#access-denied-message"),
  privateAppHost: document.querySelector("#private-app-host"),
  appShell: null,
  authForm: document.querySelector("#auth-form"),
  authEmail: document.querySelector("#auth-email"),
  authPassword: document.querySelector("#auth-password"),
  authMessage: document.querySelector("#auth-message"),
  registerButton: document.querySelector("#register-button"),
  resetPasswordButton: document.querySelector("#reset-password-button"),
  tenantProfileButton: document.querySelector("#tenant-profile-button"),
  tenantOnboardingForm: document.querySelector("#tenant-onboarding-form"),
  tenantOnboardingEmail: document.querySelector("#tenant-onboarding-email"),
  tenantOnboardingPassword: document.querySelector("#tenant-onboarding-password"),
  tenantPropertyType: document.querySelector("#tenant-property-type"),
  tenantPropertyCode: document.querySelector("#tenant-property-code"),
  tenantPropertyCodeLabel: document.querySelector("#tenant-property-code-label"),
  tenantOnboardingBack: document.querySelector("#tenant-onboarding-back"),
  tenantOnboardingMessage: document.querySelector("#tenant-onboarding-message"),
  paymentTokenCard: document.querySelector("#payment-token-card"),
  paymentTokenCopy: document.querySelector("#payment-token-copy"),
  paymentTokenMessage: document.querySelector("#payment-token-message"),
  bootstrapButton: document.querySelector("#bootstrap-button"),
  appSidebar: document.querySelector("#app-sidebar"),
  mobileNavToggle: document.querySelector("#mobile-nav-toggle"),
  mobileNavClose: document.querySelector("#mobile-nav-close"),
  mobileNavBackdrop: document.querySelector("#mobile-nav-backdrop"),
  signOutButton: document.querySelector("#sign-out-button"),
  navItems: document.querySelectorAll(".nav-item"),
  sections: document.querySelectorAll(".view-section"),
  jumpButtons: document.querySelectorAll("[data-jump]"),
  adminOnly: document.querySelectorAll("[data-admin-only='true']"),
  tenantOnly: document.querySelectorAll("[data-tenant-only='true']"),
  tenantFacturasNav: document.querySelector("#tenant-facturas-nav"),
  sidebarRole: document.querySelector("#sidebar-role"),
  sessionName: document.querySelector("#session-name"),
  sessionMeta: document.querySelector("#session-meta"),
  topbarEyebrow: document.querySelector("#topbar-eyebrow"),
  topbarTitle: document.querySelector("#topbar-title"),
  topbarActions: document.querySelector(".topbar-actions"),
  sectionBackButton: document.querySelector("#section-back-button"),
  userChip: document.querySelector("#user-chip"),
  message: document.querySelector("#app-message"),
  summaryHeadline: document.querySelector("#summary-headline"),
  summarySubtitle: document.querySelector("#summary-subtitle"),
  collectedTotal: document.querySelector("#collected-total"),
  collectionProgress: document.querySelector("#collection-progress"),
  collectionFootnote: document.querySelector("#collection-footnote"),
  urgentCharges: document.querySelector("#urgent-charges"),
  summaryMetrics: document.querySelector("#summary-metrics"),
  summaryFinancialReport: document.querySelector("#summary-financial-report"),
  summaryPaymentMethods: document.querySelector("#summary-payment-methods"),
  summaryDelinquency: document.querySelector("#summary-delinquency"),
  summaryRecentPayments: document.querySelector("#summary-recent-payments"),
  propertyList: document.querySelector("#property-list"),
  tenantList: document.querySelector("#tenant-list"),
  utilityBillList: document.querySelector("#utility-bill-list"),
  chargeList: document.querySelector("#charge-list"),
  chargePeriodReceipts: document.querySelector("#charge-period-receipts"),
  adminPaymentReview: document.querySelector("#admin-payment-review"),
  tenantCurrentCharge: document.querySelector("#tenant-current-charge"),
  tenantTransferAccount: document.querySelector("#tenant-transfer-account"),
  tenantBillList: document.querySelector("#tenant-bill-list"),
  tenantPaymentHistory: document.querySelector("#tenant-payment-history"),
  tenantReceiptHistory: document.querySelector("#tenant-receipt-history"),
  tenantSettingsForm: document.querySelector("#tenant-settings-form"),
  tenantSettingsEmail: document.querySelector("#tenant-settings-email"),
  tenantSettingsPassword: document.querySelector("#tenant-settings-password"),
  tenantSettingsPhone: document.querySelector("#tenant-settings-phone"),
  adminSettingsForm: document.querySelector("#admin-settings-form"),
  adminSettingsName: document.querySelector("#admin-settings-name"),
  adminSettingsEmail: document.querySelector("#admin-settings-email"),
  adminSettingsPassword: document.querySelector("#admin-settings-password"),
  adminSettingsPhone: document.querySelector("#admin-settings-phone"),
  adminGeneralDueDay: document.querySelector("#admin-general-due-day"),
  adminGeneralLateFeeRate: document.querySelector("#admin-general-late-fee-rate"),
  adminGeneralMorosoDays: document.querySelector("#admin-general-moroso-days"),
  adminDefaultNotificationChannel: document.querySelector("#admin-default-notification-channel"),
  adminAutoNotifyNewCharge: document.querySelector("#admin-auto-notify-new-charge"),
  adminAutoNotifyOverdue: document.querySelector("#admin-auto-notify-overdue"),
  adminRentAdjustmentPercent: document.querySelector("#admin-rent-adjustment-percent"),
  adminRentAdjustmentButton: document.querySelector("#admin-rent-adjustment-button"),
  adminBankBlock1Holder: document.querySelector("#admin-bank-block-1-holder"),
  adminBankBlock1Alias: document.querySelector("#admin-bank-block-1-alias"),
  adminBankBlock1Cbu: document.querySelector("#admin-bank-block-1-cbu"),
  adminBankBlock1Dni: document.querySelector("#admin-bank-block-1-dni"),
  adminBankBlock1Email: document.querySelector("#admin-bank-block-1-email"),
  adminBankBlock1Phone: document.querySelector("#admin-bank-block-1-phone"),
  adminBankBlock2Holder: document.querySelector("#admin-bank-block-2-holder"),
  adminBankBlock2Alias: document.querySelector("#admin-bank-block-2-alias"),
  adminBankBlock2Cbu: document.querySelector("#admin-bank-block-2-cbu"),
  adminBankBlock2Dni: document.querySelector("#admin-bank-block-2-dni"),
  adminBankBlock2Email: document.querySelector("#admin-bank-block-2-email"),
  adminBankBlock2Phone: document.querySelector("#admin-bank-block-2-phone"),
  messageForm: document.querySelector("#message-form"),
  messageTenantSelect: document.querySelector("#message-tenant-select"),
  messageTemplateSelect: document.querySelector("#message-template-select"),
  messageChannelSelect: document.querySelector("#message-channel-select"),
  messageTemplateHelper: document.querySelector("#message-template-helper"),
  messageBody: document.querySelector("#message-body"),
  messageLogList: document.querySelector("#message-log-list"),
  auditLogList: document.querySelector("#audit-log-list"),
  adminUserCreateForm: document.querySelector("#admin-user-create-form"),
  adminUserCreateEmail: document.querySelector("#admin-user-create-email"),
  adminUserCreatePassword: document.querySelector("#admin-user-create-password"),
  adminUserCreateDisplayName: document.querySelector("#admin-user-create-display-name"),
  adminUserCreateRole: document.querySelector("#admin-user-create-role"),
  userAccessList: document.querySelector("#user-access-list"),
  propertyForm: document.querySelector("#property-form"),
  utilityBillForm: document.querySelector("#utility-bill-form"),
  tenantForm: document.querySelector("#tenant-form"),
  tenantPaymentForm: document.querySelector("#tenant-payment-form"),
  tenantPropertySelect: document.querySelector("#tenant-property-select"),
  utilityBillServiceType: document.querySelector("#utility-bill-service-type"),
  utilityBillPropertySelect: document.querySelector("#utility-bill-property-select"),
  tenantChargeSelect: document.querySelector("#tenant-charge-select"),
  tenantPaymentAmount: document.querySelector("#tenant-payment-amount"),
  tenantReceipts: document.querySelector("#tenant-receipts"),
  utilityBillFile: document.querySelector("#utility-bill-file"),
  generateChargesButton: document.querySelector("#generate-charges"),
  syncChargesButton: document.querySelector("#sync-charges"),
  sendPaymentWarningsButton: document.querySelector("#send-payment-warnings"),
  contractModal: document.querySelector("#contract-modal"),
  contractForm: document.querySelector("#contract-form"),
  contractTenantId: document.querySelector("#contract-tenant-id"),
  contractAction: document.querySelector("#contract-action"),
  contractEffectiveDate: document.querySelector("#contract-effective-date"),
  contractModalTitle: document.querySelector("#contract-modal-title"),
  contractModalCopy: document.querySelector("#contract-modal-copy"),
  contractCancelButton: document.querySelector("#contract-cancel-button"),
  historyModal: document.querySelector("#history-modal"),
  historyModalTitle: document.querySelector("#history-modal-title"),
  historyModalList: document.querySelector("#history-modal-list"),
  historyCloseButton: document.querySelector("#history-close-button"),
  tenantEditModal: document.querySelector("#tenant-edit-modal"),
  tenantEditForm: document.querySelector("#tenant-edit-form"),
  tenantEditModalTitle: document.querySelector("#tenant-edit-modal-title"),
  tenantEditId: document.querySelector("#tenant-edit-id"),
  tenantEditFullName: document.querySelector("#tenant-edit-full-name"),
  tenantEditDni: document.querySelector("#tenant-edit-dni"),
  tenantEditPhone: document.querySelector("#tenant-edit-phone"),
  tenantEditEmail: document.querySelector("#tenant-edit-email"),
  tenantEditPropertyId: document.querySelector("#tenant-edit-property-id"),
  tenantEditBaseRent: document.querySelector("#tenant-edit-base-rent"),
  tenantEditContractStartDate: document.querySelector("#tenant-edit-contract-start-date"),
  tenantEditContractEndDate: document.querySelector("#tenant-edit-contract-end-date"),
  tenantEditCancelButton: document.querySelector("#tenant-edit-cancel-button"),
  adminReceiptUploadModal: null,
  adminReceiptUploadForm: null,
  adminReceiptUploadTenantId: null,
  adminReceiptUploadChargeId: null,
  adminReceiptUploadAmount: null,
  adminReceiptUploadFiles: null,
  adminReceiptUploadCopy: null,
  adminReceiptUploadCancelButton: null,
  paymentInstructionsModal: document.querySelector("#payment-instructions-modal"),
  paymentInstructionsCloseButton: document.querySelector("#payment-instructions-close-button")
};

hydratePrivateElements();
normalizeVisibleText();
renderLoadingSession();

bindStaticEvents();
normalizeCollapsibleUi();
installMobileFocusAssist();
sanitizeSensitiveUrlParams();
readCheckoutStatusFromUrl();
initializeDesignMode();
await maybeRenderTokenPortal();
await setPersistence(auth, browserLocalPersistence);
watchSession();

function bindStaticEvents() {
  elements.authForm.addEventListener("submit", handleLogin);
  elements.registerButton.addEventListener("click", handleRegister);
  elements.resetPasswordButton?.addEventListener("click", handlePasswordReset);
  elements.tenantProfileButton?.addEventListener("click", showTenantOnboarding);
  elements.tenantOnboardingBack.addEventListener("click", showLoginPanel);
  elements.tenantOnboardingForm.addEventListener("submit", handleTenantOnboardingSubmit);
  elements.tenantPropertyType?.addEventListener("change", handlePropertyTypeChange);
  elements.bootstrapButton?.addEventListener("click", handleAccessDeniedPrimaryAction);
}

function handleAccessDeniedPrimaryAction() {
  const intent = elements.bootstrapButton?.dataset.intent || "";
  if (intent === "resume-tenant-onboarding") {
    showTenantOnboarding();
    return;
  }

  if (intent === "sign-out-and-return") {
    signOut(auth).catch((error) => {
      console.error("No se pudo cerrar la sesión tras un error de acceso", error);
      renderSignedOut();
    });
    return;
  }

  handleBootstrapAdmin();
}

const DESIGN_MODE_STORAGE_KEY = "lc_design_mode_settings_v1";

function initializeDesignMode() {
  if (!state.designModeEnabled) {
    return;
  }

  const settings = getStoredDesignSettings();
  applyDesignSettings(settings);
  renderDesignModePanel(settings);
}

function getDefaultDesignSettings() {
  return {
    sidebarWidth: 320,
    contentMax: 1280,
    workspacePadding: 28,
    surfacePadding: 26,
    cardRadius: 20,
    controlHeight: 46,
    buttonShape: "pill",
    titleScale: "normal"
  };
}

function getStoredDesignSettings() {
  const defaults = getDefaultDesignSettings();

  try {
    const raw = window.localStorage.getItem(DESIGN_MODE_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    return { ...defaults, ...JSON.parse(raw) };
  } catch (error) {
    console.warn("No se pudieron leer los ajustes del modo diseño.", error);
    return defaults;
  }
}

function saveDesignSettings(settings) {
  try {
    window.localStorage.setItem(DESIGN_MODE_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn("No se pudieron guardar los ajustes del modo diseño.", error);
  }
}

function getTitleScaleValue(scale) {
  if (scale === "compact") {
    return {
      size: "clamp(1.18rem, 1.7vw, 1.48rem)",
      lineHeight: "1.12",
      heroSize: "clamp(1.82rem, 3.2vw, 2.72rem)",
      heroLineHeight: "0.94"
    };
  }

  if (scale === "large") {
    return {
      size: "clamp(1.34rem, 2.25vw, 1.78rem)",
      lineHeight: "1.18",
      heroSize: "clamp(2.18rem, 4.4vw, 3.48rem)",
      heroLineHeight: "0.98"
    };
  }

  return {
    size: "clamp(1.25rem, 2vw, 1.6rem)",
    lineHeight: "1.15",
    heroSize: "clamp(2rem, 4vw, 3.15rem)",
    heroLineHeight: "0.96"
  };
}

function getButtonRadiusValue(shape) {
  if (shape === "rounded") {
    return "14px";
  }

  if (shape === "compact") {
    return "10px";
  }

  return "999px";
}

function applyDesignSettings(settings) {
  const root = document.documentElement;
  const titleScale = getTitleScaleValue(settings.titleScale);

  root.style.setProperty("--sidebar-width", `${settings.sidebarWidth}px`);
  root.style.setProperty("--content-max", `${settings.contentMax}px`);
  root.style.setProperty("--workspace-padding", `${settings.workspacePadding}px`);
  root.style.setProperty("--surface-padding", `${settings.surfacePadding}px`);
  root.style.setProperty("--card-radius", `${settings.cardRadius}px`);
  root.style.setProperty("--control-height", `${settings.controlHeight}px`);
  root.style.setProperty("--button-radius", getButtonRadiusValue(settings.buttonShape));
  root.style.setProperty("--section-title-size", titleScale.size);
  root.style.setProperty("--section-title-line-height", titleScale.lineHeight);
  root.style.setProperty("--hero-title-size", titleScale.heroSize);
  root.style.setProperty("--hero-title-line-height", titleScale.heroLineHeight);
}

function renderDesignModePanel(settings) {
  const shell = document.createElement("div");
  shell.className = "design-mode-shell";
  shell.innerHTML = `
    <button type="button" class="design-mode-toggle" data-design-toggle>
      Modo diseño
    </button>
    <aside class="design-mode-panel${state.designModeOpen ? "" : " hidden"}" data-design-panel>
      <div class="design-mode-head">
        <div>
          <h3>Laboratorio visual</h3>
          <p class="design-mode-copy">
            Ajustá proporciones en vivo. Esto solo aparece con <code>?design=1</code> y se guarda en este navegador.
          </p>
        </div>
      </div>
      <div class="design-mode-grid">
        <div class="design-mode-field">
          <label for="design-sidebar-width">Ancho del menú lateral</label>
          <input id="design-sidebar-width" name="sidebarWidth" type="range" min="280" max="360" step="4" value="${settings.sidebarWidth}" />
          <output data-design-output="sidebarWidth">${settings.sidebarWidth} px</output>
        </div>
        <div class="design-mode-field">
          <label for="design-content-max">Ancho del contenido</label>
          <input id="design-content-max" name="contentMax" type="range" min="1120" max="1440" step="20" value="${settings.contentMax}" />
          <output data-design-output="contentMax">${settings.contentMax} px</output>
        </div>
        <div class="design-mode-field">
          <label for="design-workspace-padding">Aire lateral</label>
          <input id="design-workspace-padding" name="workspacePadding" type="range" min="20" max="40" step="2" value="${settings.workspacePadding}" />
          <output data-design-output="workspacePadding">${settings.workspacePadding} px</output>
        </div>
        <div class="design-mode-field">
          <label for="design-surface-padding">Padding de cards</label>
          <input id="design-surface-padding" name="surfacePadding" type="range" min="18" max="34" step="2" value="${settings.surfacePadding}" />
          <output data-design-output="surfacePadding">${settings.surfacePadding} px</output>
        </div>
        <div class="design-mode-field">
          <label for="design-card-radius">Radio de cards</label>
          <input id="design-card-radius" name="cardRadius" type="range" min="16" max="28" step="1" value="${settings.cardRadius}" />
          <output data-design-output="cardRadius">${settings.cardRadius} px</output>
        </div>
        <div class="design-mode-field">
          <label for="design-control-height">Altura de botones e inputs</label>
          <input id="design-control-height" name="controlHeight" type="range" min="42" max="56" step="2" value="${settings.controlHeight}" />
          <output data-design-output="controlHeight">${settings.controlHeight} px</output>
        </div>
        <div class="design-mode-field">
          <label for="design-button-shape">Forma de botones</label>
          <select id="design-button-shape" name="buttonShape">
            <option value="pill"${settings.buttonShape === "pill" ? " selected" : ""}>Cápsula</option>
            <option value="rounded"${settings.buttonShape === "rounded" ? " selected" : ""}>Redondeado</option>
            <option value="compact"${settings.buttonShape === "compact" ? " selected" : ""}>Compacto</option>
          </select>
        </div>
        <div class="design-mode-field">
          <label for="design-title-scale">Escala de títulos</label>
          <select id="design-title-scale" name="titleScale">
            <option value="compact"${settings.titleScale === "compact" ? " selected" : ""}>Compacta</option>
            <option value="normal"${settings.titleScale === "normal" ? " selected" : ""}>Normal</option>
            <option value="large"${settings.titleScale === "large" ? " selected" : ""}>Amplia</option>
          </select>
        </div>
      </div>
      <div class="design-mode-actions">
        <button type="button" class="ghost-action" data-design-close>Cerrar panel</button>
        <button type="button" class="primary-action alt" data-design-reset>Restablecer</button>
      </div>
    </aside>
  `;

  document.body.append(shell);

  const panel = shell.querySelector("[data-design-panel]");
  const toggleButton = shell.querySelector("[data-design-toggle]");
  const closeButton = shell.querySelector("[data-design-close]");
  const resetButton = shell.querySelector("[data-design-reset]");
  const controls = shell.querySelectorAll("input[name], select[name]");

  toggleButton?.addEventListener("click", () => {
    state.designModeOpen = !state.designModeOpen;
    panel?.classList.toggle("hidden", !state.designModeOpen);
  });

  closeButton?.addEventListener("click", () => {
    state.designModeOpen = false;
    panel?.classList.add("hidden");
  });

  resetButton?.addEventListener("click", () => {
    const defaults = getDefaultDesignSettings();
    applyDesignSettings(defaults);
    saveDesignSettings(defaults);
    controls.forEach((control) => {
      control.value = String(defaults[control.name]);
    });
    syncDesignModeOutputs(shell, defaults);
  });

  controls.forEach((control) => {
    control.addEventListener("input", () => {
      const nextSettings = readDesignSettingsFromShell(shell);
      applyDesignSettings(nextSettings);
      saveDesignSettings(nextSettings);
      syncDesignModeOutputs(shell, nextSettings);
    });
    control.addEventListener("change", () => {
      const nextSettings = readDesignSettingsFromShell(shell);
      applyDesignSettings(nextSettings);
      saveDesignSettings(nextSettings);
      syncDesignModeOutputs(shell, nextSettings);
    });
  });

  syncDesignModeOutputs(shell, settings);
}

function readDesignSettingsFromShell(shell) {
  const defaults = getDefaultDesignSettings();

  return {
    sidebarWidth: Number(shell.querySelector("[name='sidebarWidth']")?.value ?? defaults.sidebarWidth),
    contentMax: Number(shell.querySelector("[name='contentMax']")?.value ?? defaults.contentMax),
    workspacePadding: Number(shell.querySelector("[name='workspacePadding']")?.value ?? defaults.workspacePadding),
    surfacePadding: Number(shell.querySelector("[name='surfacePadding']")?.value ?? defaults.surfacePadding),
    cardRadius: Number(shell.querySelector("[name='cardRadius']")?.value ?? defaults.cardRadius),
    controlHeight: Number(shell.querySelector("[name='controlHeight']")?.value ?? defaults.controlHeight),
    buttonShape: shell.querySelector("[name='buttonShape']")?.value ?? defaults.buttonShape,
    titleScale: shell.querySelector("[name='titleScale']")?.value ?? defaults.titleScale
  };
}

function syncDesignModeOutputs(shell, settings) {
  shell.querySelector("[data-design-output='sidebarWidth']").textContent = `${settings.sidebarWidth} px`;
  shell.querySelector("[data-design-output='contentMax']").textContent = `${settings.contentMax} px`;
  shell.querySelector("[data-design-output='workspacePadding']").textContent = `${settings.workspacePadding} px`;
  shell.querySelector("[data-design-output='surfacePadding']").textContent = `${settings.surfacePadding} px`;
  shell.querySelector("[data-design-output='cardRadius']").textContent = `${settings.cardRadius} px`;
  shell.querySelector("[data-design-output='controlHeight']").textContent = `${settings.controlHeight} px`;
}

function bindPrivateEvents() {
  if (!elements.appShell || elements.appShell.dataset.bound === "true") {
    return;
  }

  elements.utilityBillServiceType?.addEventListener("change", renderUtilityBillGroupOptions);
  elements.mobileNavToggle?.addEventListener("click", () => setMobileNavOpen(true));
  elements.mobileNavClose?.addEventListener("click", () => setMobileNavOpen(false));
  elements.mobileNavBackdrop?.addEventListener("click", () => setMobileNavOpen(false));
  bindCollapsibleTriggers();
  elements.signOutButton?.addEventListener("click", async () => {
    await signOut(auth);
  });
  elements.sectionBackButton?.addEventListener("click", handleSectionBack);

  elements.navItems.forEach((button) => {
    button.addEventListener("click", () => setActiveSection(button.dataset.navTarget));
  });

  elements.jumpButtons.forEach((button) => {
    button.addEventListener("click", () => setActiveSection(button.dataset.jump));
  });

  elements.propertyForm?.addEventListener("submit", handlePropertySubmit);
  elements.utilityBillForm?.addEventListener("submit", handleUtilityBillSubmit);
  elements.tenantForm?.addEventListener("submit", handleTenantSubmit);
  elements.tenantPaymentForm?.addEventListener("submit", handleTenantPaymentSubmit);
  elements.tenantSettingsForm?.addEventListener("submit", handleTenantSettingsSubmit);
  elements.adminSettingsForm?.addEventListener("submit", handleAdminSettingsSubmit);
  elements.adminRentAdjustmentButton?.addEventListener("click", handleRentAdjustmentApply);
  elements.messageForm?.addEventListener("submit", handleMessageSubmit);
  elements.adminUserCreateForm?.addEventListener("submit", handleAdminUserCreateSubmit);
  elements.messageTenantSelect?.addEventListener("change", handleMessageTemplateChange);
  elements.messageTemplateSelect?.addEventListener("change", handleMessageTemplateChange);
  elements.generateChargesButton?.addEventListener("click", handleGenerateCharges);
  elements.syncChargesButton?.addEventListener("click", handleSyncCharges);
  elements.sendPaymentWarningsButton?.addEventListener("click", handleSendPaymentWarnings);
  elements.adminPaymentReview?.addEventListener("click", handlePaymentReviewAction);
  elements.propertyList?.addEventListener("click", handleTenantContractAction);
  elements.utilityBillList?.addEventListener("click", handleUtilityBillAction);
  elements.chargeList?.addEventListener("click", handleChargeAction);
  elements.userAccessList?.addEventListener("click", handleUserAccessAction);
  elements.tenantList?.addEventListener("click", handleTenantContractAction);
  elements.tenantTransferAccount?.addEventListener("click", handleTransferInfoToggle);
  elements.tenantCurrentCharge?.addEventListener("click", handleTenantChargeActions);
  elements.contractForm?.addEventListener("submit", handleContractSubmit);
  elements.contractCancelButton?.addEventListener("click", closeContractModal);
  elements.historyCloseButton?.addEventListener("click", closeHistoryModal);
  elements.historyModal?.addEventListener("click", handleHistoryModalAction);
  elements.tenantEditForm?.addEventListener("submit", handleTenantEditSubmit);
  elements.tenantEditCancelButton?.addEventListener("click", closeTenantEditModal);
  elements.adminReceiptUploadForm?.addEventListener("submit", handleAdminReceiptUploadSubmit);
  elements.adminReceiptUploadCancelButton?.addEventListener("click", closeAdminReceiptUploadModal);
  elements.adminReceiptUploadChargeId?.addEventListener("change", syncAdminReceiptUploadChargeSelection);
  elements.adminReceiptUploadModal?.addEventListener("click", handleAdminReceiptUploadModalClick);
  elements.paymentInstructionsCloseButton?.addEventListener("click", closePaymentInstructionsModal);
  elements.privateAppHost?.addEventListener("click", handlePrivateShellClick);
  elements.privateAppHost?.addEventListener("change", handlePrivateShellChange);
  document.querySelector("#receipt-viewer-modal")?.addEventListener("click", handleReceiptViewerModalClick);

  elements.appShell.dataset.bound = "true";
}

function bindCollapsibleTriggers(root = document) {
  root.querySelectorAll("[data-collapse-toggle]").forEach((button) => {
    if (button.dataset.collapseBound === "true") {
      return;
    }
    button.addEventListener("click", () => toggleCollapsibleSection(button));
    button.dataset.collapseBound = "true";
  });
}

function hydratePrivateElements() {
  const root = elements.privateAppHost ?? document;

  elements.appShell = root.querySelector("#app-shell");
  elements.appSidebar = root.querySelector("#app-sidebar");
  elements.mobileNavToggle = root.querySelector("#mobile-nav-toggle");
  elements.mobileNavClose = root.querySelector("#mobile-nav-close");
  elements.mobileNavBackdrop = root.querySelector("#mobile-nav-backdrop");
  elements.signOutButton = root.querySelector("#sign-out-button");
  elements.navItems = Array.from(root.querySelectorAll(".nav-item"));
  elements.sections = Array.from(root.querySelectorAll(".view-section"));
  elements.jumpButtons = Array.from(root.querySelectorAll("[data-jump]"));
  elements.adminOnly = Array.from(root.querySelectorAll("[data-admin-only='true']"));
  elements.tenantOnly = Array.from(root.querySelectorAll("[data-tenant-only='true']"));
  elements.tenantFacturasNav = root.querySelector("#tenant-facturas-nav");
  elements.sidebarRole = root.querySelector("#sidebar-role");
  elements.sessionName = root.querySelector("#session-name");
  elements.sessionMeta = root.querySelector("#session-meta");
  elements.topbarEyebrow = root.querySelector("#topbar-eyebrow");
  elements.topbarTitle = root.querySelector("#topbar-title");
  elements.topbarActions = root.querySelector(".topbar-actions");
  elements.sectionBackButton = root.querySelector("#section-back-button");
  elements.userChip = root.querySelector("#user-chip");
  elements.message = root.querySelector("#app-message");
  elements.summaryHeadline = root.querySelector("#summary-headline");
  elements.summarySubtitle = root.querySelector("#summary-subtitle");
  elements.collectedTotal = root.querySelector("#collected-total");
  elements.collectionProgress = root.querySelector("#collection-progress");
  elements.collectionFootnote = root.querySelector("#collection-footnote");
  elements.urgentCharges = root.querySelector("#urgent-charges");
  elements.summaryMetrics = root.querySelector("#summary-metrics");
  elements.summaryFinancialReport = root.querySelector("#summary-financial-report");
  elements.summaryPaymentMethods = root.querySelector("#summary-payment-methods");
  elements.summaryDelinquency = root.querySelector("#summary-delinquency");
  elements.summaryRecentPayments = root.querySelector("#summary-recent-payments");
  elements.propertyList = root.querySelector("#property-list");
  elements.tenantList = root.querySelector("#tenant-list");
  elements.utilityBillList = root.querySelector("#utility-bill-list");
  elements.chargeList = root.querySelector("#charge-list");
  elements.chargePeriodReceipts = root.querySelector("#charge-period-receipts");
  elements.adminPaymentReview = root.querySelector("#admin-payment-review");
  elements.tenantCurrentCharge = root.querySelector("#tenant-current-charge");
  elements.tenantTransferAccount = root.querySelector("#tenant-transfer-account");
  elements.tenantBillList = root.querySelector("#tenant-bill-list");
  elements.tenantPaymentHistory = root.querySelector("#tenant-payment-history");
  elements.tenantReceiptHistory = root.querySelector("#tenant-receipt-history");
  elements.tenantSettingsForm = root.querySelector("#tenant-settings-form");
  elements.tenantSettingsEmail = root.querySelector("#tenant-settings-email");
  elements.tenantSettingsPassword = root.querySelector("#tenant-settings-password");
  elements.tenantSettingsPhone = root.querySelector("#tenant-settings-phone");
  elements.adminSettingsForm = root.querySelector("#admin-settings-form");
  elements.adminSettingsName = root.querySelector("#admin-settings-name");
  elements.adminSettingsEmail = root.querySelector("#admin-settings-email");
  elements.adminSettingsPassword = root.querySelector("#admin-settings-password");
  elements.adminSettingsPhone = root.querySelector("#admin-settings-phone");
  elements.adminGeneralDueDay = root.querySelector("#admin-general-due-day");
  elements.adminGeneralLateFeeRate = root.querySelector("#admin-general-late-fee-rate");
  elements.adminGeneralMorosoDays = root.querySelector("#admin-general-moroso-days");
  elements.adminDefaultNotificationChannel = root.querySelector("#admin-default-notification-channel");
  elements.adminAutoNotifyNewCharge = root.querySelector("#admin-auto-notify-new-charge");
  elements.adminAutoNotifyOverdue = root.querySelector("#admin-auto-notify-overdue");
  elements.adminRentAdjustmentPercent = root.querySelector("#admin-rent-adjustment-percent");
  elements.adminRentAdjustmentButton = root.querySelector("#admin-rent-adjustment-button");
  elements.adminBankBlock1Holder = root.querySelector("#admin-bank-block-1-holder");
  elements.adminBankBlock1Alias = root.querySelector("#admin-bank-block-1-alias");
  elements.adminBankBlock1Cbu = root.querySelector("#admin-bank-block-1-cbu");
  elements.adminBankBlock1Dni = root.querySelector("#admin-bank-block-1-dni");
  elements.adminBankBlock1Email = root.querySelector("#admin-bank-block-1-email");
  elements.adminBankBlock1Phone = root.querySelector("#admin-bank-block-1-phone");
  elements.adminBankBlock2Holder = root.querySelector("#admin-bank-block-2-holder");
  elements.adminBankBlock2Alias = root.querySelector("#admin-bank-block-2-alias");
  elements.adminBankBlock2Cbu = root.querySelector("#admin-bank-block-2-cbu");
  elements.adminBankBlock2Dni = root.querySelector("#admin-bank-block-2-dni");
  elements.adminBankBlock2Email = root.querySelector("#admin-bank-block-2-email");
  elements.adminBankBlock2Phone = root.querySelector("#admin-bank-block-2-phone");
  elements.messageForm = root.querySelector("#message-form");
  elements.messageTenantSelect = root.querySelector("#message-tenant-select");
  elements.messageTemplateSelect = root.querySelector("#message-template-select");
  elements.messageChannelSelect = root.querySelector("#message-channel-select");
  elements.messageTemplateHelper = root.querySelector("#message-template-helper");
  elements.messageBody = root.querySelector("#message-body");
  elements.messageLogList = root.querySelector("#message-log-list");
  elements.auditLogList = root.querySelector("#audit-log-list");
  elements.adminUserCreateForm = root.querySelector("#admin-user-create-form");
  elements.adminUserCreateEmail = root.querySelector("#admin-user-create-email");
  elements.adminUserCreatePassword = root.querySelector("#admin-user-create-password");
  elements.adminUserCreateDisplayName = root.querySelector("#admin-user-create-display-name");
  elements.adminUserCreateRole = root.querySelector("#admin-user-create-role");
  elements.userAccessList = root.querySelector("#user-access-list");
  elements.propertyForm = root.querySelector("#property-form");
  elements.utilityBillForm = root.querySelector("#utility-bill-form");
  elements.tenantForm = root.querySelector("#tenant-form");
  elements.tenantPaymentForm = root.querySelector("#tenant-payment-form");
  elements.tenantPropertySelect = root.querySelector("#tenant-property-select");
  elements.utilityBillServiceType = root.querySelector("#utility-bill-service-type");
  elements.utilityBillPropertySelect = root.querySelector("#utility-bill-property-select");
  elements.tenantChargeSelect = root.querySelector("#tenant-charge-select");
  elements.tenantPaymentAmount = root.querySelector("#tenant-payment-amount");
  elements.tenantReceipts = root.querySelector("#tenant-receipts");
  elements.utilityBillFile = root.querySelector("#utility-bill-file");
  elements.generateChargesButton = root.querySelector("#generate-charges");
  elements.syncChargesButton = root.querySelector("#sync-charges");
  elements.sendPaymentWarningsButton = root.querySelector("#send-payment-warnings");
  elements.contractModal = root.querySelector("#contract-modal");
  elements.contractForm = root.querySelector("#contract-form");
  elements.contractTenantId = root.querySelector("#contract-tenant-id");
  elements.contractAction = root.querySelector("#contract-action");
  elements.contractEffectiveDate = root.querySelector("#contract-effective-date");
  elements.contractModalTitle = root.querySelector("#contract-modal-title");
  elements.contractModalCopy = root.querySelector("#contract-modal-copy");
  elements.contractCancelButton = root.querySelector("#contract-cancel-button");
  elements.historyModal = root.querySelector("#history-modal");
  elements.historyModalTitle = root.querySelector("#history-modal-title");
  elements.historyModalList = root.querySelector("#history-modal-list");
  elements.historyCloseButton = root.querySelector("#history-close-button");
  elements.tenantEditModal = root.querySelector("#tenant-edit-modal");
  elements.tenantEditForm = root.querySelector("#tenant-edit-form");
  elements.tenantEditModalTitle = root.querySelector("#tenant-edit-modal-title");
  elements.tenantEditId = root.querySelector("#tenant-edit-id");
  elements.tenantEditFullName = root.querySelector("#tenant-edit-full-name");
  elements.tenantEditDni = root.querySelector("#tenant-edit-dni");
  elements.tenantEditPhone = root.querySelector("#tenant-edit-phone");
  elements.tenantEditEmail = root.querySelector("#tenant-edit-email");
  elements.tenantEditPropertyId = root.querySelector("#tenant-edit-property-id");
  elements.tenantEditBaseRent = root.querySelector("#tenant-edit-base-rent");
  elements.tenantEditContractStartDate = root.querySelector("#tenant-edit-contract-start-date");
  elements.tenantEditContractEndDate = root.querySelector("#tenant-edit-contract-end-date");
  elements.tenantEditCancelButton = root.querySelector("#tenant-edit-cancel-button");
  elements.adminReceiptUploadModal = document.querySelector("#admin-receipt-upload-modal");
  elements.adminReceiptUploadForm = document.querySelector("#admin-receipt-upload-form");
  elements.adminReceiptUploadTenantId = document.querySelector("#admin-receipt-upload-tenant-id");
  elements.adminReceiptUploadChargeId = document.querySelector("#admin-receipt-upload-charge-id");
  elements.adminReceiptUploadAmount = document.querySelector("#admin-receipt-upload-amount");
  elements.adminReceiptUploadFiles = document.querySelector("#admin-receipt-upload-files");
  elements.adminReceiptUploadCopy = document.querySelector("#admin-receipt-upload-copy");
  elements.adminReceiptUploadCancelButton = document.querySelector("#admin-receipt-upload-cancel-button");
  elements.paymentInstructionsModal = root.querySelector("#payment-instructions-modal");
  elements.paymentInstructionsCloseButton = root.querySelector("#payment-instructions-close-button");
}

async function mountPrivateApp(role) {
  if (elements.appShell || !elements.privateAppHost) {
    return;
  }

  const shellKey = isAdminRole() ? "admin" : "tenant";
  if (!state.privateShellCache[shellKey]) {
    const shellModule = await import(`./private-shell.js?t=${Date.now()}`);
    if (!shellModule?.default) {
      throw new Error("No se pudo cargar la interfaz privada.");
    }

    state.privateShellCache[shellKey] = shellModule.default;
  }

  const template = document.createElement("template");
  template.innerHTML = String(state.privateShellCache[shellKey] || "").replace(/^\uFEFF/, "");

  if (shellKey === "admin") {
    template.content.querySelectorAll("[data-tenant-only='true']").forEach((node) => node.remove());
  } else {
    template.content.querySelectorAll("[data-admin-only='true']").forEach((node) => node.remove());
  }

  elements.privateAppHost.replaceChildren(template.content.cloneNode(true));
  hydratePrivateElements();
  enhancePrivateShellLayout();
  ensureTenantSchedulingFields();
  ensureSectionBackButton();
  ensurePaymentWarningButton();
  ensureReceiptViewerModal();
  ensureAdminReceiptUploadModal();
  hydratePrivateElements();
  normalizeVisibleText();
  bindPrivateEvents();
  normalizeCollapsibleUi();
}

function unmountPrivateApp() {
  if (!elements.privateAppHost) {
    return;
  }

  elements.privateAppHost.replaceChildren();
  hydratePrivateElements();
}

function ensureSectionBackButton() {
  if (!elements.topbarActions) {
    return;
  }

  let backButton = elements.topbarActions.querySelector("#section-back-button");
  if (!backButton) {
    backButton = document.createElement("button");
    backButton.type = "button";
    backButton.id = "section-back-button";
    backButton.className = "ghost-action section-back-button hidden";
    backButton.textContent = "Volver";
    backButton.setAttribute("aria-label", "Volver a la sección anterior");
    elements.topbarActions.prepend(backButton);
  }

  elements.sectionBackButton = backButton;
  if (backButton.dataset.bound !== "true") {
    backButton.addEventListener("click", handleSectionBack);
    backButton.dataset.bound = "true";
  }

  updateSectionBackButton();
}

function ensurePaymentWarningButton() {
  if (!isAdminRole() || document.querySelector("#send-payment-warnings")) {
    return;
  }

  const syncButton = document.querySelector("#sync-charges");
  if (!syncButton?.parentElement) {
    return;
  }

  const button = document.createElement("button");
  button.id = "send-payment-warnings";
  button.className = "ghost-action";
  button.type = "button";
  button.textContent = "Enviar avisos pendientes";
  syncButton.parentElement.prepend(button);
}

function updateSectionBackButton() {
  if (!elements.sectionBackButton) {
    return;
  }

  const canGoBack = elements.sections.length > 0 && state.sectionHistory.length > 1;
  elements.sectionBackButton.classList.toggle("hidden", !canGoBack);
  elements.sectionBackButton.disabled = !canGoBack;
}

function resetSectionHistory(sectionName = "") {
  state.sectionHistory = sectionName ? [sectionName] : [];
  state.activeSection = sectionName || "";
  updateSectionBackButton();
}

function handleSectionBack() {
  if (state.sectionHistory.length <= 1) {
    return;
  }

  state.sectionHistory.pop();
  const previousSection = state.sectionHistory[state.sectionHistory.length - 1];
  setActiveSection(previousSection, { skipHistory: true });
}

function normalizeVisibleText() {
  const tenantOnboardingCopy = elements.tenantOnboardingPanel?.querySelector(".auth-copy");
  const paymentTokenTitle = elements.paymentTokenPanel?.querySelector("h2");

  if (tenantOnboardingCopy) {
    tenantOnboardingCopy.textContent = "Creá o ingresá con el correo que administración ya invitó. Si no hay invitación, no se crea ningún perfil.";
  }

  if (paymentTokenTitle) {
    paymentTokenTitle.textContent = "Pago del período";
  }
}

  function enhancePrivateShellLayout() {
    if (!elements.appShell) {
      return;
    }
  
    if (isAdminRole()) {
      renameAdminNavigation();
      ensureAdminComprobantesSection();
      ensureChargeRentUpdateSuite();
      ensureChargesSectionExperience();
      ensureAdminUserScopeControls();
      syncAdminNavVisibilityByRole();
      ensureUnitsSuiteExperience();
      enhanceTenantIndexExperience();
      enhanceAdminSettingsExperience();
    } else {
      renameTenantNavigation();
      ensureTenantReceiptExperience();
    }
}

function ensureAdminUserScopeControls() {
  const form = elements.adminUserCreateForm;
  if (!form || form.querySelector("[name='ownerScope']")) {
    return;
  }

  const roleLabel = form.querySelector("#admin-user-create-role")?.closest("label");
  const ownerScopeLabel = document.createElement("label");
  ownerScopeLabel.innerHTML = `
    Alcance
    <select name="ownerScope" id="admin-user-create-owner-scope">
      <option value="all">Toda La Casona</option>
      <option value="enzo">Enzo</option>
      <option value="ivo">Ivo</option>
    </select>
  `;
  roleLabel?.insertAdjacentElement("afterend", ownerScopeLabel);
  const ownerScopeSelect = ownerScopeLabel.querySelector("select");
  if (ownerScopeSelect && elements.adminUserCreateRole?.value === "superadmin") {
    ownerScopeSelect.disabled = true;
  }
}

function ensureSectionLabelText(sectionName, label, eyebrow) {
  const section = document.querySelector(`.view-section[data-section="${sectionName}"]`);
  if (!section) {
    return;
  }

  const heading = section.querySelector(".section-head h3");
  const sectionLabel = section.querySelector(".section-head .section-label");
  if (heading && label) {
    heading.textContent = label;
  }
  if (sectionLabel && eyebrow) {
    sectionLabel.textContent = eyebrow;
  }
}

function ensureSectionDescription(sectionName, descriptionText) {
  const section = document.querySelector(`.view-section[data-section="${sectionName}"]`);
  const headingGroup = section?.querySelector(".section-head > div");
  if (!headingGroup || !descriptionText) {
    return;
  }

  let description = headingGroup.querySelector(".section-description");
  if (!description) {
    description = document.createElement("p");
    description.className = "section-description";
    headingGroup.appendChild(description);
  }

  description.textContent = descriptionText;
}

  function renameAdminNavigation() {
  const navLabels = {
    resumen: "Inicio",
    comprobantes: "Comprobantes",
    cobros: "Cobros",
    inquilinos: "Inquilinos",
    propiedades: "Unidades",
    facturas: "Facturas y recibos",
    mensajes: "Comunicación",
    configuración: "Ajustes",
    usuarios: "Usuarios",
    auditoria: "Auditoría"
  };

  elements.navItems.forEach((button) => {
    const target = button.dataset.navTarget;
    if (target && navLabels[target]) {
      button.textContent = navLabels[target];
    }
  });

  ensureSectionLabelText("propiedades", "Unidades", "Base operativa");
  ensureSectionLabelText("facturas", "Facturas y recibos", "Servicios");
  ensureSectionLabelText("mensajes", "Comunicación", "Comunicación");
  ensureSectionLabelText("configuración", "Ajustes", "Administración");
  ensureSectionLabelText("usuarios", "Usuarios", "Seguridad");
  ensureSectionLabelText("auditoria", "Auditoría", "Trazabilidad");
  ensureSectionDescription("propiedades", "Cada unidad concentra a su inquilino actual, el estado de cobro y los accesos rápidos de gestión.");

  const title = document.querySelector('.view-section[data-section="resumen"] .hero-kicker');
  if (title) {
    title.textContent = "Inicio";
  }

  const heroAction = document.querySelector('[data-jump="cobros"]');
  if (heroAction) {
    heroAction.textContent = "Revisar comprobantes";
    heroAction.dataset.jump = "comprobantes";
  }

    const heroUnits = document.querySelector('[data-jump="propiedades"]');
    if (heroUnits) {
      heroUnits.textContent = "Ver unidades";
    }
  }

  function ensureUnitsSuiteExperience() {
    const unitsSection = document.querySelector('.view-section[data-section="propiedades"][data-admin-only="true"]');
    const propertyForm = document.querySelector("#property-form");
    if (!unitsSection || !propertyForm) {
      return;
    }

    ensureSectionDescription("propiedades", "Cada unidad concentra a su inquilino actual, el estado del alquiler, el cobro vigente y los accesos rápidos de gestión.");

    let summary = unitsSection.querySelector("#property-suite-summary");
    if (!summary) {
      summary = document.createElement("div");
      summary.id = "property-suite-summary";
      summary.className = "summary-card-grid property-suite-summary";
      unitsSection.querySelector(".section-head")?.insertAdjacentElement("afterend", summary);
    }

    if (!propertyForm.closest(".collapsible-panel")) {
      const panel = document.createElement("section");
      panel.className = "collapsible-panel units-suite-panel";
      panel.innerHTML = `
        <button
          class="collapsible-trigger"
          type="button"
          data-collapse-toggle="property-create-panel"
          aria-expanded="false"
          aria-controls="property-create-panel"
        >
          <span>Registrar unidad</span>
          <span class="collapsible-indicator" aria-hidden="true">+</span>
        </button>
        <div id="property-create-panel" class="collapsible-content hidden"></div>
      `;
      const host = panel.querySelector("#property-create-panel");
      propertyForm.querySelector("h4")?.replaceChildren("Registrar unidad");
      host?.appendChild(propertyForm);
      summary.insertAdjacentElement("afterend", panel);
    }
  }

function enhanceTenantIndexExperience() {
  const tenantsSection = document.querySelector('.view-section[data-section="inquilinos"][data-admin-only="true"]');
  if (!tenantsSection) {
    return;
  }

    ensureSectionDescription("inquilinos", "Usá esta vista para búsquedas puntuales y edición detallada. La operación diaria principal ahora vive en Unidades.");

    let summary = tenantsSection.querySelector("#tenant-suite-summary");
    if (!summary) {
      summary = document.createElement("div");
      summary.id = "tenant-suite-summary";
      summary.className = "summary-card-grid tenant-suite-summary";
      tenantsSection.querySelector(".section-head")?.insertAdjacentElement("afterend", summary);
    }

    let note = tenantsSection.querySelector(".tenant-secondary-note");
    if (!note) {
      note = document.createElement("div");
      note.className = "owner-scope-note tenant-secondary-note";
      note.innerHTML = "<strong>Vista secundaria</strong><br>Acá podés buscar y editar inquilinos puntuales. Para revisar alquiler, cobro activo, puntualidad y contrato, trabajá desde la suite de Unidades.";
      tenantsSection.querySelector(".section-head")?.insertAdjacentElement("afterend", note);
    }
  }

function renameTenantNavigation() {
  if (elements.tenantFacturasNav) {
    elements.tenantFacturasNav.textContent = "Facturas y recibos";
  }

  const receiptNav = document.querySelector('.nav-item[data-nav-target="mis-comprobantes"]');
  const receiptSection = document.querySelector('.view-section[data-section="mis-comprobantes"]');
  if (receiptNav) {
    receiptNav.classList.add("hidden");
  }
  if (receiptSection) {
    receiptSection.classList.add("hidden");
  }

  ensureSectionLabelText("facturas", "Facturas y recibos", "Documentación");
}

function syncAdminNavVisibilityByRole() {
  const usersNav = document.querySelector('.nav-item[data-nav-target="usuarios"]');
  const auditNav = document.querySelector('.nav-item[data-nav-target="auditoria"]');
  const usersSection = document.querySelector('.view-section[data-section="usuarios"]');
  const auditSection = document.querySelector('.view-section[data-section="auditoria"]');
  const showSensitive = isSuperadminRole();

  [usersNav, auditNav, usersSection, auditSection].forEach((node) => {
    if (node) {
      node.classList.toggle("hidden", !showSensitive);
    }
  });
}

function ensureAdminComprobantesSection() {
  if (!elements.appShell) {
    return;
  }

  const workspace = elements.appShell.querySelector(".workspace");
  const chargesSection = document.querySelector('.view-section[data-section="cobros"][data-admin-only="true"]');
  const existingSection = document.querySelector('.view-section[data-section="comprobantes"][data-admin-only="true"]');
  if (!workspace || !chargesSection) {
    return;
  }

  let navButton = document.querySelector('.nav-item[data-nav-target="comprobantes"]');
  if (!navButton) {
    const firstAdminNav = document.querySelector('.nav-item[data-nav-target="resumen"][data-admin-only="true"]');
    navButton = document.createElement("button");
    navButton.type = "button";
    navButton.className = "nav-item";
    navButton.dataset.navTarget = "comprobantes";
    navButton.dataset.adminOnly = "true";
    navButton.textContent = "Comprobantes";
    firstAdminNav?.insertAdjacentElement("afterend", navButton);
  }

  let section = existingSection;
  if (!section) {
    section = document.createElement("section");
    section.className = "surface view-section comprobantes-surface";
    section.dataset.section = "comprobantes";
    section.dataset.adminOnly = "true";
    section.innerHTML = `
      <div class="section-head">
        <div>
          <p class="section-label">Bandeja de revisión</p>
          <h3>Comprobantes recibidos</h3>
          <p class="section-description">Revisá los pagos informados por los inquilinos y emití recibos oficiales.</p>
        </div>
      </div>
      <div id="comprobante-summary-cards" class="summary-card-grid"></div>
      <div class="comprobante-filter-toolbar">
        <div class="tab-row" id="comprobante-tab-row"></div>
        <div class="comprobante-filter-grid">
          <label>
            Período
            <input type="month" id="comprobante-filter-period" />
          </label>
          <label>
            Unidad
            <select id="comprobante-filter-property">
              <option value="">Todas</option>
            </select>
          </label>
          <label>
            Estado
            <select id="comprobante-filter-status">
              <option value="all">Todos</option>
              <option value="reported">Pendiente de revisión</option>
              <option value="approved">Aprobado</option>
              <option value="rejected">Rechazado</option>
              <option value="receipt_issued">Recibo emitido</option>
              <option value="email_sent">Email enviado</option>
              <option value="email_error">Error al enviar recibo</option>
            </select>
          </label>
          <label>
            Buscar inquilino
            <input type="search" id="comprobante-filter-tenant" placeholder="Nombre del inquilino" />
          </label>
          <label class="hidden" id="comprobante-owner-filter-wrap">
            Propietario
            <select id="comprobante-filter-owner">
              <option value="all">Todos</option>
              <option value="enzo">Enzo</option>
              <option value="ivo">Ivo</option>
            </select>
          </label>
        </div>
      </div>
    `;
    chargesSection.insertAdjacentElement("beforebegin", section);
  }

  let reviewList = section.querySelector("#admin-payment-review") || elements.adminPaymentReview;
  if (!reviewList) {
    reviewList = document.createElement("div");
    reviewList.id = "admin-payment-review";
    reviewList.className = "entity-list";
  }

  const oldReviewHeading = reviewList.previousElementSibling;
  if (oldReviewHeading?.classList?.contains("section-head") && oldReviewHeading?.classList?.contains("compact")) {
    oldReviewHeading.remove();
  }
  const oldParent = reviewList.parentElement;
  if (oldParent !== section) {
    section.appendChild(reviewList);
  }

  elements.adminPaymentReview = reviewList;
}

function ensureChargeRentUpdateSuite() {
  const chargesSection = document.querySelector('.view-section[data-section="cobros"][data-admin-only="true"]');
  if (!chargesSection) {
    return;
  }

  let suite = chargesSection.querySelector("#charge-rent-update-suite");
    if (!suite) {
      suite = document.createElement("section");
      suite.id = "charge-rent-update-suite";
      suite.className = "rent-update-suite";
      suite.innerHTML = `
        <div class="section-head compact">
          <div>
            <p class="section-label">Actualización de alquileres</p>
            <h3>Planificar próximo período</h3>
            <p class="section-description">Aplicá cambios manuales por categoría o por unidad. El impacto se reflejará desde el período indicado.</p>
          </div>
        </div>
        <div class="rent-policy-board">
          <div class="section-head compact">
            <div>
              <p class="section-label">Políticas por categoría</p>
              <h3>Base para próximos ajustes</h3>
              <p class="section-description">Definí si cada categoría se gestiona manualmente o con un índice asistido, su frecuencia y el próximo período esperado.</p>
            </div>
          </div>
          <div id="rent-policy-card-list" class="rent-policy-card-grid"></div>
          <form id="rent-policy-form" class="form-card rent-policy-form">
            <label>
              Categoría
              <select id="rent-policy-unit-type" name="unitType">
                <option value="Departamento">Departamentos</option>
                <option value="Local">Locales</option>
                <option value="Casa">Casas</option>
              </select>
            </label>
            <label>
              Fuente de actualización
              <select id="rent-policy-update-source" name="updateSource">
                <option value="manual">Manual</option>
                <option value="indexed">Índice asistido</option>
              </select>
            </label>
            <label id="rent-policy-index-wrap" class="hidden">
              Índice de referencia
              <select id="rent-policy-index-name" name="indexName">
                <option value="ICL">ICL</option>
                <option value="IPC">IPC</option>
                <option value="CUSTOM">Otro índice</option>
              </select>
            </label>
            <label>
              Frecuencia
              <select id="rent-policy-frequency" name="frequency">
                <option value="monthly">Mensual</option>
                <option value="quarterly" selected>Trimestral</option>
                <option value="semiannual">Semestral</option>
              </select>
            </label>
            <label>
              Próximo ajuste estimado
              <input id="rent-policy-next-period" name="nextAdjustmentPeriod" type="month" />
            </label>
            <label class="checkbox-label rent-policy-checkbox">
              <input id="rent-policy-requires-approval" name="requiresOwnerApproval" type="checkbox" />
              <span>Requiere autorización del locador antes de renovar</span>
            </label>
            <div class="rent-update-actions rent-policy-actions">
              <button class="ghost-action" id="rent-policy-save-button" type="submit">Guardar política</button>
            </div>
          </form>
        </div>
        <form id="rent-update-suite-form" class="form-card rent-update-form">
          <label>
            Alcance
          <select id="rent-update-target-mode" name="targetMode">
            <option value="category">Categoría</option>
            <option value="property">Unidad puntual</option>
          </select>
        </label>
        <label id="rent-update-unit-type-wrap">
          Categoría
          <select id="rent-update-unit-type" name="unitType">
            <option value="Departamento">Departamentos</option>
            <option value="Local">Locales</option>
            <option value="Casa">Casas</option>
          </select>
        </label>
        <label id="rent-update-property-wrap" class="hidden">
          Unidad
          <select id="rent-update-property-id" name="propertyId"></select>
        </label>
        <label>
          Tipo de cambio
          <select id="rent-update-value-mode" name="adjustmentMode">
            <option value="percent">Porcentaje</option>
            <option value="set_value">Nuevo valor fijo</option>
          </select>
        </label>
        <label>
          Valor
          <input id="rent-update-value" name="value" type="number" step="0.01" required />
        </label>
        <label>
          Período de aplicación
          <input id="rent-update-effective-period" name="effectivePeriod" type="month" />
        </label>
        <div class="rent-update-actions">
          <button class="ghost-action" id="rent-update-preview-button" type="submit">Vista previa</button>
          <button class="primary-action" id="rent-update-apply-button" type="button" disabled>Aplicar cambios</button>
        </div>
        </form>
        <div id="rent-policy-context-copy" class="panel-note"></div>
        <div id="rent-update-preview-host" class="entity-list"></div>
        <div class="section-head compact rent-update-history-head">
        <div>
          <p class="section-label">Historial reciente</p>
          <h3>Últimos ajustes aplicados</h3>
        </div>
      </div>
      <div id="rent-update-history-list" class="entity-list"></div>
    `;

    chargesSection.appendChild(suite);
  }

    const form = suite.querySelector("#rent-update-suite-form");
    if (form && form.dataset.bound !== "true") {
      form.addEventListener("submit", handleRentUpdatePreviewSubmit);
      form.dataset.bound = "true";
    }

    const policyForm = suite.querySelector("#rent-policy-form");
    if (policyForm && policyForm.dataset.bound !== "true") {
      policyForm.addEventListener("submit", handleRentPolicySubmit);
      policyForm.dataset.bound = "true";
    }

  const applyButton = suite.querySelector("#rent-update-apply-button");
  if (applyButton && applyButton.dataset.bound !== "true") {
    applyButton.addEventListener("click", handleRentUpdateApplyPlan);
    applyButton.dataset.bound = "true";
  }

    const targetModeSelect = suite.querySelector("#rent-update-target-mode");
    if (targetModeSelect && targetModeSelect.dataset.bound !== "true") {
      targetModeSelect.addEventListener("change", syncRentUpdateSuiteVisibility);
      targetModeSelect.dataset.bound = "true";
    }

    const policySourceSelect = suite.querySelector("#rent-policy-update-source");
    if (policySourceSelect && policySourceSelect.dataset.bound !== "true") {
      policySourceSelect.addEventListener("change", syncRentPolicyFormVisibility);
      policySourceSelect.dataset.bound = "true";
    }

    const policyCategorySelect = suite.querySelector("#rent-policy-unit-type");
    if (policyCategorySelect && policyCategorySelect.dataset.bound !== "true") {
      policyCategorySelect.addEventListener("change", renderChargeRentUpdateSuite);
      policyCategorySelect.dataset.bound = "true";
    }

    const policyCardsHost = suite.querySelector("#rent-policy-card-list");
    if (policyCardsHost && policyCardsHost.dataset.bound !== "true") {
      policyCardsHost.addEventListener("click", handleRentPolicyCardAction);
      policyCardsHost.dataset.bound = "true";
    }

    const categorySelect = suite.querySelector("#rent-update-unit-type");
    if (categorySelect && categorySelect.dataset.bound !== "true") {
      categorySelect.addEventListener("change", renderChargeRentUpdateSuite);
      categorySelect.dataset.bound = "true";
    }

    renderChargeRentUpdateSuite();
  }

function ensureChargesSectionExperience() {
  const chargesSection = document.querySelector('.view-section[data-section="cobros"][data-admin-only="true"]');
  if (!chargesSection) {
    return;
  }

  let stack = chargesSection.querySelector("#charges-suite-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "charges-suite-stack";
    stack.className = "collapsible-stack charges-suite-stack";
    chargesSection.querySelector(".section-head")?.insertAdjacentElement("afterend", stack);
  }

  const periodsPanel = ensureChargesCollapsiblePanel({
    stack,
    panelId: "charges-periods-panel",
    title: "Períodos y recibos",
    expanded: true
  });
  const settingsPanel = ensureChargesCollapsiblePanel({
    stack,
    panelId: "charges-settings-panel",
    title: "Configuración de cobros",
    expanded: false
  });
  const activeChargesPanel = ensureChargesCollapsiblePanel({
    stack,
    panelId: "charges-active-panel",
    title: "Cobros abiertos por inquilino",
    expanded: true
  });

  const periodHead = chargesSection.querySelector(".charge-period-head");
  const periodHost = chargesSection.querySelector("#charge-period-receipts");
  const rentSuite = chargesSection.querySelector("#charge-rent-update-suite");
  const chargeList = chargesSection.querySelector("#charge-list");

  if (periodHead && periodHead.parentElement !== periodsPanel) {
    periodsPanel.appendChild(periodHead);
  }
  if (periodHost && periodHost.parentElement !== periodsPanel) {
    periodsPanel.appendChild(periodHost);
  }
  if (rentSuite && rentSuite.parentElement !== settingsPanel) {
    settingsPanel.appendChild(rentSuite);
  }
  if (chargeList && chargeList.parentElement !== activeChargesPanel) {
    activeChargesPanel.appendChild(chargeList);
  }

  bindCollapsibleTriggers(stack);
  normalizeCollapsibleUi();
}

function ensureChargesCollapsiblePanel({ stack, panelId, title, expanded }) {
  let panel = stack.querySelector(`[data-charge-panel="${panelId}"]`);
  if (!panel) {
    panel = document.createElement("section");
    panel.className = "collapsible-panel charges-collapsible-panel";
    panel.dataset.chargePanel = panelId;
    panel.innerHTML = `
      <button
        class="collapsible-trigger"
        type="button"
        data-collapse-toggle="${panelId}"
        aria-expanded="${expanded ? "true" : "false"}"
        aria-controls="${panelId}"
      >
        <span>${title}</span>
        <span class="collapsible-indicator" aria-hidden="true">${expanded ? "-" : "+"}</span>
      </button>
      <div id="${panelId}" class="collapsible-content${expanded ? "" : " hidden"}"></div>
    `;
    stack.appendChild(panel);
  }

  return panel.querySelector(`#${panelId}`);
}

function ensureTenantReceiptExperience() {
  const tenantFacturasSection = document.querySelector('.view-section[data-section="facturas"][data-tenant-only="true"]');
  if (!tenantFacturasSection || tenantFacturasSection.querySelector(".tenant-documents-tabs")) {
    return;
  }

  tenantFacturasSection.innerHTML = `
    <div class="section-head">
      <div>
        <p class="section-label">Documentación</p>
        <h3>Facturas y recibos</h3>
        <p class="section-description">Consultá tus recibos emitidos y, cuando corresponda, las facturas de servicios asociadas a tu unidad.</p>
      </div>
    </div>
    <div class="tenant-documents-tabs" data-tenant-doc-tabs>
      <button class="ghost-action active" type="button" data-tenant-doc-tab="receipts">Recibos de alquiler</button>
      <button class="ghost-action" type="button" data-tenant-doc-tab="services">Facturas de servicios</button>
    </div>
    <div id="tenant-bill-list" class="entity-list"></div>
  `;

  hydratePrivateElements();
}

function enhanceAdminSettingsExperience() {
  const settingsSection = document.querySelector('.view-section[data-section="configuración"][data-admin-only="true"]');
  if (!settingsSection) {
    return;
  }

  const headingGroup = settingsSection.querySelector(".section-head > div");
  if (headingGroup && !headingGroup.querySelector(".section-description")) {
    const description = document.createElement("p");
    description.className = "section-description";
    description.textContent = "Centralizá datos del administrador, reglas de cobro y cuentas bancarias sin mezclar información global con acciones operativas.";
    headingGroup.appendChild(description);
  }

  settingsSection.querySelector("#admin-settings-profile-panel")?.closest(".collapsible-panel")?.classList.add("settings-suite-panel", "settings-suite-profile");
  settingsSection.querySelector("#admin-settings-general-panel")?.closest(".collapsible-panel")?.classList.add("settings-suite-panel", "settings-suite-global");
  settingsSection.querySelector("#admin-settings-bank-panel")?.closest(".collapsible-panel")?.classList.add("settings-suite-panel", "settings-suite-bank");

  if (elements.adminRentAdjustmentButton) {
    elements.adminRentAdjustmentButton.textContent = getCurrentOwnerScope() === "all"
      ? "Aplicar ajuste global"
      : "Ajuste global reservado a superadmin";
  }
}

function ensureReceiptViewerModal() {
  if (document.querySelector("#receipt-viewer-modal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.id = "receipt-viewer-modal";
  modal.className = "modal-shell hidden";
  modal.innerHTML = `
    <div class="modal-card modal-card-wide receipt-viewer-card">
      <div class="instructions-modal-head">
        <div>
          <p class="eyebrow">Recibo emitido</p>
          <h3>Vista del recibo</h3>
        </div>
        <button class="ghost-action modal-close-button" type="button" data-close-receipt-viewer="true" aria-label="Cerrar visor">×</button>
      </div>
      <div class="receipt-viewer-frame-wrap">
        <iframe id="receipt-viewer-frame" title="Recibo emitido" class="receipt-viewer-frame"></iframe>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function ensureAdminReceiptUploadModal() {
  if (document.querySelector("#admin-receipt-upload-modal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.id = "admin-receipt-upload-modal";
  modal.className = "modal-shell hidden";
  modal.innerHTML = `
    <div class="modal-card modal-card-wide">
      <p class="eyebrow">Comprobantes</p>
      <h3>Cargar comprobante desde administración</h3>
      <p id="admin-receipt-upload-copy" class="panel-meta">
        Seleccioná el cobro pendiente y subí el archivo para dejarlo en revisión administrativa.
      </p>
      <form id="admin-receipt-upload-form" class="form-card settings-form">
        <input id="admin-receipt-upload-tenant-id" name="tenantId" type="hidden" />
        <label>
          Cobro
          <select id="admin-receipt-upload-charge-id" name="chargeId" required></select>
        </label>
        <label>
          Monto informado
          <input id="admin-receipt-upload-amount" name="amountReported" type="number" min="0" step="0.01" required />
        </label>
        <label>
          Comprobantes
          <input id="admin-receipt-upload-files" name="receipts" type="file" accept="image/*,.pdf" multiple required />
        </label>
        <p class="panel-meta">Podés subir hasta 2 archivos. Se validarán igual que en el portal del inquilino.</p>
        <div class="auth-actions">
          <button class="primary-action" type="submit">Validar y enviar a revisión</button>
          <button id="admin-receipt-upload-cancel-button" class="ghost-action" type="button">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(modal);
}

function normalizeCollapsibleUi() {
  bindCollapsibleTriggers();
  document.querySelectorAll("[data-collapse-toggle]").forEach((button) => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    const indicator = button.querySelector(".collapsible-indicator");
    if (indicator) {
      indicator.textContent = expanded ? "-" : "+";
    }
  });

  if (elements.messageTemplateHelper) {
    elements.messageTemplateHelper.textContent = "Elegí una plantilla para autocompletar el mensaje.";
  }
}

function watchSession() {
  onAuthStateChanged(auth, async (user) => {
    clearSubscriptions();
    resetCollections();
    renderLoadingSession();

    if (!user) {
      state.authUser = null;
      state.authClaims = null;
      state.profile = null;
      state.role = null;
      stopSessionIdleMonitor();
      if (!state.postSignOutAuthMessage && state.recentAuthAttemptAt && Date.now() - state.recentAuthAttemptAt < 15000) {
        state.postSignOutAuthMessage = "La autenticación se inició, pero el acceso no terminó de cargarse. Intenta nuevamente.";
      }
      renderSignedOut();
      return;
    }

    state.authUser = user;
    if (isSessionIdleExpired()) {
      await signOut(auth);
      return;
    }

    startSessionIdleMonitor();
    stampSessionActivity(true);
    setAuthMessage("Credenciales validadas. Cargando permisos...", "info");
    try {
      await loadUserProfile(user.uid);
    } catch (error) {
      console.error(error);
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        await loadUserProfile(user.uid);
      } catch (retryError) {
        console.error("Falló la carga del perfil luego del reintento", retryError);
        renderAccessDenied({
          title: "No pudimos completar tu acceso",
          copy: "Tu cuenta existe, pero hubo un problema al cargar permisos o datos del perfil.",
          message: humanizeProfileLoadError(retryError),
          canBootstrap: false,
          primaryAction: {
            label: "Volver al ingreso",
            intent: "sign-out-and-return"
          }
        });
      }
    }
  });
}

function readCheckoutStatusFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get("mp_status");

  if (!status) {
    return;
  }

  state.checkoutStatus = status;
  const cleanUrl = `${window.location.origin}${window.location.pathname}`;
  window.history.replaceState({}, document.title, cleanUrl);
}

function sanitizeSensitiveUrlParams() {
  const url = new URL(window.location.href);
  const sensitiveKeys = ["email", "password", "pass", "pwd"];
  let changed = false;

  sensitiveKeys.forEach((key) => {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  });

  if (!changed) {
    return;
  }

  const cleanedUrl = `${url.origin}${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ""}${url.hash}`;
  window.history.replaceState({}, document.title, cleanedUrl);
}

async function maybeRenderTokenPortal() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  if (!token) {
    state.tokenPortalActive = false;
    elements.paymentTokenPanel.classList.add("hidden");
    return;
  }

  state.tokenPortalActive = true;
  elements.loginPanel.classList.add("hidden");
  elements.tenantOnboardingPanel.classList.add("hidden");
  elements.paymentTokenPanel.classList.remove("hidden");
  elements.paymentTokenCard.innerHTML = `<p>Cargando cobro...</p>`;

  try {
    const response = await fetch(resolveRuntimeApiUrl("resolvePaymentAccessToken", { token }));
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      elements.paymentTokenCopy.textContent = "El link ya no esta disponible.";
      elements.paymentTokenCard.innerHTML = `<p>Este acceso único venció o no existe.</p>`;
      return;
    }

    const charge = payload.charge || {};
    const property = payload.property || null;
    const transferAccount = resolveTransferAccount(property);
    const rentItem = Array.isArray(charge.items)
      ? charge.items.find((item) => item.key === "rent")
      : null;
    const otherItems = Array.isArray(charge.items)
      ? charge.items.filter((item) => item.key !== "rent")
      : [];
    const chargeVisualStatus = getChargeVisualStatus(charge);
    const subtotal = Number(charge.subtotal ?? rentItem?.amount ?? 0);
    const lateFeeAmount = Number(charge.lateFeeAmount ?? 0);
    const totalAmount = Number(charge.total ?? subtotal + lateFeeAmount);
    const canUploadTransferReceipt = charge.status !== "paid";

    elements.paymentTokenCopy.textContent = "Accedé al detalle puntual del cobro para resolver este período sin navegar toda la app.";
      elements.paymentTokenCard.innerHTML = `
        <div class="token-summary">
          <div class="token-summary-head">
            <div>
              <p class="section-label">${charge.period || "Sin período"}</p>
              <h3>Total ${formatCurrency(totalAmount)}</h3>
            </div>
            <span class="status ${chargeVisualStatus.className}">${chargeVisualStatus.label}</span>
          </div>
          <p>Vence ${formatDate(charge.dueDate)}</p>
          <p>${chargeVisualStatus.helpText}</p>
        </div>
        <div class="token-breakdown">
          <h4>Detalle del pago</h4>
          ${buildChargeBreakdownRows(charge)}
          <div class="charge-breakdown-row">
            <span>Subtotal</span>
            <strong>${formatCurrency(subtotal)}</strong>
          </div>
          <div class="charge-breakdown-row ${lateFeeAmount > 0 ? "late-fee-row" : ""}">
            <span>Mora</span>
            <strong>${formatCurrency(lateFeeAmount)}</strong>
          </div>
          <div class="charge-breakdown-row total-row">
            <span>Total</span>
            <strong>${formatCurrency(totalAmount)}</strong>
          </div>
          ${rentItem ? `<p class="token-detail-note">Resumen del período: ${formatCurrency(resolveChargeRentAmount(charge))}${resolveChargeExpenseAmount(charge) > 0 ? ` + ${formatCurrency(resolveChargeExpenseAmount(charge))} de expensas` : ""}.</p>` : ""}
          ${
            otherItems.length
              ? `<div class="token-extra-items">${otherItems
                  .map((item) => `<p>${item.label}: ${formatCurrency(item.amount ?? 0)}</p>`)
                  .join("")}</div>`
              : ""
          }
        </div>
        <div class="token-breakdown">
          <button class="primary-action transfer-action" type="button" data-token-transfer-toggle="true">Pagar por transferencia</button>
          <div class="transfer-details hidden" data-token-transfer-details="true">
            <p>Titular: ${transferAccount?.holderName || "Sin definir"}</p>
            <p>Alias: ${transferAccount?.alias || "Sin definir"}</p>
            <p>CBU: ${transferAccount?.cbu || "Sin definir"}</p>
            ${
              canUploadTransferReceipt
                ? `<form class="token-transfer-form" data-token-transfer-form="true">
                    <label>
                      Monto transferido
                      <input name="amountReported" type="number" min="0" step="0.01" value="${String(totalAmount)}" required />
                    </label>
                    <label>
                      Comprobante de transferencia
                      <input name="receipts" type="file" accept="image/*,application/pdf" multiple required />
                    </label>
                    <p class="token-helper">Subi hasta 2 archivos. Vamos a validar monto, fecha y cuenta de destino antes de enviarlo.</p>
                    <button class="primary-action small-button" type="submit">Validar comprobante y enviar</button>
                  </form>`
                : `<p class="token-helper success-text">Este cobro ya figura como pagado. Si necesitas ayuda, comunicate con administración.</p>`
            }
          </div>
          <button class="primary-action mp-action" type="button" data-token-pay="${token}">Pago con tarjeta</button>
          <div class="payment-warning">
            El link de Mercado Pago es de uso exclusivo para pagos con tarjetas de débito/crédito.
          </div>
          <button class="ghost-action small-button instructions-action" type="button" data-token-instructions-toggle="true">Instrucciones para pagar</button>
        </div>
      `;

    elements.paymentTokenCard.onclick = async (event) => {
      const button = event.target.closest("[data-token-pay]");
        const transferButton = event.target.closest("[data-token-transfer-toggle]");
        const instructionsButton = event.target.closest("[data-token-instructions-toggle]");

        if (transferButton) {
          elements.paymentTokenCard
            .querySelector("[data-token-transfer-details]")
            ?.classList.toggle("hidden");
          return;
        }

        if (instructionsButton) {
          openPaymentInstructionsModal();
          return;
        }

        if (!button) {
          return;
        }

      try {
        elements.paymentTokenMessage.textContent = "Preparando pago con tarjeta...";
        const checkoutResponse = await fetch(
          resolveRuntimeApiUrl("createCheckoutFromPaymentAccessToken", { token: button.dataset.tokenPay }),
          { method: "POST" }
        );
        const checkoutPayload = await checkoutResponse.json();

        if (!checkoutResponse.ok || !checkoutPayload.ok || !checkoutPayload.checkoutUrl) {
          elements.paymentTokenMessage.textContent = "No se pudo abrir el pago con tarjeta.";
          return;
        }

        window.location.href = checkoutPayload.checkoutUrl;
      } catch (error) {
        console.error(error);
        elements.paymentTokenMessage.textContent = "No se pudo abrir el pago con tarjeta.";
      }
    };

    elements.paymentTokenCard.onsubmit = async (event) => {
      const form = event.target.closest("[data-token-transfer-form]");
      if (!form) {
        return;
      }

      event.preventDefault();
      const amountReported = Number(form.amountReported?.value || 0);
      const files = Array.from(form.receipts?.files || []).slice(0, 2);

      if (!amountReported || !files.length) {
        elements.paymentTokenMessage.textContent = "Completa el monto y subi al menos un comprobante.";
        return;
      }

      if (files.some((file) => file.size > 6 * 1024 * 1024)) {
        elements.paymentTokenMessage.textContent = "Cada comprobante debe pesar menos de 6 MB.";
        return;
      }

      const submitButton = form.querySelector('button[type="submit"]');
      submitButton?.setAttribute("disabled", "disabled");
      elements.paymentTokenMessage.textContent = "Validando comprobante...";

      try {
        const serializedFiles = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type || "application/octet-stream",
            dataBase64: await readFileAsDataUrl(file)
          }))
        );

        const submitResponse = await fetch(
          resolveRuntimeApiUrl("submitTransferFromPaymentAccessToken", { token }),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              token,
              amountReported,
              files: serializedFiles
            })
          }
        );

        const submitPayload = await submitResponse.json();
        if (!submitResponse.ok) {
          elements.paymentTokenMessage.textContent = submitPayload.detail || "No se pudo validar el comprobante.";
          return;
        }

        if (submitPayload.blocked) {
          const validation = submitPayload.validation || {};
          elements.paymentTokenMessage.textContent = [
            submitPayload.reason || "No se pudo validar el comprobante.",
            validation.expectedAmount ? `Esperado: ${formatCurrency(validation.expectedAmount)}.` : "",
            validation.totalDetected ? `Detectado: ${formatCurrency(validation.totalDetected)}.` : ""
          ].filter(Boolean).join(" ");
          return;
        }

        form.reset();
        elements.paymentTokenMessage.textContent = "Comprobante validado. El pago quedó enviado para revisión administrativa.";
      } catch (error) {
        console.error(error);
        elements.paymentTokenMessage.textContent = "No se pudo validar el comprobante en este momento.";
      } finally {
        submitButton?.removeAttribute("disabled");
      }
    };
  } catch (error) {
    console.error(error);
    elements.paymentTokenCopy.textContent = "No pudimos resolver el link.";
    elements.paymentTokenCard.innerHTML = `<p>Hubo un problema al abrir este acceso único.</p>`;
  }
}

function resolveRuntimeApiUrl(functionName, params = {}) {
  if (!window.LaCasonaRuntime?.resolveApiUrl) {
    throw new Error(
      "No se pudo resolver el endpoint de funciones. Revisá que runtime-config.js cargue antes de app.js."
    );
  }

  return window.LaCasonaRuntime.resolveApiUrl(functionName, params);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

async function handleLogin(event) {
  event.preventDefault();
  if (state.authPending) {
    return;
  }

  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;

  if (!email || !password) {
    setAuthMessage("Completa correo y contraseña para ingresar.", "error");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setAuthMessage("Ingresa un correo electrónico válido.", "error");
    return;
  }

  setAuthPending(true);
  state.recentAuthAttemptAt = Date.now();
  setAuthMessage("Ingresando...", "info");

  try {
    stampSessionActivity(true);
    await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
  } catch (error) {
    setAuthMessage(humanizeAuthError(error), "error");
  } finally {
    setAuthPending(false);
  }
}

async function handleRegister() {
  if (state.authPending) {
    return;
  }

  const email = String(elements.authEmail?.value || "").trim();
  const password = String(elements.authPassword?.value || "");

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setAuthMessage("Ingresa un correo electrónico válido antes de crear la cuenta.", "error");
    return;
  }

  if (email) {
    elements.tenantOnboardingEmail.value = email;
  }
  if (password) {
    elements.tenantOnboardingPassword.value = password;
  }

  setAuthMessage("");
  showTenantOnboarding();
}

async function handlePasswordReset() {
  const email = String(elements.authEmail?.value || "").trim().toLowerCase();

  if (!email) {
    setAuthMessage("Ingresa tu correo para enviarte el enlace de recuperación.", "error");
    return;
  }

  try {
    setAuthMessage("Enviando enlace de recuperación...");
    await sendPasswordResetEmail(auth, email);
    setAuthMessage("Te enviamos un correo para restablecer la contraseña.", "success");
  } catch (error) {
    console.error(error);
    setAuthMessage(humanizeAuthError(error), "error");
  }
}

function showTenantOnboarding() {
  setAuthPending(false);
  elements.tenantOnboardingEmail.value = state.authUser?.email || elements.authEmail.value.trim();
  elements.tenantOnboardingPassword.value = state.authUser ? "" : elements.authPassword.value;
  elements.loadingSessionPanel?.classList.add("hidden");
  elements.accessDeniedPanel?.classList.add("hidden");
  elements.tenantOnboardingPanel.classList.remove("hidden");
  elements.loginPanel.classList.add("hidden");
  elements.paymentTokenPanel.classList.add("hidden");
  setTenantOnboardingMessage("");
}

function showLoginPanel() {
  setTenantOnboardingPending(false);
  elements.loadingSessionPanel?.classList.add("hidden");
  elements.accessDeniedPanel?.classList.add("hidden");
  elements.tenantOnboardingPanel.classList.add("hidden");
  elements.paymentTokenPanel.classList.add("hidden");
  elements.loginPanel.classList.remove("hidden");
  setTenantOnboardingMessage("", "info");
}

async function handlePropertyTypeChange() {
  if (!elements.tenantPropertyType || !elements.tenantPropertyCode) {
    return;
  }
  const propertyType = elements.tenantPropertyType.value;
  elements.tenantPropertyCode.innerHTML = `<option value="">Cargando opciones...</option>`;

  if (!propertyType) {
    elements.tenantPropertyCode.innerHTML = `<option value="">Primero elegi el tipo</option>`;
    elements.tenantPropertyCodeLabel.classList.remove("hidden");
    return;
  }

  if (propertyType === "Casa") {
    elements.tenantPropertyCode.innerHTML = `<option value="1">Casa 1</option>`;
    elements.tenantPropertyCodeLabel.classList.add("hidden");
    return;
  }

  try {
    const listUnits = httpsCallable(functions, "listAvailableUnits");
    const result = await listUnits({ propertyType });
    const options = result.data?.options || [];

    elements.tenantPropertyCodeLabel.classList.remove("hidden");
    elements.tenantPropertyCode.innerHTML = options.length
      ? options
          .map(
            (option) =>
              `<option value="${option.unitCode}">${propertyType} ${option.unitCode}</option>`
          )
          .join("")
      : `<option value="">No quedan opciones disponibles</option>`;
  } catch (error) {
    console.error(error);
    elements.tenantPropertyCode.innerHTML = `<option value="">No se pudieron cargar las opciones</option>`;
    setTenantOnboardingMessage("No pudimos cargar las propiedades disponibles.", "error");
  }
}

async function handleTenantOnboardingSubmit(event) {
  event.preventDefault();
  if (state.tenantOnboardingPending) {
    return;
  }

  setTenantOnboardingPending(true);
  setTenantOnboardingMessage("Verificando invitacion...");

  const formData = new FormData(event.currentTarget);
  const email = (
    elements.tenantOnboardingEmail?.value?.trim()
    || String(formData.get("email") ?? "").trim()
    || elements.authEmail?.value?.trim()
    || ""
  );
  const password = (
    elements.tenantOnboardingPassword?.value
    || String(formData.get("password") ?? "")
    || elements.authPassword?.value
    || ""
  );
  const hasAuthenticatedSessionForEmail =
    Boolean(auth.currentUser?.uid)
    && String(auth.currentUser?.email || "").trim().toLowerCase() === email.toLowerCase();
  let createdAuthAccountInThisAttempt = false;
  if (!email || (!password && !hasAuthenticatedSessionForEmail)) {
    setTenantOnboardingMessage("Completá correo y contraseña para reclamar tu acceso.", "error");
    setTenantOnboardingPending(false);
    return;
  }

  try {
    if (!hasAuthenticatedSessionForEmail) {
      try {
        stampSessionActivity(true);
        await createUserWithEmailAndPassword(auth, email, password);
        createdAuthAccountInThisAttempt = true;
      } catch (error) {
        if (error?.code?.includes("email-already-in-use")) {
          stampSessionActivity(true);
          await signInWithEmailAndPassword(auth, email, password);
        } else {
          throw error;
        }
      }
    }

    await auth.currentUser?.getIdToken(true);
    const createProfile = httpsCallable(functions, "createTenantProfile");
    await createProfile();
    await auth.currentUser?.getIdToken(true);
    setTenantOnboardingMessage("Acceso vinculado. Estamos preparando tu portal.", "success");
  } catch (error) {
    console.error(error);
    if (createdAuthAccountInThisAttempt) {
      await rollbackTenantOnboardingAccount(email);
    }
    setTenantOnboardingMessage(
      humanizeFunctionError(error) || humanizeAuthError(error) || "No encontramos una invitacion para este correo. Pedile a administracion que prepare tu acceso.",
      "error"
    );
  } finally {
    setTenantOnboardingPending(false);
  }
}

async function rollbackTenantOnboardingAccount(email) {
  try {
    if (auth.currentUser && String(auth.currentUser.email || "").trim().toLowerCase() === String(email || "").trim().toLowerCase()) {
      await deleteUser(auth.currentUser);
    }
  } catch (error) {
    console.error("No se pudo revertir la cuenta de autenticacion creada durante el onboarding", error);
    try {
      await signOut(auth);
    } catch (signOutError) {
      console.error("No se pudo cerrar la sesion tras un fallo de onboarding", signOutError);
    }
  }
}

function ensureTenantSchedulingFields() {
  ensureTenantCreateSchedulingFields();
  ensureTenantEditSchedulingFields();
}

function ensureTenantCreateSchedulingFields() {
  const form = elements.tenantForm;
  if (!form || form.querySelector("#tenant-due-day")) {
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  const dueDayField = document.createElement("label");
  dueDayField.innerHTML = `
    Día de vencimiento
    <input id="tenant-due-day" name="dueDayOfMonth" type="number" min="1" max="28" placeholder="Usar configuración general" />
  `;

  const frequencyField = document.createElement("label");
  frequencyField.innerHTML = `
    Frecuencia de actualización
    <select id="tenant-rent-frequency" name="rentUpdateFrequency">
      <option value="quarterly" selected>Trimestral</option>
      <option value="monthly">Mensual</option>
      <option value="semiannual">Semestral</option>
    </select>
  `;

  const nextPeriodField = document.createElement("label");
  nextPeriodField.innerHTML = `
    Próximo período de actualización
    <input id="tenant-next-adjustment-period" name="nextAdjustmentPeriod" type="month" />
  `;

  submitButton?.insertAdjacentElement("beforebegin", nextPeriodField);
  submitButton?.insertAdjacentElement("beforebegin", frequencyField);
  submitButton?.insertAdjacentElement("beforebegin", dueDayField);
}

function ensureTenantEditSchedulingFields() {
  const form = elements.tenantEditForm;
  if (!form || form.querySelector("#tenant-edit-due-day")) {
    return;
  }

  const anchor = elements.tenantEditContractStartDate?.closest("label");
  const dueDayField = document.createElement("label");
  dueDayField.innerHTML = `
    Día de vencimiento
    <input id="tenant-edit-due-day" name="dueDayOfMonth" type="number" min="1" max="28" placeholder="Usar configuración general" />
  `;

  const frequencyField = document.createElement("label");
  frequencyField.innerHTML = `
    Frecuencia de actualización
    <select id="tenant-edit-rent-frequency" name="rentUpdateFrequency">
      <option value="quarterly">Trimestral</option>
      <option value="monthly">Mensual</option>
      <option value="semiannual">Semestral</option>
    </select>
  `;

  const nextPeriodField = document.createElement("label");
  nextPeriodField.innerHTML = `
    Próximo período de actualización
    <input id="tenant-edit-next-adjustment-period" name="nextAdjustmentPeriod" type="month" />
  `;

  anchor?.insertAdjacentElement("beforebegin", nextPeriodField);
  anchor?.insertAdjacentElement("beforebegin", frequencyField);
  anchor?.insertAdjacentElement("beforebegin", dueDayField);
}

async function loadUserProfile(userId) {
  const tokenResult = state.authUser ? await getIdTokenResult(state.authUser) : null;
  state.authClaims = extractAuthorityClaims(tokenResult?.claims);

  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    const claimed = await tryClaimTenantAccess();
    if (claimed) {
      await loadUserProfile(userId);
      return;
    }

    state.profile = null;
    state.role = null;
    const bootstrapEligibility = await getBootstrapEligibility();
    renderPendingAccess(Boolean(bootstrapEligibility.canBootstrap));
    return;
  }

  state.profile = { id: userSnap.id, ...userSnap.data() };
  state.role = state.profile.role ?? null;

  if (state.profile.status && state.profile.status !== "active") {
    state.profile = null;
    state.role = null;
    renderAccessDenied({
      title: "Tu acceso no está activo",
      copy: "Tu usuario ya no está activo. Contacta a administración."
    });
    return;
  }

  if (state.authUser && sessionClaimsNeedRefresh(state.profile, state.authClaims)) {
    await state.authUser.getIdToken(true);
    const refreshedTokenResult = await getIdTokenResult(state.authUser, true);
    state.authClaims = extractAuthorityClaims(refreshedTokenResult?.claims);

    if (sessionClaimsNeedRefresh(state.profile, state.authClaims)) {
      state.profile = null;
      state.role = null;
      renderAccessDenied({
        title: "Tu sesión necesita actualizar permisos",
        copy: "Actualizamos tu perfil, pero tu token todavía no refleja los permisos vigentes.",
        message: "Cerrá sesión y volvé a ingresar para continuar sin usar permisos antiguos.",
        primaryAction: {
          label: "Volver al ingreso",
          intent: "sign-out-and-return"
        }
      });
      return;
    }
  }

  if (!["superadmin", "admin", "tenant"].includes(String(state.role || ""))) {
    state.profile = null;
    state.role = null;
    renderAccessDenied({
      title: "Rol no válido",
      copy: "Tu cuenta no tiene un rol válido para ingresar a la aplicación."
    });
    return;
  }

  await renderSignedIn();
  subscribeRoleData();
}

function extractAuthorityClaims(claims) {
  return claims
    ? {
        role: claims.role || null,
        tenantId: claims.tenantId || null,
        ownerScope: claims.ownerScope || null,
        authVersion: typeof claims.authVersion === "number" ? claims.authVersion : null
      }
    : null;
}

function sessionClaimsNeedRefresh(profile, claims) {
  if (!profile) {
    return false;
  }

  if (!claims?.role || claims.role !== profile.role) {
    return true;
  }

  if (profile.role === "tenant") {
    return !profile.tenantId || claims.tenantId !== profile.tenantId;
  }

  const profileScope = profile.role === "superadmin" ? "all" : normalizeOwnerScope(profile.ownerScope);
  if (claims.ownerScope && normalizeOwnerScope(claims.ownerScope) !== profileScope) {
    return true;
  }

  return typeof profile.authVersion === "number"
    && typeof claims.authVersion === "number"
    && claims.authVersion !== profile.authVersion;
}

async function tryClaimTenantAccess() {
  const email = state.authUser?.email;

  if (!email) {
    return false;
  }

  try {
    const claimAccess = httpsCallable(functions, "claimTenantAccess");
    const result = await claimAccess();
    const claimed = Boolean(result.data?.ok);
    if (claimed) {
      await auth.currentUser?.getIdToken(true);
    }
    return claimed;
  } catch (error) {
    console.error("No se pudo vincular el acceso del inquilino", error);
    return false;
  }
}

async function getBootstrapEligibility() {
  if (!state.authUser) {
    return { canBootstrap: false };
  }

  try {
    const checkBootstrapEligibility = httpsCallable(functions, "checkBootstrapEligibility");
    const result = await checkBootstrapEligibility();
    return result.data || { canBootstrap: false };
  } catch (error) {
    console.error("No se pudo verificar el acceso inicial", error);
    return { canBootstrap: false };
  }
}

function hidePublicPanels() {
  elements.loadingSessionPanel?.classList.add("hidden");
  elements.loginPanel?.classList.add("hidden");
  elements.tenantOnboardingPanel?.classList.add("hidden");
  elements.paymentTokenPanel?.classList.add("hidden");
  elements.accessDeniedPanel?.classList.add("hidden");
}

function renderLoadingSession() {
  document.body.classList.add("session-pending");
  hidePublicPanels();
  elements.authScreen.classList.remove("hidden");
  elements.loadingSessionPanel?.classList.remove("hidden");
  elements.appShell?.classList.add("app-hidden");
  unmountPrivateApp();
}

function renderAccessDenied({
  title = "No pudimos habilitar tu acceso",
  copy = "Revisa tu sesión o comunícate con administración.",
  message = "",
  canBootstrap = false,
  primaryAction = null
} = {}) {
  setMobileNavOpen(false);
  setAuthPending(false);
  setTenantOnboardingPending(false);
  document.body.classList.remove("role-admin", "role-tenant", "session-pending");
  hidePublicPanels();
  elements.authScreen.classList.remove("hidden");
  elements.accessDeniedPanel?.classList.remove("hidden");
  elements.appShell?.classList.add("app-hidden");
  unmountPrivateApp();

  if (elements.accessDeniedTitle) {
    elements.accessDeniedTitle.textContent = title;
  }
  if (elements.accessDeniedCopy) {
    elements.accessDeniedCopy.textContent = copy;
  }
  if (elements.accessDeniedMessage) {
    elements.accessDeniedMessage.textContent = message;
    elements.accessDeniedMessage.dataset.tone = message ? (canBootstrap ? "info" : "warning") : "info";
  }

  if (elements.accessDeniedActions && elements.bootstrapButton) {
    const shouldShowAction = canBootstrap || Boolean(primaryAction);
    elements.accessDeniedActions.classList.toggle("hidden", !shouldShowAction);
    elements.bootstrapButton.classList.toggle("hidden", !shouldShowAction);
    if (canBootstrap) {
      elements.bootstrapButton.textContent = "Convertirme en admin inicial";
      elements.bootstrapButton.dataset.intent = "bootstrap-admin";
    } else if (primaryAction) {
      elements.bootstrapButton.textContent = primaryAction.label;
      elements.bootstrapButton.dataset.intent = primaryAction.intent;
    } else {
      elements.bootstrapButton.dataset.intent = "";
    }
  }
}

function renderSignedOut() {
  setMobileNavOpen(false);
  setAuthPending(false);
  setTenantOnboardingPending(false);
  document.body.classList.remove("role-admin", "role-tenant");
  document.body.classList.remove("session-pending");
  hidePublicPanels();
  elements.authScreen.classList.remove("hidden");
  elements.appShell?.classList.add("app-hidden");
  unmountPrivateApp();
  setActiveSection("resumen");
  if (state.postSignOutAuthMessage) {
    setAuthMessage(state.postSignOutAuthMessage, "error");
    state.postSignOutAuthMessage = "";
  } else {
    setAuthMessage("");
  }
  if (elements.accessDeniedMessage) {
    elements.accessDeniedMessage.textContent = "";
  }
  setMessage("");

  if (state.tokenPortalActive) {
    elements.paymentTokenPanel?.classList.remove("hidden");
    return;
  }

  showLoginPanel();
}

function renderPendingAccess(canBootstrap) {
  if (state.tokenPortalActive) {
    hidePublicPanels();
    elements.paymentTokenPanel?.classList.remove("hidden");
    setAuthMessage("");
    return;
  }

  renderAccessDenied({
    title: canBootstrap ? "Administrador inicial" : "Acceso pendiente",
    copy: canBootstrap
      ? "Si esta es la primera cuenta del proyecto, puedes activarla como administrador inicial."
      : "Tu cuenta existe, pero tu perfil de inquilino todavía no quedó completo. Continúa el alta para terminar de habilitar el acceso.",
    message: canBootstrap
      ? "Tu cuenta existe pero todavía no tiene rol. Si esta es la primera cuenta, activa el administrador inicial."
      : "Si el sistema no completó tu alta, vuelve a ingresar tus datos desde Completar perfil de inquilino.",
    canBootstrap,
    primaryAction: !canBootstrap && state.authUser?.email
      ? {
          label: "Completar perfil de inquilino",
          intent: "resume-tenant-onboarding"
        }
      : null
  });
}

function humanizeProfileLoadError(error) {
  const code = String(error?.code || "");
  if (code.includes("permission-denied")) {
    return "La cuenta ingresó correctamente, pero no tiene permisos válidos para cargar su perfil.";
  }
  if (code.includes("unavailable")) {
    return "No pudimos cargar la información de acceso en este momento. Revisa tu conexión e intentá nuevamente.";
  }
  if (code.includes("unauthenticated")) {
    return "La sesión no pudo validarse correctamente. Volvé a ingresar.";
  }

  return "Se produjo un problema al cargar tu acceso. Volvé al ingreso e intentá nuevamente.";
}


async function renderSignedIn() {
  const isAdmin = isAdminRole();
  await mountPrivateApp(state.role);
  state.recentAuthAttemptAt = 0;
  setMobileNavOpen(false);
  document.body.classList.toggle("role-admin", isAdmin);
  document.body.classList.toggle("role-tenant", !isAdmin);

  elements.sidebarRole.textContent = isAdmin ? "Administración" : "Mi alquiler";
  elements.sessionName.textContent = state.profile.displayName || state.authUser.email || "Usuario";
  elements.sessionMeta.textContent = isAdmin
    ? getCurrentOwnerScope() === "all"
      ? "Panel administrativo activo."
      : `Panel administrativo activo para ${normalizeOwnerLabel(getCurrentOwnerScope())}.`
    : "Portal personal activo.";
  elements.topbarEyebrow.textContent = "";
  elements.topbarEyebrow.classList.add("hidden");
  elements.topbarTitle.textContent = isAdmin
    ? getCurrentOwnerScope() === "all"
      ? "Administración"
      : `Administración · ${normalizeOwnerLabel(getCurrentOwnerScope())}`
    : "Mi alquiler";
  elements.userChip.textContent = isAdmin
    ? isSuperadminRole()
      ? humanizeUserRole(state.role)
      : `${humanizeUserRole(state.role)} · ${normalizeOwnerLabel(getCurrentOwnerScope())}`
    : "Inquilino";
  elements.userChip.className = `status ${isAdmin ? "warning" : "neutral"}`;
  resetSectionHistory();
  setActiveSection(isAdmin ? "resumen" : "mi-alquiler", { replaceHistory: true });
  renderAdminSettings();
  renderCheckoutFeedback();
  setAuthMessage("");
  hidePublicPanels();
  elements.authScreen.classList.add("hidden");
  elements.appShell?.classList.remove("app-hidden");
  document.body.classList.remove("session-pending");
}


async function handleBootstrapAdmin() {
  if (!state.authUser) {
    setAuthMessage("Primero crea o inicia sesión con tu cuenta.");
    return;
  }

  try {
    setAuthMessage("Activando administrador inicial...");
    const bootstrapInitialAdmin = httpsCallable(functions, "bootstrapInitialAdmin");
    await bootstrapInitialAdmin();
    await auth.currentUser?.getIdToken(true);
    setAuthMessage("Administrador inicial activado. Recargando permisos...", "success");
    await loadUserProfile(state.authUser.uid);
  } catch (error) {
    setAuthMessage(humanizeAuthError(error), "error");
    console.error(error);
  }
}

function subscribeRoleData() {
  if (isAdminRole()) {
    subscribeAdminData();
  } else {
    subscribeTenantData();
  }
}

function subscribeAdminData() {
    const currentScope = getCurrentOwnerScope();

  state.unsubscribers.push(
    onSnapshot(doc(db, "settings", "general"), (snapshot) => {
      state.generalSettings = snapshot.exists() ? snapshot.data() : null;
      renderAdminSettings();
      renderSummary();
      renderCharges();
      renderTenants();
    })
  );

  state.unsubscribers.push(
    onSnapshot(doc(db, "settings", "bankAccounts"), (snapshot) => {
      state.bankAccounts = snapshot.exists() ? snapshot.data() : null;
      renderAdminSettings();
    })
  );

    state.unsubscribers.push(
      onSnapshot(query(collection(db, "utilityBills"), orderBy("createdAt", "desc")), (snapshot) => {
        state.utilityBills = snapshot.docs.map(mapDoc);
        renderUtilityBills();
      })
    );

    subscribeScopedAdminData(currentScope);

    if (isSuperadminRole()) {
      state.unsubscribers.push(
        onSnapshot(query(collection(db, "auditLogs"), orderBy("createdAt", "desc")), (snapshot) => {
          state.auditLogs = snapshot.docs.map(mapDoc);
          renderAuditLogs();
        })
      );

      state.unsubscribers.push(
        onSnapshot(collection(db, "users"), (snapshot) => {
          state.users = snapshot.docs.map(mapDoc);
          renderUserAccessList();
        })
      );
      return;
    }

    state.auditLogs = [];
    state.users = [];
    renderAuditLogs();
    renderUserAccessList();
  }

function subscribeScopedAdminData(currentScope) {
  state.adminDiagnostics = {
      source: "backend-scoped",
      frontendScope: currentScope,
      backendScope: null,
      counts: {
        properties: 0,
        tenants: 0,
        charges: 0,
        payments: 0
      },
      propertySummary: null,
      propertySamples: [],
      error: ""
    };
  state.auditLogs = [];
  state.users = [];
  renderAuditLogs();
  renderUserAccessList();

  loadScopedAdminDataset(currentScope);
  startScopedAdminAutoRefresh(currentScope);
}

async function loadScopedAdminDataset(currentScope) {
  if (state.scopedAdminRefreshPending) {
    return;
  }

  state.scopedAdminRefreshPending = true;
  try {
    const getScopedAdminDataset = httpsCallable(functions, "getScopedAdminDataset");
    const result = await getScopedAdminDataset();
    const payload = result.data ?? {};

    state.properties = Array.isArray(payload.properties) ? payload.properties : [];
    state.tenants = Array.isArray(payload.tenants) ? payload.tenants : [];
    state.charges = Array.isArray(payload.charges)
      ? payload.charges.sort((left, right) => resolveDateSortValue(left.dueDate) - resolveDateSortValue(right.dueDate))
      : [];
    state.payments = Array.isArray(payload.payments) ? payload.payments.sort(sortByCreatedAtDesc) : [];
    state.receipts = Array.isArray(payload.paymentReceipts) ? payload.paymentReceipts.sort(sortByCreatedAtDesc) : [];
    state.rentReceipts = Array.isArray(payload.rentReceipts) ? payload.rentReceipts.sort(sortByCreatedAtDesc) : [];
      state.rentAdjustments = Array.isArray(payload.rentAdjustments) ? payload.rentAdjustments.sort(sortByCreatedAtDesc) : [];
      state.rentAdjustmentPolicies = Array.isArray(payload.rentAdjustmentPolicies) ? payload.rentAdjustmentPolicies : [];
      state.messages = Array.isArray(payload.messages) ? payload.messages.sort(sortByCreatedAtDesc) : [];
    state.adminDiagnostics = {
        source: "backend-scoped",
        frontendScope: currentScope,
        backendScope: payload.scope || null,
        counts: {
          properties: state.properties.length,
          tenants: state.tenants.length,
          charges: state.charges.length,
          payments: state.payments.length
        },
        propertySummary: payload.diagnostics?.propertySummary || null,
        propertySamples: Array.isArray(payload.diagnostics?.propertySamples) ? payload.diagnostics.propertySamples : [],
        error: ""
      };

    state.comprobanteFilters = {
      ...state.comprobanteFilters,
      owner: currentScope
    };

    renderPropertySelect();
    renderProperties();
    renderTenants();
    renderMessageTenantOptions();
    renderSummary();
    renderCharges();
    renderChargeRentUpdateSuite();
    renderAdminPaymentReview();
    renderMessages();
  } catch (error) {
    console.error(error);
    state.properties = [];
    state.tenants = [];
    state.charges = [];
    state.payments = [];
    state.receipts = [];
    state.rentReceipts = [];
      state.rentAdjustments = [];
      state.rentAdjustmentPolicies = [];
      state.messages = [];
    state.adminDiagnostics = {
        source: "backend-scoped",
        frontendScope: currentScope,
        backendScope: null,
        counts: {
          properties: 0,
          tenants: 0,
          charges: 0,
          payments: 0
        },
        propertySummary: null,
        propertySamples: [],
        error: error?.message || "Sin detalle"
      };
    renderPropertySelect();
    renderProperties();
    renderTenants();
    renderMessageTenantOptions();
    renderSummary();
    renderCharges();
    renderChargeRentUpdateSuite();
    renderAdminPaymentReview();
    renderMessages();
    setMessage(`No pudimos cargar la operación de ${normalizeOwnerLabel(currentScope)}.`, "error");
  } finally {
    state.scopedAdminRefreshPending = false;
  }

  state.auditLogs = [];
  state.users = [];
  renderAuditLogs();
  renderUserAccessList();
}

async function reloadScopedAdminOperation() {
  const currentScope = getCurrentOwnerScope();
  await loadScopedAdminDataset(currentScope);
}

function startScopedAdminAutoRefresh(currentScope) {
  const refreshScopedDataset = () => {
    if (!isAdminRole() || !state.authUser) {
      return;
    }
    if (document.hidden) {
      return;
    }
    loadScopedAdminDataset(currentScope);
  };

  const handleVisibilityRefresh = () => {
    if (!document.hidden) {
      refreshScopedDataset();
    }
  };

  state.scopedAdminRefreshScope = currentScope;
  const intervalId = window.setInterval(refreshScopedDataset, SCOPED_ADMIN_REFRESH_INTERVAL_MS);
  window.addEventListener("focus", refreshScopedDataset);
  document.addEventListener("visibilitychange", handleVisibilityRefresh);

  state.unsubscribers.push(() => window.clearInterval(intervalId));
  state.unsubscribers.push(() => window.removeEventListener("focus", refreshScopedDataset));
  state.unsubscribers.push(() => document.removeEventListener("visibilitychange", handleVisibilityRefresh));
}

function subscribeTenantData() {
  const tenantId = state.profile.tenantId;

  if (!tenantId) {
    setMessage("Tu cuenta no tiene un inquilino asociado todavía.");
    return;
  }

  let unsubscribeUtilityBills = null;

  state.unsubscribers.push(
    onSnapshot(doc(db, "settings", "bankAccounts"), (snapshot) => {
      state.bankAccounts = snapshot.exists() ? snapshot.data() : null;
      renderTenantPortal();
    })
  );

  state.unsubscribers.push(
    onSnapshot(doc(db, "tenants", tenantId), async (snapshot) => {
      state.currentTenant = snapshot.exists() ? mapDoc(snapshot) : null;

      if (state.currentTenant?.propertyId) {
        const propertySnap = await getDoc(doc(db, "properties", state.currentTenant.propertyId));
        state.currentProperty = propertySnap.exists() ? mapDoc(propertySnap) : null;
      } else {
        state.currentProperty = null;
      }

      if (unsubscribeUtilityBills) {
        unsubscribeUtilityBills();
        unsubscribeUtilityBills = null;
      }

      if (state.currentProperty) {
        const allowedGroups = resolveTenantUtilityBillingGroups(state.currentProperty);
        if (allowedGroups.length > 0) {
          unsubscribeUtilityBills = onSnapshot(
            query(collection(db, "utilityBills"), where("billingGroup", "in", allowedGroups)),
            (snap) => {
              state.utilityBills = snap.docs.map(mapDoc);
              renderTenantPortal();
            }
          );
        } else {
          state.utilityBills = [];
        }
      } else {
        state.utilityBills = [];
      }

      renderTenantPortal();
    })
  );

  state.unsubscribers.push(
    onSnapshot(query(collection(db, "charges"), where("tenantId", "==", tenantId)), (snapshot) => {
      state.charges = snapshot.docs.map(mapDoc);
      renderTenantPortal();
    })
  );

    state.unsubscribers.push(
      onSnapshot(query(collection(db, "payments"), where("tenantId", "==", tenantId)), (snapshot) => {
        state.payments = snapshot.docs.map(mapDoc);
        renderTenantPortal();
      })
    );

    state.unsubscribers.push(
      onSnapshot(query(collection(db, "paymentReceipts"), where("tenantId", "==", tenantId)), (snapshot) => {
        state.receipts = snapshot.docs.map(mapDoc);
        renderTenantPortal();
      })
    );

    state.unsubscribers.push(
      onSnapshot(query(collection(db, "rentReceipts"), where("tenantId", "==", tenantId)), (snapshot) => {
        state.rentReceipts = snapshot.docs.map(mapDoc);
        renderTenantPortal();
      })
    );
}

async function handlePropertySubmit(event) {
  event.preventDefault();

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede crear propiedades.");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const transferBlock = formData.get("transferBlock")?.toString()
    || inferTransferBlockFromUnitCode(formData.get("unitCode")?.toString().trim());
  const ownerScope = transferBlockToOwnerScope(transferBlock);

  if (getCurrentOwnerScope() !== "all" && getCurrentOwnerScope() !== ownerScope) {
    setMessage(`Tu cuenta solo puede crear unidades para ${normalizeOwnerLabel(getCurrentOwnerScope())}.`, "error");
    return;
  }

    const unitCode = formData.get("unitCode")?.toString().trim() ?? "";
    const computedSortOrder = Number(unitCode) || state.properties.length + 1;

    await addDoc(collection(db, "properties"), {
      name: formData.get("name")?.toString().trim() ?? "",
      unitType: formData.get("unitType")?.toString() ?? "Departamento",
      unitCode,
      transferBlock,
      ownerScope,
      ownerId: ownerScope,
      ownerName: normalizeOwnerLabel(ownerScope),
      status: formData.get("status")?.toString().trim() ?? "active",
      notes: "",
      currentTenantId: null,
      sortOrder: computedSortOrder,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

  event.currentTarget.reset();
  setMessage("Propiedad guardada en Firebase.");
}

async function handleTenantSubmit(event) {
  event.preventDefault();

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede crear inquilinos.");
    return;
  }

  const formData = new FormData(event.currentTarget);

  const fullName = formData.get("fullName")?.toString().trim() ?? "";
  const email = formData.get("email")?.toString().trim().toLowerCase() ?? "";

  try {
    const createTenant = httpsCallable(functions, "createTenantAdminProfile");
    await createTenant({
      fullName,
      dni: formData.get("dni")?.toString().trim() ?? "",
      phone: formData.get("phone")?.toString().trim() ?? "",
      email,
      propertyId: formData.get("propertyId")?.toString() || null,
      baseRent: Number(formData.get("baseRent") ?? 0),
      dueDayOfMonth: normalizeTenantDueDayValue(formData.get("dueDayOfMonth")),
      rentUpdateFrequency: normalizeTenantRentFrequencyValue(formData.get("rentUpdateFrequency")),
      nextAdjustmentPeriod: normalizeTenantPeriodValue(formData.get("nextAdjustmentPeriod")),
      contractStartDate: formData.get("contractStartDate")?.toString() || null,
      contractEndDate: formData.get("contractEndDate")?.toString() || null
    });

    try {
      const generateCharges = httpsCallable(functions, "generateMonthlyCharges");
      await generateCharges();
    } catch (error) {
      console.error("No se pudo generar el cobro actual tras crear el inquilino", error);
    }
  } catch (error) {
    console.error("No se pudo crear el inquilino", error);
    setMessage(humanizeFunctionError(error) || "No se pudo crear el inquilino. Revisá si el correo ya tiene una invitación activa.", "error");
    return;
  }

  event.currentTarget.reset();
  renderPropertySelect();
  setMessage(
    email
      ? "Inquilino guardado e invitacion preparada para ese correo."
      : "Inquilino guardado en Firebase."
  );
}

async function handleUtilityBillSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede cargar facturas.", "error");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const file = elements.utilityBillFile.files?.[0];

  if (!file) {
    setMessage("Selecciona un archivo para la factura.", "error");
    return;
  }

  try {
    setMessage("Subiendo factura...");
    const billRef = doc(collection(db, "utilityBills"));
    const safeName = `${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
    const billingGroup = String(formData.get("billingGroup") ?? "general");
    const storagePath = `utility-bills/${billingGroup}/${billRef.id}/${safeName}`;
    const storageRef = ref(storage, storagePath);

    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream"
    });

    const downloadURL = await getDownloadURL(storageRef);

    await setDoc(billRef, {
      billingGroup: String(formData.get("billingGroup") ?? ""),
      serviceType: String(formData.get("serviceType") ?? ""),
      period: String(formData.get("period") ?? ""),
      storagePath,
      downloadURL,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      claudeStatus: "pending",
      amount: null,
      dueDate: null,
      appliedToCharges: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    form.reset();
    renderUtilityBillGroupOptions();
    setMessage("Factura cargada. Ahora puedes analizarla.");
  } catch (error) {
    console.error(error);
    setMessage("No se pudo cargar la factura.", "error");
  }
}

async function handleTenantEditSubmit(event) {
  event.preventDefault();

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede editar inquilinos.", "error");
    return;
  }

  const formData = new FormData(event.currentTarget);
  const tenantId = String(formData.get("tenantId") ?? "");
  const tenant = state.tenants.find((item) => item.id === tenantId);

  if (!tenantId || !tenant) {
    setMessage("No se encontro el inquilino a editar.", "error");
    return;
  }

  const payload = {
    tenantId,
    fullName: formData.get("fullName")?.toString().trim() ?? "",
    dni: formData.get("dni")?.toString().trim() ?? "",
    phone: formData.get("phone")?.toString().trim() ?? "",
    email: formData.get("email")?.toString().trim().toLowerCase() ?? "",
    propertyId: formData.get("propertyId")?.toString() ?? "",
    baseRent: Number(formData.get("baseRent") ?? 0),
    dueDayOfMonth: normalizeTenantDueDayValue(formData.get("dueDayOfMonth")),
    rentUpdateFrequency: normalizeTenantRentFrequencyValue(formData.get("rentUpdateFrequency")),
    nextAdjustmentPeriod: normalizeTenantPeriodValue(formData.get("nextAdjustmentPeriod")),
    contractStartDate: formData.get("contractStartDate")?.toString() || null,
    contractEndDate: formData.get("contractEndDate")?.toString() || null
  };

  try {
    setMessage("Guardando cambios del inquilino...");
    const updateTenantAdminProfile = httpsCallable(functions, "updateTenantAdminProfile");
    await updateTenantAdminProfile(payload);
    closeTenantEditModal();
    setMessage("La ficha del inquilino fue actualizada.");
  } catch (error) {
    console.error(error);
    setMessage(error?.message?.includes("already") ? "La propiedad seleccionada ya esta ocupada." : "No se pudo actualizar el inquilino.", "error");
  }
}

async function handleGenerateCharges() {
  if (!isAdminRole()) {
    setMessage("Solo un administrador puede generar cobros.");
    return;
  }

  try {
    setMessage("Generando cobros del mes...");
    const generateCharges = httpsCallable(functions, "generateMonthlyCharges");
    const result = await generateCharges();
    const created = result.data?.created ?? 0;
    const synced = result.data?.synced ?? 0;
    setMessage(
      created
        ? `Se generaron ${created} cobros del mes y se recalcularon ${synced} estados.`
        : `No habia cobros nuevos para crear. Se recalcularon ${synced} estados igualmente.`
    );
  } catch (error) {
    console.error(error);
    setMessage("No se pudieron generar los cobros desde el backend.", "error");
  }
}

async function handleSyncCharges() {
  if (!isAdminRole()) {
    setMessage("Solo un administrador puede actualizar vencimientos.");
    return;
  }

  try {
    setMessage("Actualizando vencimientos y mora...");
    const syncCharges = httpsCallable(functions, "syncChargeStatuses");
    const result = await syncCharges();
    setMessage(`Se actualizaron ${result.data?.updated ?? 0} cobros.`);
  } catch (error) {
    console.error(error);
    setMessage("No se pudo actualizar la mora y los vencimientos.", "error");
  }
}

async function handleSendPaymentWarnings() {
  if (!isAdminRole()) {
    setMessage("Solo un administrador puede enviar avisos de pago.");
    return;
  }

  const confirmed = window.confirm(
    "Se enviará un aviso a cada inquilino con un cobro pendiente o vencido. ¿Deseas continuar?"
  );
  if (!confirmed) {
    return;
  }

  try {
    setMessage("Enviando avisos de pago...");
    const sendWarnings = httpsCallable(functions, "sendPaymentWarningsNow");
    const result = await sendWarnings();
    const sent = result.data?.sent ?? 0;
    const failed = result.data?.failed ?? 0;
    setMessage(
      failed
        ? `Se enviaron ${sent} avisos y ${failed} no pudieron entregarse. Revisa la configuración del canal.`
        : `Se enviaron ${sent} avisos de pago.`
      ,
      failed ? "error" : undefined
    );
  } catch (error) {
    console.error(error);
    setMessage("No se pudieron enviar los avisos de pago.", "error");
  }
}

async function handleTenantPaymentSubmit(event) {
  event.preventDefault();

  if (isAdminRole()) {
    setMessage("Este formulario es solo para el portal del inquilino.");
    return;
  }

  const tenantId = state.profile?.tenantId;
  const chargeId = elements.tenantChargeSelect.value;
  const amountReported = Number(elements.tenantPaymentAmount.value || 0);
  const files = Array.from(elements.tenantReceipts.files || []).slice(0, 2);

  if (!tenantId || !chargeId || !amountReported) {
    setMessage("Completa el cobro y el monto antes de enviar.");
    return;
  }

  const currentCharge = state.charges.find((charge) => charge.id === chargeId);
  if (!currentCharge) {
    setMessage("No se encontro el cobro seleccionado.");
    return;
  }

  if (!files.length) {
    setMessage("Subi al menos un comprobante antes de continuar.");
    return;
  }

  setMessage("Subiendo comprobantes...");
  const receiptIds = await uploadPaymentReceiptFiles({
    tenantId,
    files,
    storageFolder: `payment-receipts/${state.authUser.uid}`,
    source: "tenant_portal"
  });

  try {
    setMessage("Validando comprobante...");
    const submitTransfer = httpsCallable(functions, "submitTransferPayment");
    const result = await submitTransfer({
      tenantId,
      chargeId,
      amountReported,
      receiptIds
    });

    if (result.data?.blocked) {
      const validation = result.data?.validation || {};
        setMessage(
        `${result.data.reason} Esperado: ${formatCurrency(validation.expectedAmount || currentCharge.total || 0)}. Detectado: ${formatCurrency(validation.totalDetected || 0)}.`,
        "error"
      );
        return;
      }
    } catch (error) {
      console.error(error);
    setMessage("No se pudo validar el comprobante. Revisa el archivo o intenta de nuevo.", "error");
      return;
    }

  elements.tenantPaymentForm.reset();
  setMessage("Comprobantes validados. El pago quedó en revisión administrativa.");
}

async function handleAdminReceiptUploadSubmit(event) {
  event.preventDefault();

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede cargar comprobantes desde esta pantalla.", "error");
    return;
  }

  const tenantId = elements.adminReceiptUploadTenantId?.value;
  const chargeId = elements.adminReceiptUploadChargeId?.value;
  const amountReported = Number(elements.adminReceiptUploadAmount?.value || 0);
  const files = Array.from(elements.adminReceiptUploadFiles?.files || []).slice(0, 2);

  if (!tenantId || !chargeId || !amountReported) {
    setMessage("Completa el cobro y el monto antes de enviar el comprobante.", "error");
    return;
  }

  if (!files.length) {
    setMessage("Subí al menos un comprobante antes de continuar.", "error");
    return;
  }

  const currentCharge = state.charges.find((charge) => charge.id === chargeId);
  if (!currentCharge) {
    setMessage("No se encontró el cobro seleccionado.", "error");
    return;
  }

  try {
    setMessage("Subiendo comprobante desde administración...");
    const receiptIds = await uploadPaymentReceiptFiles({
      tenantId,
      files,
      storageFolder: `payment-receipts/${state.authUser.uid}`,
      source: "admin_panel"
    });

    setMessage("Validando comprobante...");
    const submitTransfer = httpsCallable(functions, "submitTransferPayment");
    const result = await submitTransfer({
      tenantId,
      chargeId,
      amountReported,
      receiptIds
    });

    if (result.data?.blocked) {
      const validation = result.data?.validation || {};
      setMessage(
        `${result.data.reason} Esperado: ${formatCurrency(validation.expectedAmount || currentCharge.total || 0)}. Detectado: ${formatCurrency(validation.totalDetected || 0)}.`,
        "error"
      );
      return;
    }

    closeAdminReceiptUploadModal();
    await reloadScopedAdminOperation();
    setMessage("Comprobante cargado correctamente. El pago quedó en revisión administrativa.", "success");
  } catch (error) {
    console.error(error);
    setMessage("No se pudo cargar el comprobante desde administración.", "error");
  }
}

async function uploadPaymentReceiptFiles({ tenantId, files, storageFolder, source }) {
  const receiptIds = [];

  for (const [index, file] of files.entries()) {
    const safeName = `${Date.now()}-${file.name.replace(/\s+/g, "-")}`;
    const tempReceiptRef = doc(collection(db, "paymentReceipts"));
    const storagePath = `${storageFolder}/${tempReceiptRef.id}/${safeName}`;
    const storageRef = ref(storage, storagePath);
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream"
    });
    const downloadURL = await getDownloadURL(storageRef);

    await setDoc(tempReceiptRef, {
      paymentId: null,
      tenantId,
      storagePath,
      downloadURL,
      fileName: file.name,
      fileType: file.type || "application/octet-stream",
      uploadOrder: index + 1,
      source,
      claudeExtractionStatus: "pending",
      reviewSuggestion: "pending_manual_review",
      createdAt: serverTimestamp()
    });
    receiptIds.push(tempReceiptRef.id);
  }

  return receiptIds;
}

async function handleTenantSettingsSubmit(event) {
  event.preventDefault();

  if (isAdminRole()) {
    setMessage("Esta configuración es solo para inquilinos.", "error");
    return;
  }

  const email = elements.tenantSettingsEmail.value.trim();
  const password = elements.tenantSettingsPassword.value;
  const phone = elements.tenantSettingsPhone.value.trim();

  try {
    setMessage("Guardando configuración...");

    if (email && auth.currentUser?.email !== email) {
      await updateEmail(auth.currentUser, email);
    }

    if (password) {
      await updatePassword(auth.currentUser, password);
    }

    const updateSettings = httpsCallable(functions, "updateTenantContactSettings");
    await updateSettings({ email, phone });

    elements.tenantSettingsPassword.value = "";
    setMessage("Tus datos de contacto fueron actualizados.");
  } catch (error) {
    console.error(error);
    setMessage("No se pudieron guardar tus datos. Puede que necesites volver a iniciar sesión.", "error");
  }
}

async function handleAdminSettingsSubmit(event) {
  event.preventDefault();

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede editar esta configuración.", "error");
    return;
  }

  const email = elements.adminSettingsEmail.value.trim();
  const password = elements.adminSettingsPassword.value;
  const displayName = elements.adminSettingsName.value.trim();
  const phone = elements.adminSettingsPhone.value.trim();
  const generalSettings = resolveGeneralSettings();
  const currentScope = getCurrentOwnerScope();
  const isScopedAdmin = currentScope !== "all";
  const dueDayOfMonth = Number(elements.adminGeneralDueDay.value || generalSettings.dueDayOfMonth);
  const lateFeeDailyRatePercent = Number(elements.adminGeneralLateFeeRate.value || (generalSettings.lateFeeDailyRate * 100));
  const morosoAfterDays = Number(elements.adminGeneralMorosoDays.value || generalSettings.morosoAfterDays);
  const defaultNotificationChannel = elements.adminDefaultNotificationChannel.value || generalSettings.defaultNotificationChannel;
  const autoNotifyNewCharge = Boolean(elements.adminAutoNotifyNewCharge.checked);
  const autoNotifyOverdue = Boolean(elements.adminAutoNotifyOverdue.checked);
  const defaultRentDepartamento = Number(document.querySelector("#admin-default-rent-departamento")?.value || generalSettings.defaultRents.Departamento || 0);
  const defaultRentCasa = Number(document.querySelector("#admin-default-rent-casa")?.value || generalSettings.defaultRents.Casa || 0);
  const defaultRentLocal = Number(document.querySelector("#admin-default-rent-local")?.value || generalSettings.defaultRents.Local || 0);

  try {
    setMessage("Guardando configuración del administrador...");

    if (email && auth.currentUser?.email !== email) {
      await updateEmail(auth.currentUser, email);
    }

    if (password) {
      await updatePassword(auth.currentUser, password);
    }

    await setDoc(
      doc(db, "users", state.authUser.uid),
      {
        displayName,
        email,
        phone,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    await setDoc(
      doc(db, "settings", "bankAccounts"),
      buildScopedBankAccountPayload(currentScope),
      { merge: true }
    );

    await Promise.all(buildScopedOwnerWrites(currentScope));

    if (!isScopedAdmin) {
      const updateGeneralSettings = httpsCallable(functions, "upsertGeneralSettings");
      await updateGeneralSettings({
        dueDayOfMonth,
        lateFeeDailyRate: lateFeeDailyRatePercent / 100,
        morosoAfterDays,
        reminderDaysBeforeDue: generalSettings.reminderDaysBeforeDue,
        defaultNotificationChannel,
        autoNotifyNewCharge,
        autoNotifyOverdue,
        lastRentAdjustmentPercent: Number(elements.adminRentAdjustmentPercent.value || generalSettings.lastRentAdjustmentPercent || 0),
        defaultRents: {
          Departamento: defaultRentDepartamento,
          Casa: defaultRentCasa,
          Local: defaultRentLocal
        }
      });
    }

    await writeAuditLog({
      action: "admin_settings_updated",
      entityType: "settings",
      entityId: "bankAccounts",
      summary: isScopedAdmin
        ? `Actualizó sus ajustes y la cuenta bancaria de ${normalizeOwnerLabel(currentScope)}.`
        : "Actualizó datos del administrador y cuentas bancarias.",
      metadata: {
        changedBankAccounts: true,
        changedEmail: email !== state.profile?.email,
        ownerScope: currentScope,
        dueDayOfMonth: isScopedAdmin ? null : dueDayOfMonth,
        lateFeeDailyRatePercent: isScopedAdmin ? null : lateFeeDailyRatePercent,
        morosoAfterDays: isScopedAdmin ? null : morosoAfterDays,
        defaultNotificationChannel: isScopedAdmin ? null : defaultNotificationChannel,
        autoNotifyNewCharge: isScopedAdmin ? null : autoNotifyNewCharge,
        autoNotifyOverdue: isScopedAdmin ? null : autoNotifyOverdue
      }
    });

    state.profile = {
      ...state.profile,
      displayName,
      email,
      phone
    };
    elements.adminSettingsPassword.value = "";
    await renderSignedIn();
    setActiveSection("configuración");
    setMessage(
      isScopedAdmin
        ? `Ajustes guardados para ${normalizeOwnerLabel(currentScope)}.`
        : "Configuración del administrador guardada.",
      "success"
    );
  } catch (error) {
    console.error(error);
    setMessage("No se pudo guardar la configuración. Puede que necesites volver a iniciar sesión.", "error");
  }
}

function buildScopedBankAccountPayload(currentScope) {
  const payload = {
    updatedAt: serverTimestamp(),
    updatedBy: state.authUser.uid
  };

  if (currentScope === "all" || currentScope === "enzo") {
    payload.block_1 = {
      holderName: elements.adminBankBlock1Holder.value.trim(),
      alias: elements.adminBankBlock1Alias.value.trim(),
      cbu: elements.adminBankBlock1Cbu.value.trim(),
      dni: elements.adminBankBlock1Dni.value.trim(),
      email: elements.adminBankBlock1Email.value.trim().toLowerCase(),
      phone: elements.adminBankBlock1Phone.value.trim()
    };
  }

  if (currentScope === "all" || currentScope === "ivo") {
    payload.block_2 = {
      holderName: elements.adminBankBlock2Holder.value.trim(),
      alias: elements.adminBankBlock2Alias.value.trim(),
      cbu: elements.adminBankBlock2Cbu.value.trim(),
      dni: elements.adminBankBlock2Dni.value.trim(),
      email: elements.adminBankBlock2Email.value.trim().toLowerCase(),
      phone: elements.adminBankBlock2Phone.value.trim()
    };
  }

  return payload;
}

function buildScopedOwnerWrites(currentScope) {
  const writes = [];

  if (currentScope === "all" || currentScope === "enzo") {
    writes.push(
      setDoc(
        doc(db, "owners", "owner_block_1"),
        {
          fullName: elements.adminBankBlock1Holder.value.trim(),
          dni: elements.adminBankBlock1Dni.value.trim(),
          email: elements.adminBankBlock1Email.value.trim().toLowerCase(),
          phone: elements.adminBankBlock1Phone.value.trim(),
          transferBlock: "block_1",
          alias: elements.adminBankBlock1Alias.value.trim(),
          cbu: elements.adminBankBlock1Cbu.value.trim(),
          ownerScope: "enzo",
          updatedAt: serverTimestamp()
        },
        { merge: true }
      )
    );
  }

  if (currentScope === "all" || currentScope === "ivo") {
    writes.push(
      setDoc(
        doc(db, "owners", "owner_block_2"),
        {
          fullName: elements.adminBankBlock2Holder.value.trim(),
          dni: elements.adminBankBlock2Dni.value.trim(),
          email: elements.adminBankBlock2Email.value.trim().toLowerCase(),
          phone: elements.adminBankBlock2Phone.value.trim(),
          transferBlock: "block_2",
          alias: elements.adminBankBlock2Alias.value.trim(),
          cbu: elements.adminBankBlock2Cbu.value.trim(),
          ownerScope: "ivo",
          updatedAt: serverTimestamp()
        },
        { merge: true }
      )
    );
  }

  return writes;
}

async function handleRentAdjustmentApply() {
  if (!isAdminRole()) {
    setMessage("Solo un administrador puede actualizar alquileres.", "error");
    return;
  }

  const percent = Number(elements.adminRentAdjustmentPercent.value || 0);

  if (!Number.isFinite(percent) || percent === 0) {
    setMessage("Ingresa un porcentaje distinto de cero para actualizar alquileres.", "error");
    return;
  }

  const confirmed = window.confirm(
    `Se aplicara un ajuste de ${percent}% sobre los alquileres base activos mayores a $0. Queres continuar?`
  );

  if (!confirmed) {
    setMessage("Ajuste de alquiler cancelado.");
    return;
  }

  try {
    setMessage("Actualizando alquileres activos...");
    const applyRentAdjustment = httpsCallable(functions, "applyRentAdjustment");
    const result = await applyRentAdjustment({ percent });
    await writeAuditLog({
      action: "rent_adjustment_applied",
      entityType: "settings",
      entityId: "general",
      summary: `Aplico un ajuste general de alquileres del ${percent}%.`,
      metadata: {
        percent,
        updatedTenants: result.data?.updated ?? 0
      }
    });
    setMessage(`Ajuste aplicado. Se actualizaron ${result.data?.updated ?? 0} alquileres activos.`);
  } catch (error) {
    console.error(error);
    setMessage("No se pudo aplicar la actualizacion de alquileres.", "error");
  }
}

async function handleUserAccessAction(event) {
  const saveButton = event.target.closest("[data-save-user-access]");
  const deleteButton = event.target.closest("[data-delete-user-access]");

  if (deleteButton) {
    await handleUserPermanentDeletion(deleteButton.dataset.deleteUserAccess);
    return;
  }

  if (!saveButton) {
    return;
  }

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede editar permisos.", "error");
    return;
  }

  const userId = saveButton.dataset.saveUserAccess;
  const card = saveButton.closest("[data-user-card]");
  const targetUser = state.users.find((item) => item.id === userId);

  if (!userId || !card || !targetUser) {
    setMessage("No se pudo identificar el usuario.", "error");
    return;
  }

  if (userId === state.authUser?.uid) {
    setMessage("No podes modificar tu propio rol o estado desde esta pantalla.", "error");
    return;
  }

  const role = card.querySelector("[data-user-role]")?.value || targetUser.role;
  const status = card.querySelector("[data-user-status]")?.value || targetUser.status || "active";
  const ownerScope = card.querySelector("[data-user-owner-scope]")?.value || targetUser.ownerScope || "all";

  try {
    const updateUserAuthority = httpsCallable(functions, "updateUserAuthority");
    await updateUserAuthority({
      userId,
      role,
      ownerScope: role === "superadmin" ? "all" : normalizeOwnerScope(ownerScope),
      status
    });

    setMessage("Permisos actualizados.");
  } catch (error) {
    console.error(error);
    setMessage("No se pudieron actualizar los permisos.", "error");
  }
}

async function handleMessageSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede enviar mensajes.", "error");
    return;
  }

  const tenantId = elements.messageTenantSelect.value;
  const body = elements.messageBody.value.trim();
  const channel = elements.messageChannelSelect.value || resolveGeneralSettings().defaultNotificationChannel;
  const template = elements.messageTemplateSelect.value || "general";
  const tenant = state.tenants.find((item) => item.id === tenantId);
  const relatedCharge = state.charges
    .filter((charge) => charge.tenantId === tenantId)
    .sort((left, right) => String(right.period || "").localeCompare(String(left.period || "")))[0];

  if (!tenantId || !body) {
    setMessage("Completa el inquilino y el mensaje antes de enviar.", "error");
    return;
  }

  const requiresExplicitConfirmation = ["late_fee_notice", "payment_rejected", "contract_finalized"].includes(template);
  const confirmationMessage = [
    `Destinatario: ${tenant?.fullName || "Inquilino"}`,
    `Canal: ${humanizeMessageChannel(channel)}`,
    `Plantilla: ${humanizeMessageType(template)}`,
    relatedCharge?.period ? `Período asociado: ${relatedCharge.period}` : "",
    "",
    "Mensaje final:",
    body
  ]
    .filter(Boolean)
    .join("\n");

  const confirmed = window.confirm(
    `${requiresExplicitConfirmation ? "Este mensaje es sensible y requiere confirmación.\n\n" : ""}${confirmationMessage}`
  );

  if (!confirmed) {
    setMessage("Envío cancelado.");
    return;
  }

  try {
    setMessage("Enviando mensaje...");
    const sendMessage = httpsCallable(functions, "sendGeneralMessage");
    const result = await sendMessage({ tenantId, body, channel, type: template });
    const status = result.data?.status || "queued";
    const deliveredChannel = result.data?.channel;

    await writeAuditLog({
      action: "message_sent",
      entityType: "tenant",
      entityId: tenantId,
      summary: `Envio un mensaje a ${tenant?.fullName || "un inquilino"}.`,
      metadata: {
        tenantName: tenant?.fullName || "",
        template,
        requestedChannel: channel,
        deliveredChannel: deliveredChannel || "",
        status
      }
    });

    form.reset();
    if (elements.messageTemplateSelect) {
      elements.messageTemplateSelect.value = "";
    }
    if (elements.messageChannelSelect) {
      elements.messageChannelSelect.value = resolveGeneralSettings().defaultNotificationChannel;
    }
    handleMessageTemplateChange();

    if (status === "sent") {
      setMessage(`Mensaje enviado${deliveredChannel ? ` por ${humanizeMessageChannel(deliveredChannel)}` : ""}.`);
      return;
    }

    setMessage("No se pudo enviar el mensaje. Revisá la configuración de Twilio o el historial.", "error");
  } catch (error) {
    console.error(error);
    setMessage("No se pudo enviar el mensaje desde Twilio.", "error");
  }
}

async function handleAdminUserCreateSubmit(event) {
  event.preventDefault();

  if (!isSuperadminRole()) {
    setMessage("Solo un superadmin puede crear usuarios administrativos.", "error");
    return;
  }

  const email = elements.adminUserCreateEmail.value.trim();
  const password = elements.adminUserCreatePassword.value;
  const displayName = elements.adminUserCreateDisplayName.value.trim();
  const role = elements.adminUserCreateRole.value;
  const ownerScope = elements.adminUserCreateForm?.querySelector("[name='ownerScope']")?.value || "all";

  if (!email || !password) {
    setMessage("Completa correo y contraseña para crear el usuario.", "error");
    return;
  }

  if (!["admin", "superadmin"].includes(role)) {
    setMessage("Selecciona un rol administrativo válido.", "error");
    return;
  }

  try {
    setMessage("Creando usuario administrativo...");
    const createAdministrativeUser = httpsCallable(functions, "createAdministrativeUser");
    const result = await createAdministrativeUser({
      email,
      password,
      displayName,
      role,
      ownerScope: role === "superadmin" ? "all" : normalizeOwnerScope(ownerScope)
    });

    elements.adminUserCreateForm.reset();
    elements.adminUserCreateRole.value = "superadmin";
    const ownerScopeSelect = elements.adminUserCreateForm?.querySelector("[name='ownerScope']");
    if (ownerScopeSelect) {
      ownerScopeSelect.value = "all";
      ownerScopeSelect.disabled = true;
    }
    setMessage(result.data?.message || "Usuario administrativo creado correctamente.");
  } catch (error) {
    console.error(error);
    setMessage(humanizeFunctionError(error), "error");
  }
}

function handleMessageTemplateChange() {
  const tenantId = elements.messageTenantSelect.value;
  const template = elements.messageTemplateSelect.value;
  const tenant = state.tenants.find((item) => item.id === tenantId);

  if (!template) {
    if (elements.messageTemplateHelper) {
      elements.messageTemplateHelper.textContent = "Elegí una plantilla para autocompletar el mensaje.";
    }
    return;
  }

  const message = buildMessageTemplate(template, tenant);
  elements.messageBody.value = message.body;

  if (elements.messageTemplateHelper) {
    elements.messageTemplateHelper.textContent = message.helper;
  }
}

async function handleUserPermanentDeletion(userId) {
  if (!isAdminRole()) {
    setMessage("Solo un administrador puede eliminar usuarios.", "error");
    return;
  }

  if (userId === state.authUser?.uid) {
    setMessage("No podes eliminar tu propio usuario desde esta pantalla.", "error");
    return;
  }

  const targetUser = state.users.find((item) => item.id === userId);

  if (!targetUser) {
    setMessage("No se encontro el usuario seleccionado.", "error");
    return;
  }

  const label = targetUser.displayName || targetUser.email || userId;
  const confirmation = window.prompt(
    `Esta accion elimina definitivamente el acceso de ${label}. Para confirmar, escribi ELIMINAR.`
  );

  if (confirmation !== "ELIMINAR") {
    setMessage("Eliminación de usuario cancelada.");
    return;
  }

  try {
    const deleteUserAccess = httpsCallable(functions, "deleteUserAccess");
    await deleteUserAccess({ userId });
    setMessage("Usuario eliminado definitivamente. Si tenia historial, queda conservado en cobros y pagos.");
  } catch (error) {
    console.error(error);
    setMessage(`No se pudo eliminar el usuario: ${error.message || "revisa permisos y reglas."}`, "error");
  }
}

async function handleTenantContractAction(event) {
  const welcomeButton = event.target.closest("[data-send-profile-email]");
  const paymentLinkButton = event.target.closest("[data-send-payment-link]");
  const dueReminderButton = event.target.closest("[data-send-due-reminder]");
  const uploadReceiptButton = event.target.closest("[data-admin-upload-receipt]");
  const editButton = event.target.closest("[data-edit-tenant]");
  const menuButton = event.target.closest("[data-tenant-menu]");
  const historyButton = event.target.closest("[data-view-payment-history]");
  const renewButton = event.target.closest("[data-renew-contract]");
  const finalizeButton = event.target.closest("[data-finalize-contract]");
  const removeButton = event.target.closest("[data-remove-tenant]");
  const deleteButton = event.target.closest("[data-delete-tenant]");

  if (welcomeButton) {
    const tenantId = welcomeButton.dataset.sendProfileEmail;
    const tenant = state.tenants.find((item) => item.id === tenantId);

    if (!tenantId || !tenant) {
      setMessage("No se encontro el inquilino seleccionado.", "error");
      return;
    }

    try {
      setMessage("Enviando correo de bienvenida...");
      const resendWelcome = httpsCallable(functions, "resendProfileCreatedEmail");
      await resendWelcome({ tenantId });
      setMessage(`Correo de bienvenida enviado a ${tenant.fullName}.`);
    } catch (error) {
      console.error(error);
      setMessage("No se pudo enviar el correo de bienvenida.", "error");
    }
    return;
  }

  if (paymentLinkButton || dueReminderButton) {
    const tenantId = paymentLinkButton?.dataset.sendPaymentLink || dueReminderButton?.dataset.sendDueReminder;
    const tenant = state.tenants.find((item) => item.id === tenantId);
    const type = paymentLinkButton ? "period_available" : "due_reminder";
    const actionLabel = paymentLinkButton ? "link de pago" : "recordatorio de vencimiento";

    if (!tenantId || !tenant) {
      setMessage("No se encontro el inquilino seleccionado.", "error");
      return;
    }

    try {
      setMessage(`Enviando ${actionLabel}...`);
      const sendOperationalEmail = httpsCallable(functions, "sendTenantOperationalEmail");
      await sendOperationalEmail({ tenantId, type });
      setMessage(`${actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)} enviado a ${tenant.fullName}.`);
    } catch (error) {
      console.error(error);
      setMessage(`No se pudo enviar el ${actionLabel}.`, "error");
    }
    return;
  }

  if (uploadReceiptButton) {
    await openAdminReceiptUploadModal(uploadReceiptButton.dataset.adminUploadReceipt);
    return;
  }

  if (editButton) {
    openTenantEditModal(editButton.dataset.editTenant);
    return;
  }

  if (menuButton) {
    toggleTenantMenu(menuButton.dataset.tenantMenu);
    return;
  }

  if (historyButton) {
    openHistoryModal(historyButton.dataset.viewPaymentHistory);
    return;
  }

  if (removeButton) {
    await handleTenantRemoval(removeButton.dataset.removeTenant);
    return;
  }

  if (deleteButton) {
    await handleTenantPermanentDeletion(deleteButton.dataset.deleteTenant);
    return;
  }

  if (!renewButton && !finalizeButton) {
    return;
  }

  const tenantId = renewButton?.dataset.renewContract || finalizeButton?.dataset.finalizeContract;
  const action = renewButton ? "renew" : "finalize";
  openContractModal(tenantId, action);
}

function toggleTenantMenu(tenantId) {
  document.querySelectorAll("[data-tenant-menu-panel]").forEach((panel) => {
    if (panel.dataset.tenantMenuPanel === tenantId) {
      panel.classList.toggle("hidden");
      return;
    }

    panel.classList.add("hidden");
  });
}

function openContractModal(tenantId, action) {
  const tenant = state.tenants.find((item) => item.id === tenantId);
  if (!tenant) {
    setMessage("No se encontro el inquilino seleccionado.", "error");
    return;
  }

  elements.contractTenantId.value = tenantId;
  elements.contractAction.value = action;
  elements.contractEffectiveDate.value = tenant.contractEndDate || "";
  elements.contractModalTitle.textContent = action === "renew" ? "Renovar contrato" : "Finalizar contrato";
  elements.contractModalCopy.textContent = action === "renew"
    ? `Defini hasta que fecha se renovara el contrato de ${tenant.fullName}.`
    : `Defini la fecha en la que finalizara el contrato de ${tenant.fullName}.`;
  elements.contractModal.classList.remove("hidden");
}

function openTenantEditModal(tenantId) {
  const tenant = state.tenants.find((item) => item.id === tenantId);

  if (!tenant) {
    setMessage("No se encontro el inquilino seleccionado.", "error");
    return;
  }

  const property = state.properties.find((item) => item.id === tenant.propertyId) || null;
  if (!elements.tenantEditModal || !elements.tenantEditForm) {
    setMessage("No se pudo abrir el editor del inquilino.", "error");
    return;
  }

  renderTenantEditPropertyOptions(tenantId, tenant.propertyId);
  elements.tenantEditId.value = tenant.id;
  elements.tenantEditFullName.value = tenant.fullName || "";
  elements.tenantEditDni.value = tenant.dni || "";
  elements.tenantEditPhone.value = tenant.phone || "";
  elements.tenantEditEmail.value = tenant.email || "";
  elements.tenantEditPropertyId.value = tenant.propertyId || "";
  elements.tenantEditBaseRent.value = String(resolveDisplayedBaseRent(tenant, property, getPropertyCurrentCharge(tenant.id)));
  const tenantEditDueDay = document.querySelector("#tenant-edit-due-day");
  const tenantEditFrequency = document.querySelector("#tenant-edit-rent-frequency");
  const tenantEditNextPeriod = document.querySelector("#tenant-edit-next-adjustment-period");
  if (tenantEditDueDay) {
    tenantEditDueDay.value = tenant.dueDayOfMonth ? String(tenant.dueDayOfMonth) : "";
  }
  if (tenantEditFrequency) {
    tenantEditFrequency.value = tenant.rentSchedule?.frequency || tenant.rentUpdateConfig?.frequency || "quarterly";
  }
  if (tenantEditNextPeriod) {
    tenantEditNextPeriod.value = tenant.rentSchedule?.nextAdjustmentPeriod || tenant.rentUpdateConfig?.nextAdjustmentPeriod || "";
  }
  elements.tenantEditContractStartDate.value = tenant.contractStartDate || "";
  elements.tenantEditContractEndDate.value = tenant.contractEndDate || "";
  elements.tenantEditModalTitle.textContent = `Editar inquilino: ${tenant.fullName || "Sin nombre"}`;
  elements.tenantEditModal.classList.remove("hidden");
}

async function openAdminReceiptUploadModal(tenantId) {
  const tenant = state.tenants.find((item) => item.id === tenantId);

  if (!tenant || !elements.adminReceiptUploadModal || !elements.adminReceiptUploadForm) {
    setMessage("No se pudo abrir la carga manual del comprobante.", "error");
    return;
  }

  let openCharges = getTenantReceiptableCharges(tenantId);
  if (!openCharges.length) {
    await reloadScopedAdminOperation();
    openCharges = getTenantReceiptableCharges(tenantId);
  }
  if (!openCharges.length) {
    setMessage("Ese inquilino no tiene cobros abiertos disponibles para cargar comprobantes.", "error");
    return;
  }

  setMessage(`Preparando carga manual para ${tenant.fullName || "el inquilino"}...`);
  elements.adminReceiptUploadTenantId.value = tenantId;
  elements.adminReceiptUploadChargeId.innerHTML = openCharges
    .map((charge) => `<option value="${charge.id}">${formatPeriodLabel(charge.period)} · ${formatCurrency(charge.total || 0)} · ${humanizeChargeStatus(charge.status)}</option>`)
    .join("");
  elements.adminReceiptUploadFiles.value = "";
  if (elements.adminReceiptUploadCopy) {
    elements.adminReceiptUploadCopy.textContent = `Subí el comprobante recibido por ${tenant.fullName || "el inquilino"} para dejar el cobro seleccionado en revisión administrativa.`;
  }
  syncAdminReceiptUploadChargeSelection();
  elements.adminReceiptUploadModal.classList.remove("hidden");
}

function closeTenantEditModal() {
  elements.tenantEditModal.classList.add("hidden");
  elements.tenantEditForm.reset();
}

function closeAdminReceiptUploadModal() {
  elements.adminReceiptUploadModal?.classList.add("hidden");
  elements.adminReceiptUploadForm?.reset();
}

function handleAdminReceiptUploadModalClick(event) {
  if (event.target?.id === "admin-receipt-upload-modal") {
    closeAdminReceiptUploadModal();
  }
}

function syncAdminReceiptUploadChargeSelection() {
  const chargeId = elements.adminReceiptUploadChargeId?.value;
  const charge = state.charges.find((item) => item.id === chargeId);
  if (!charge || !elements.adminReceiptUploadAmount) {
    return;
  }

  elements.adminReceiptUploadAmount.value = String(charge.total || 0);
}

function openPaymentInstructionsModal() {
  elements.paymentInstructionsModal.classList.remove("hidden");
}

function closePaymentInstructionsModal() {
  elements.paymentInstructionsModal.classList.add("hidden");
}

function closeContractModal() {
  elements.contractModal.classList.add("hidden");
  elements.contractForm.reset();
}

function openHistoryModal(tenantId) {
  const tenant = state.tenants.find((item) => item.id === tenantId);
  const tenantPayments = state.payments
    .filter((payment) => payment.tenantId === tenantId)
    .sort((a, b) => sortByCreatedAtDesc(a, b));

  elements.historyModalTitle.textContent = `Historial de pagos de ${tenant?.fullName || "inquilino"}`;
  elements.historyModalList.innerHTML = tenantPayments.length
    ? tenantPayments
        .map((payment) => {
          const charge = state.charges.find((item) => item.id === payment.chargeId);
          const paymentReceipts = state.receipts.filter((receipt) => receipt.paymentId === payment.id);
          const rentReceipt = state.rentReceipts.find((receipt) => receipt.paymentId === payment.id);
          const approvalDate = resolveDisplayDate(payment.approvedAt ?? payment.providerConfirmedAt ?? payment.paidAt);
          return `
            <article class="entity-card">
              <div>
                <h4>${formatCurrency(payment.amountReported ?? payment.amountConfirmed ?? 0)}</h4>
                <p>${humanizePaymentMethod(payment.method)} - ${humanizePaymentStatus(payment.status)}</p>
                <p>Período: ${charge?.period || "Sin período"}</p>
                ${approvalDate ? `<p>Fecha de pago: ${formatDateTime(approvalDate)}</p>` : ""}
                <p>${payment.reviewNotes || "Sin observaciones."}</p>
                <p>Comprobante del inquilino: ${paymentReceipts.length ? `${paymentReceipts.length} archivo(s)` : "No enviado"}</p>
                ${
                  paymentReceipts.length
                    ? `<div class="entity-card-actions">
                        ${paymentReceipts
                          .map((receipt, index) => `<a class="entity-link" href="${receipt.downloadURL}" target="_blank" rel="noreferrer">Ver comprobante ${index + 1}</a>`)
                          .join("")}
                      </div>`
                    : ""
                }
                ${
                  rentReceipt
                    ? `<div class="receipt-status-block">
                        <p><strong>Recibo oficial:</strong> ${rentReceipt.receiptNumber || "Emitido"}</p>
                        <p>${humanizeRentReceiptStatus(rentReceipt.status)}${rentReceipt.sentAt ? ` · email ${formatDateTime(rentReceipt.sentAt)}` : ""}</p>
                        <p>Fecha de emisión: ${formatDateTime(rentReceipt.issuedAt)}</p>
                        <p>Código de verificación: ${rentReceipt.verificationCode || "sin código"}</p>
                        <div class="entity-card-actions">
                          ${rentReceipt.pdfUrl ? `<button class="ghost-action small-button" type="button" data-view-rent-receipt="${rentReceipt.pdfUrl}">Ver recibo</button>` : ""}
                          <button class="ghost-action small-button" type="button" data-send-rent-receipt="${payment.id}" ${rentReceipt.emailStatus === "sent" ? 'data-regenerate-receipt="true"' : ""}>Reenviar recibo</button>
                        </div>
                      </div>`
                    : `<p>Recibo oficial: todavía no emitido.</p>`
                }
              </div>
            </article>
          `;
        })
        .join("")
    : buildEmptyState("Todavía no hay movimientos para este inquilino.");

  elements.historyModal.classList.remove("hidden");
}

function closeHistoryModal() {
  elements.historyModal.classList.add("hidden");
}

async function handleHistoryModalAction(event) {
  const resendButton = event.target.closest("[data-send-rent-receipt]");
  const viewButton = event.target.closest("[data-view-rent-receipt]");

  if (viewButton) {
    openReceiptViewer(viewButton.dataset.viewRentReceipt);
    return;
  }

  if (resendButton) {
    await handleRentReceiptSend(
      resendButton.dataset.sendRentReceipt,
      resendButton.dataset.regenerateReceipt === "true"
    );
  }
}

async function handlePrivateShellClick(event) {
  const propertyToggleButton = event.target.closest("[data-toggle-property-details]");
  const tenantToggleButton = event.target.closest("[data-toggle-tenant-details]");
  const adminReceiptUploadButton = event.target.closest("[data-admin-upload-receipt]");
  const reviewChargePaymentButton = event.target.closest("[data-review-charge-payment]");
  const sectionButton = event.target.closest("[data-open-section]");
  const tenantTabButton = event.target.closest("[data-tenant-doc-tab]");
  const comprobanteTabButton = event.target.closest("[data-comprobante-tab]");
  const rentReceiptsDownloadButton = event.target.closest("[data-download-rent-receipts]");
  const receiptButton = event.target.closest("[data-view-rent-receipt]");
  if (propertyToggleButton) {
    const propertyId = propertyToggleButton.dataset.togglePropertyDetails;
    const isExpanded = Boolean(state.propertyCardExpanded[propertyId]);
    state.propertyCardExpanded = isExpanded ? {} : { [propertyId]: true };
    renderProperties();
    return;
  }

  if (tenantToggleButton) {
    const tenantId = tenantToggleButton.dataset.toggleTenantDetails;
    const isExpanded = Boolean(state.tenantCardExpanded[tenantId]);
    state.tenantCardExpanded = isExpanded ? {} : { [tenantId]: true };
    renderTenants();
    return;
  }

  if (adminReceiptUploadButton) {
    openAdminReceiptUploadModal(adminReceiptUploadButton.dataset.adminUploadReceipt);
    return;
  }

  if (reviewChargePaymentButton) {
    const chargeId = reviewChargePaymentButton.dataset.reviewChargePayment;
    const charge = state.charges.find((item) => item.id === chargeId);
    const tenant = state.tenants.find((item) => item.id === charge?.tenantId);
    state.comprobanteFilters = {
      ...state.comprobanteFilters,
      tab: "pending",
      period: String(charge?.period || ""),
      propertyId: String(charge?.propertyId || ""),
      tenantSearch: tenant?.fullName || "",
      status: "reported"
    };
    setActiveSection("comprobantes");
    renderAdminPaymentReview();
    return;
  }

  if (sectionButton) {
    setActiveSection(sectionButton.dataset.openSection);
    return;
  }

  if (comprobanteTabButton) {
    state.comprobanteFilters = {
      ...state.comprobanteFilters,
      tab: comprobanteTabButton.dataset.comprobanteTab || "all"
    };
    renderAdminPaymentReview();
    return;
  }

  if (tenantTabButton) {
    state.tenantDocumentTab = tenantTabButton.dataset.tenantDocTab || "receipts";
    renderTenantPortal();
    return;
  }

  if (rentReceiptsDownloadButton) {
    const mode = rentReceiptsDownloadButton.dataset.downloadRentReceipts || "selected";
    await handleRentReceiptDownloadRequest(mode, rentReceiptsDownloadButton.dataset.period || "");
    return;
  }

  if (receiptButton) {
    openReceiptViewer(receiptButton.dataset.viewRentReceipt);
  }
}

function handlePrivateShellChange(event) {
  const target = event.target;
  if (target?.id === "admin-user-create-role") {
    const ownerScopeSelect = elements.adminUserCreateForm?.querySelector("[name='ownerScope']");
    if (ownerScopeSelect) {
      ownerScopeSelect.disabled = target.value === "superadmin";
      if (target.value === "superadmin") {
        ownerScopeSelect.value = "all";
      }
    }
    return;
  }

  if (target?.matches?.("[data-user-role]")) {
    const card = target.closest("[data-user-card]");
    const ownerScopeSelect = card?.querySelector("[data-user-owner-scope]");
    if (ownerScopeSelect) {
      ownerScopeSelect.disabled = target.value === "superadmin";
      if (target.value === "superadmin") {
        ownerScopeSelect.value = "all";
      }
    }
  }

  if (target?.matches?.("[data-rent-receipt-select-all]")) {
    toggleRentReceiptPeriodSelection(target.dataset.period || "", target.checked);
    renderChargePeriods();
    return;
  }

  if (target?.matches?.("[data-rent-receipt-select]")) {
    toggleRentReceiptSelection(
      target.dataset.period || "",
      target.dataset.rentReceiptSelect || "",
      target.checked
    );
    renderChargePeriods();
    return;
  }

  if (!target?.id?.startsWith?.("comprobante-filter-")) {
    return;
  }

  state.comprobanteFilters = {
    ...state.comprobanteFilters,
    period: document.querySelector("#comprobante-filter-period")?.value || "",
    propertyId: document.querySelector("#comprobante-filter-property")?.value || "",
    status: document.querySelector("#comprobante-filter-status")?.value || "all",
    tenantSearch: document.querySelector("#comprobante-filter-tenant")?.value || "",
    owner: document.querySelector("#comprobante-filter-owner")?.value || "all"
  };
  renderAdminPaymentReview();
}

function handleReceiptViewerModalClick(event) {
  if (
    event.target?.id === "receipt-viewer-modal"
    || event.target?.closest?.("[data-close-receipt-viewer]")
  ) {
    closeReceiptViewer();
  }
}

function openReceiptViewer(pdfUrl) {
  const modal = document.querySelector("#receipt-viewer-modal");
  const frame = document.querySelector("#receipt-viewer-frame");
  if (!modal || !frame || !pdfUrl) {
    return;
  }

  frame.setAttribute("src", pdfUrl);
  modal.classList.remove("hidden");
}

function closeReceiptViewer() {
  const modal = document.querySelector("#receipt-viewer-modal");
  const frame = document.querySelector("#receipt-viewer-frame");
  if (frame) {
    frame.setAttribute("src", "about:blank");
  }
  modal?.classList.add("hidden");
}

async function handleContractSubmit(event) {
  event.preventDefault();

  try {
    const updateContract = httpsCallable(functions, "updateTenantContract");
    await updateContract({
      tenantId: elements.contractTenantId.value,
      action: elements.contractAction.value,
      effectiveDate: elements.contractEffectiveDate.value
    });
    const tenant = state.tenants.find((item) => item.id === elements.contractTenantId.value);
    await writeAuditLog({
      action: elements.contractAction.value === "renew" ? "contract_renewed" : "contract_finalized",
      entityType: "tenant",
      entityId: elements.contractTenantId.value,
      summary:
        elements.contractAction.value === "renew"
          ? `Renovo el contrato de ${tenant?.fullName || "un inquilino"} hasta ${elements.contractEffectiveDate.value}.`
          : `Configuró la finalización del contrato de ${tenant?.fullName || "un inquilino"} para ${elements.contractEffectiveDate.value}.`,
      metadata: {
        tenantName: tenant?.fullName || "",
        effectiveDate: elements.contractEffectiveDate.value
      }
    });
    closeContractModal();
    setMessage("Contrato actualizado y notificacion preparada.");
  } catch (error) {
    console.error(error);
    setMessage("No se pudo actualizar el contrato.", "error");
  }
}

async function handleTenantRemoval(tenantId) {
  if (!isAdminRole()) {
    setMessage("Solo un administrador puede eliminar inquilinos.", "error");
    return;
  }

  const tenant = state.tenants.find((item) => item.id === tenantId);

  if (!tenant) {
    setMessage("No se encontro el inquilino seleccionado.", "error");
    return;
  }

  const confirmed = window.confirm(
    `Vas a dar de baja a ${tenant.fullName}. Su historial quedara guardado, pero dejara de figurar como inquilino activo.`
  );

  if (!confirmed) {
    return;
  }

  try {
    const deactivateTenant = httpsCallable(functions, "deactivateTenant");
    await deactivateTenant({ tenantId });
    setMessage("Inquilino dado de baja. El historial se conserva y el acceso quedó desactivado.");
  } catch (error) {
    console.error(error);
    setMessage("No se pudo eliminar el inquilino.", "error");
  }
}

async function handleTenantPermanentDeletion(tenantId) {
  if (!isAdminRole()) {
    setMessage("Solo un administrador puede eliminar definitivamente un inquilino.", "error");
    return;
  }

  const tenant = state.tenants.find((item) => item.id === tenantId);

  if (!tenant) {
    setMessage("No se encontro el inquilino seleccionado.", "error");
    return;
  }

  const confirmation = window.prompt(
    `Esta accion elimina definitivamente el perfil de ${tenant.fullName}. Para confirmar, escribi el nombre exacto del inquilino.`
  );

  if (confirmation !== tenant.fullName) {
    setMessage("Eliminación definitiva cancelada.");
    return;
  }

  try {
    const deleteTenantProfile = httpsCallable(functions, "deleteTenantProfile");
    await deleteTenantProfile({ tenantId });

    setMessage("Inquilino eliminado definitivamente. Los movimientos historicos se conservaron como respaldo.");
  } catch (error) {
    console.error(error);
    setMessage(`No se pudo eliminar definitivamente el inquilino: ${error.message || "revisa permisos y reglas."}`, "error");
  }
}

async function handlePaymentReviewAction(event) {
  const approveButton = event.target.closest("[data-approve-payment]");
  const rejectButton = event.target.closest("[data-reject-payment]");
  const analyzeButton = event.target.closest("[data-analyze-receipt]");
  const sendReceiptButton = event.target.closest("[data-send-rent-receipt]");

  if (analyzeButton) {
    await handleReceiptAnalysis(analyzeButton.dataset.analyzeReceipt);
    return;
  }

  if (sendReceiptButton) {
    await handleRentReceiptSend(sendReceiptButton.dataset.sendRentReceipt, sendReceiptButton.dataset.regenerateReceipt === "true");
    return;
  }

  if (!approveButton && !rejectButton) {
    return;
  }

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede revisar pagos.");
    return;
  }

  const paymentId = approveButton?.dataset.approvePayment || rejectButton?.dataset.rejectPayment;
  const chargeId = approveButton?.dataset.chargeId || rejectButton?.dataset.chargeId;

  if (!paymentId || !chargeId) {
    setMessage("No se pudo identificar el pago a revisar.");
    return;
  }

  const payment = state.payments.find((item) => item.id === paymentId);
  if (!payment) {
    setMessage("No se encontró el pago seleccionado.");
    return;
  }

  if (approveButton) {
    const charge = state.charges.find((item) => item.id === chargeId);
    const tenant = state.tenants.find((item) => item.id === payment.tenantId);
    const property = state.properties.find((item) => item.id === charge?.propertyId);
    const ownerLabel = normalizeOwnerLabel(resolvePropertyOwnerScope(property));
    const paymentReceipts = state.receipts.filter((receipt) => receipt.paymentId === payment.id);
    const confirmed = window.confirm(
      [
        "Vas a aprobar este pago y generar el recibo oficial.",
        "",
        `Inquilino: ${tenant?.fullName || "Sin nombre"}`,
        `Unidad: ${property?.name || "Sin unidad"}`,
        `Período: ${charge?.period || "Sin período"}`,
        `Monto: ${formatCurrency(payment.amountReported ?? payment.amountConfirmed ?? 0)}`,
        `Fecha de envío: ${formatDateTime(resolveDisplayDate(payment.createdAt || payment.reportedAt))}`,
        `Medio de pago: ${humanizePaymentMethod(payment.method)}`,
        `Locador: ${ownerLabel}`,
        `Archivo adjunto: ${paymentReceipts.length ? paymentReceipts[0].fileName || "Comprobante cargado" : "Sin archivo"}`,
        "",
        "¿Confirmás la aprobación?"
      ].join("\n")
    );

    if (!confirmed) {
      setMessage("Aprobación cancelada.");
      return;
    }
    await approvePayment(payment, chargeId);
    return;
  }

  if (rejectButton) {
    const reason = window.prompt("Motivo del rechazo:", "Monto incorrecto o comprobante no valido");
    if (reason === null) {
      return;
    }
    await rejectPayment(payment, chargeId, reason.trim());
  }
}

async function handleRentReceiptSend(paymentId, regenerate = false) {
  if (!paymentId) {
    setMessage("No se pudo identificar el pago para emitir el comprobante.", "error");
    return;
  }

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede emitir comprobantes.", "error");
    return;
  }

  try {
    setMessage(regenerate ? "Regenerando y enviando comprobante..." : "Generando y enviando comprobante...");
    const sendPaymentReceipt = httpsCallable(functions, "sendPaymentReceipt");
    const result = await sendPaymentReceipt({ paymentId, regenerate });
    const payload = result.data || {};
    if (!payload.ok) {
      setMessage(payload.error || "No se pudo emitir el comprobante.", "error");
      return;
    }

    setMessage(
      payload.resent
        ? `Comprobante ${payload.receiptNumber || ""} reenviado correctamente.`
        : `Comprobante ${payload.receiptNumber || ""} generado y enviado correctamente.`,
      "success"
    );
  } catch (error) {
    console.error(error);
    setMessage(humanizeFunctionError(error) || "No se pudo emitir el comprobante.", "error");
  }
}

async function handleUtilityBillAction(event) {
  const analyzeButton = event.target.closest("[data-analyze-bill]");
  const applyButton = event.target.closest("[data-apply-bill]");

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede analizar facturas.", "error");
    return;
  }

  if (applyButton) {
    const billId = applyButton.dataset.applyBill;
    const bill = state.utilityBills.find((item) => item.id === billId);

    if (!bill) {
      setMessage("No se encontro la factura seleccionada.", "error");
      return;
    }

    if (typeof bill.amount !== "number" || Number.isNaN(Number(bill.amount))) {
      setMessage("Primero analizá la factura para detectar el monto.", "error");
      return;
    }

    if (!canAutoApplyBillToProperty(bill)) {
      setMessage("Esta factura grupal necesita una distribucion manual antes de aplicarse.", "error");
      return;
    }

    try {
      await updateDoc(doc(db, "utilityBills", billId), {
        appliedToCharges: true,
        updatedAt: serverTimestamp()
      });
      setMessage("La factura quedó aplicada al proximo calculo.");
    } catch (error) {
      console.error(error);
      setMessage("No se pudo aplicar la factura.", "error");
    }
    return;
  }

  if (!analyzeButton) {
    return;
  }

  try {
    setMessage("Analizando factura...");
    const extractBill = httpsCallable(functions, "extractUtilityBillData");
    const result = await extractBill({ billId: analyzeButton.dataset.analyzeBill });
    const summary = result.data?.result?.summary || "La lectura de la factura termino correctamente.";
    setMessage(`Analisis listo: ${summary}`);
  } catch (error) {
    console.error(error);
    setMessage("No se pudo analizar la factura.", "error");
  }
}

async function handleChargeAction(event) {
  const createLinkButton = event.target.closest("[data-create-charge-link]");
  if (!createLinkButton) {
    return;
  }

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede generar links de pago.", "error");
    return;
  }

  try {
    const createToken = httpsCallable(functions, "createPaymentAccessToken");
    const result = await createToken({
      chargeId: createLinkButton.dataset.createChargeLink,
      expiresInHours: 72
    });
    const token = result.data?.token;

    if (!token) {
      setMessage("No se pudo generar el link.", "error");
      return;
    }

    const link = `${window.location.origin}${window.location.pathname}?token=${token}`;
    await navigator.clipboard.writeText(link);
    await writeAuditLog({
      action: "payment_link_created",
      entityType: "charge",
      entityId: createLinkButton.dataset.createChargeLink,
      summary: "Generó un link único de pago.",
      metadata: {
        expiresInHours: 72
      }
    });
    setMessage("Link único generado y copiado al portapapeles.");
  } catch (error) {
    console.error(error);
    setMessage("No se pudo generar el link único.", "error");
  }
}

async function handleMercadoPagoAction(event) {
  const payButton = event.target.closest("[data-pay-card]");
  if (!payButton) {
    return;
  }

  const chargeId = payButton.dataset.payCard;
  const tenantId = state.profile?.tenantId;

  if (!chargeId || !tenantId) {
    setMessage("No se pudo identificar el cobro para Mercado Pago.");
    return;
  }

  try {
    setMessage("Preparando checkout de Mercado Pago...");
    const createCheckout = httpsCallable(functions, "createMercadoPagoCheckout");
    const result = await createCheckout({ chargeId, tenantId });
    const checkoutUrl = result.data?.checkoutUrl;

    if (!checkoutUrl) {
      setMessage("Mercado Pago no devolvio una URL de pago.");
      return;
    }

    window.location.href = checkoutUrl;
  } catch (error) {
    console.error(error);
    setMessage("Mercado Pago todavía no esta listo. Falta desplegar Functions o configurar credenciales.", "error");
  }
}

function handleTenantChargeActions(event) {
  handleTransferInfoToggle(event);
  handleMercadoPagoAction(event);
}

function handleTransferInfoToggle(event) {
  const transferButton = event.target.closest("[data-transfer-toggle]");
  const instructionsButton = event.target.closest("[data-payment-instructions-toggle]");

  if (transferButton) {
    event.currentTarget
      .querySelector("[data-transfer-details]")
      ?.classList.toggle("hidden");
    return;
  }

  if (instructionsButton) {
    openPaymentInstructionsModal();
  }
}

async function approvePayment(payment, chargeId) {
  const approveTransferPayment = httpsCallable(functions, "approveTransferPayment");
  const result = await approveTransferPayment({
    paymentId: payment.id,
    chargeId,
    amountConfirmed: Number(payment.amountReported ?? 0)
  });

  await writeAuditLog({
    action: "payment_approved",
    entityType: "payment",
    entityId: payment.id,
    summary: `Aprobo un pago por ${formatCurrency(payment.amountReported ?? 0)}.`,
    metadata: {
      chargeId,
      tenantId: payment.tenantId || "",
      amount: Number(payment.amountReported ?? 0)
    }
  });

  const receipt = result.data?.receipt || null;

  if (receipt?.ok === false) {
    setMessage(`Pago aprobado, pero el recibo no pudo enviarse: ${receipt.error || "Faltan datos del locador o del inquilino."}`, "warning");
    return;
  }

  setMessage(receipt?.resent ? "Pago aprobado y recibo reenviado." : "Pago aprobado y recibo emitido.", "success");
}

async function rejectPayment(payment, chargeId, reason) {
  await updateDoc(doc(db, "payments", payment.id), {
    status: "rejected",
    reviewNotes: reason || "Pago rechazado por administración.",
    rejectedAt: serverTimestamp(),
    rejectedBy: state.authUser.uid,
    updatedAt: serverTimestamp()
  });

  await updateDoc(doc(db, "charges", chargeId), {
    status: "pending",
    updatedAt: serverTimestamp()
  });

  await writeAuditLog({
    action: "payment_rejected",
    entityType: "payment",
    entityId: payment.id,
    summary: `Rechazo un pago por ${formatCurrency(payment.amountReported ?? 0)}.`,
    metadata: {
      chargeId,
      tenantId: payment.tenantId || "",
      amount: Number(payment.amountReported ?? 0),
      reason: reason || ""
    }
  });

  setMessage("Pago rechazado. El cobro volvio a pendiente.");
}

async function handleReceiptAnalysis(receiptId) {
  if (!receiptId) {
    setMessage("No se pudo identificar el comprobante.");
    return;
  }

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede analizar comprobantes.");
    return;
  }

  try {
    setMessage("Analizando comprobante...");
    const extractReceipt = httpsCallable(functions, "extractPaymentReceiptData");
    const result = await extractReceipt({ receiptId });
    const summary = result.data?.result?.summary || "Claude termino el analisis.";
    setMessage(`Analisis listo: ${summary}`);
  } catch (error) {
    console.error(error);
    setMessage("No se pudo analizar el comprobante. Revisa la clave de Claude y el deploy de Functions.", "error");
  }
}

function renderPropertySelect() {
  if (!elements.tenantPropertySelect) {
    return;
  }

  const scopedProperties = getScopedProperties();

  if (!scopedProperties.length) {
    elements.tenantPropertySelect.innerHTML = `<option value="">Primero crea una propiedad</option>`;
    renderUtilityBillGroupOptions();
    return;
  }

  const options = scopedProperties
    .map(
      (property) =>
        `<option value="${property.id}">${property.name} - ${property.unitCode || "sin código"}</option>`
    )
    .join("");

  elements.tenantPropertySelect.innerHTML = options;
  renderUtilityBillGroupOptions();
}

  function renderTenantEditPropertyOptions(tenantId, currentPropertyId) {
  if (!elements.tenantEditPropertyId) {
    return;
  }

  const scopedProperties = getScopedProperties();
  const occupiedByOthers = new Set(
    getScopedTenants()
      .filter((tenant) => tenant.id !== tenantId && !["inactive", "deleted"].includes(String(tenant.status || "active")))
      .map((tenant) => String(tenant.propertyId || ""))
      .filter(Boolean)
  );

  const options = scopedProperties
    .filter((property) => property.id === currentPropertyId || !occupiedByOthers.has(property.id))
    .map((property) => `<option value="${property.id}">${property.name} - ${property.unitCode || "sin código"}</option>`)
    .join("");

    elements.tenantEditPropertyId.innerHTML = options || `<option value="">Sin propiedades disponibles</option>`;
  }

  function formatPeriodLabel(period) {
    if (!period) {
      return "Sin período";
    }

    const [year, month] = String(period).split("-");
    const date = new Date(Number(year), Math.max(Number(month || 1) - 1, 0), 1);
    if (Number.isNaN(date.getTime())) {
      return String(period);
    }

    return new Intl.DateTimeFormat("es-AR", {
      month: "long",
      year: "numeric"
    }).format(date);
  }

  function buildOwnerSnapshot(ownerScope) {
    const properties = state.properties.filter((property) => resolvePropertyOwnerScope(property) === ownerScope);
    const propertyIds = new Set(properties.map((property) => property.id));
    const tenants = state.tenants.filter((tenant) => propertyIds.has(tenant.propertyId));
    const tenantIds = new Set(tenants.map((tenant) => tenant.id));
    const charges = state.charges.filter((charge) => propertyIds.has(charge.propertyId));
    const chargeIds = new Set(charges.map((charge) => charge.id));
    const payments = state.payments.filter((payment) => chargeIds.has(payment.chargeId) || tenantIds.has(payment.tenantId));
    const rentReceipts = state.rentReceipts.filter((receipt) => tenantIds.has(receipt.tenantId));

    return { properties, tenants, charges, payments, rentReceipts };
  }

  function countPendingPaymentReviews(payments) {
    return payments.filter((payment) => {
      if (isMercadoPagoCheckoutPlaceholder(payment)) {
        return false;
      }

      return ["reported", "in_review", "pending"].includes(String(payment.status || ""));
    }).length;
  }

  function countDelinquentCharges(charges) {
    const generalSettings = resolveGeneralSettings();
    return charges.filter((charge) => {
      const overdueDays = Number(charge.overdueDays ?? 0);
      return charge.status === "overdue" || overdueDays >= generalSettings.morosoAfterDays;
    }).length;
  }

  function sumChargeTotals(charges, statuses) {
    return charges
      .filter((charge) => statuses.includes(String(charge.status || "")))
      .reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);
  }

  function countReceiptsForPeriod(rentReceipts, currentPeriod) {
    return rentReceipts.filter(
      (receipt) => String(receipt.period || "") === currentPeriod
    ).length;
  }

  function updateSummarySectionChrome() {
    const chargesLabel = document.querySelector("#charges-title")?.previousElementSibling;
    const chargesTitle = document.querySelector("#charges-title");
    const reviewLabel = document.querySelector("#review-title")?.previousElementSibling;
    const reviewTitle = document.querySelector("#review-title");
    const reportSections = Array.from(document.querySelectorAll('.summary-report-grid.view-section[data-section="resumen"] .surface'));

    if (isSuperadminRole()) {
      if (chargesLabel) chargesLabel.textContent = "Seguimiento global";
      if (chargesTitle) chargesTitle.textContent = "Próximos vencimientos y revisión";
      if (reviewLabel) reviewLabel.textContent = "Comparativa";
      if (reviewTitle) reviewTitle.textContent = "Operación por locador";
      if (reportSections[0]) {
        reportSections[0].querySelector(".section-label").textContent = "Visión consolidada";
        reportSections[0].querySelector("h3").textContent = "Indicadores globales";
      }
      if (reportSections[1]) {
        reportSections[1].querySelector(".section-label").textContent = "Bloques";
        reportSections[1].querySelector("h3").textContent = "Enzo vs Ivo";
      }
      if (reportSections[2]) {
        reportSections[2].querySelector(".section-label").textContent = "Deuda";
        reportSections[2].querySelector("h3").textContent = "Inquilinos a seguir";
      }
      if (reportSections[3]) {
        reportSections[3].querySelector(".section-label").textContent = "Actividad global";
        reportSections[3].querySelector("h3").textContent = "Últimos pagos confirmados";
      }
      return;
    }

    const ownerLabel = normalizeOwnerLabel(getCurrentOwnerScope());
    if (chargesLabel) chargesLabel.textContent = "Agenda operativa";
    if (chargesTitle) chargesTitle.textContent = "Vencimientos y cobros a seguir";
    if (reviewLabel) reviewLabel.textContent = "Prioridades";
    if (reviewTitle) reviewTitle.textContent = `Lectura rápida de ${ownerLabel}`;
    if (reportSections[0]) {
      reportSections[0].querySelector(".section-label").textContent = "Estado financiero";
      reportSections[0].querySelector("h3").textContent = `Totales de ${ownerLabel}`;
    }
    if (reportSections[1]) {
      reportSections[1].querySelector(".section-label").textContent = "Métodos";
      reportSections[1].querySelector("h3").textContent = "Transferencia y tarjeta";
    }
    if (reportSections[2]) {
      reportSections[2].querySelector(".section-label").textContent = "Seguimiento";
      reportSections[2].querySelector("h3").textContent = "Cobros vencidos";
    }
    if (reportSections[3]) {
      reportSections[3].querySelector(".section-label").textContent = "Actividad reciente";
      reportSections[3].querySelector("h3").textContent = "Últimos pagos";
    }
  }
  
  function renderSummary() {
    const scopedProperties = getScopedProperties();
    const scopedTenants = getScopedTenants();
    const scopedCharges = getScopedCharges();
    const scopedPayments = getScopedPayments();
    const scopedRentReceipts = getScopedRentReceipts();
    const summaryPeriod = resolveSummaryPeriod(scopedCharges);
    const summaryCharges = scopedCharges.filter((charge) => String(charge.period || "") === summaryPeriod);
    const reportCharges = summaryCharges.length ? summaryCharges : scopedCharges;
    const totalCharges = reportCharges.reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);
    const totalCollected = reportCharges
      .filter((charge) => charge.status === "paid")
      .reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);
    const pendingCharges = scopedCharges.filter((charge) => charge.status !== "paid");
    const overdueCharges = scopedCharges.filter((charge) => charge.status === "overdue");
    const pendingReviews = countPendingPaymentReviews(scopedPayments);
    const receiptCount = countReceiptsForPeriod(scopedRentReceipts, summaryPeriod);
    const progress = totalCharges > 0 ? Math.min((totalCollected / totalCharges) * 100, 100) : 0;
    const currentScopeLabel = normalizeOwnerLabel(getCurrentOwnerScope());
    const ownerSnapshots = {
      enzo: buildOwnerSnapshot("enzo"),
      ivo: buildOwnerSnapshot("ivo")
    };

    elements.summaryHeadline.textContent = isSuperadminRole()
      ? `${pendingReviews} comprobantes pendientes y ${overdueCharges.length} cobros vencidos en toda La Casona.`
      : `${pendingReviews} comprobantes pendientes y ${overdueCharges.length} cobros vencidos en ${currentScopeLabel}.`;
    elements.summarySubtitle.textContent = isSuperadminRole()
      ? `${scopedProperties.length} unidades, ${scopedTenants.length} inquilinos y visión consolidada para supervisar la operación de Enzo e Ivo.`
      : `${scopedProperties.length} unidades y ${scopedTenants.length} inquilinos dentro de la operación de ${currentScopeLabel}.`;
    elements.collectedTotal.textContent = formatCurrency(totalCollected);
    elements.collectionProgress.style.width = `${Math.max(progress, 6)}%`;
    elements.collectionFootnote.textContent = isSuperadminRole()
      ? `${Math.round(progress)}% del total de ${formatPeriodLabel(summaryPeriod)} ya figura como cobrado. ${receiptCount} recibos emitidos este período.`
      : `${Math.round(progress)}% del total de ${formatPeriodLabel(summaryPeriod)} ya figura como cobrado para ${currentScopeLabel}. ${receiptCount} recibos emitidos.`;

    elements.urgentCharges.innerHTML = pendingCharges.length
      ? pendingCharges
          .slice(0, 4)
          .map((charge) => {
            const tenant = scopedTenants.find((item) => item.id === charge.tenantId);
            const property = scopedProperties.find((item) => item.id === charge.propertyId);
            const statusClass = charge.status === "overdue" ? "danger" : "warning";
            const ownerScope = resolvePropertyOwnerScope(property);

            return `
              <article class="table-row">
                <div>
                  <strong>${property?.name || "Unidad"} - ${tenant?.fullName || "Sin inquilino"}</strong>
                  <p>${formatPeriodLabel(charge.period)}${isSuperadminRole() ? ` · ${normalizeOwnerLabel(ownerScope)}` : ""}</p>
                </div>
                <div>
                  <strong>${formatCurrency(charge.total ?? 0)}</strong>
                  <p>Vence ${formatDate(charge.dueDate)}</p>
                </div>
              <span class="status ${statusClass}">${humanizeChargeStatus(charge.status)}</span>
            </article>
            `;
          })
          .join("")
      : buildEmptyState("Todavía no hay cobros activos para revisar.");

    if (isSuperadminRole()) {
      elements.summaryMetrics.innerHTML = ["enzo", "ivo"]
        .map((ownerScope) => {
          const snapshot = ownerSnapshots[ownerScope];
          const periodCharges = snapshot.charges.filter((charge) => String(charge.period || "") === summaryPeriod);
          const ownerCollected = sumChargeTotals(periodCharges, ["paid"]);
          const ownerPending = sumChargeTotals(periodCharges, ["pending", "overdue", "in_review"]);
          const ownerReviews = countPendingPaymentReviews(snapshot.payments);
          const ownerDelinquent = countDelinquentCharges(snapshot.charges);
          return `
            <article class="review-item owner-comparison-card">
              <div>
                <p class="section-label">Operación ${normalizeOwnerLabel(ownerScope)}</p>
                <strong>${formatCurrency(ownerCollected)} cobrados</strong>
                <p>${snapshot.properties.length} unidades · ${snapshot.tenants.length} inquilinos · ${formatCurrency(ownerPending)} pendientes</p>
              </div>
              <div class="owner-comparison-meta">
                <span class="status ${ownerReviews ? "warning" : "neutral"}">${ownerReviews} comprobantes</span>
                <span class="status ${ownerDelinquent ? "danger" : "success"}">${ownerDelinquent} con deuda</span>
              </div>
            </article>
          `;
        })
        .join("");
    } else {
      const nextDueDate = pendingCharges
        .map((charge) => charge.dueDate)
        .filter(Boolean)
        .sort()[0];
      const activeReceipts = scopedRentReceipts.filter((receipt) => ["sent", "resent"].includes(String(receipt.status || ""))).length;
      elements.summaryMetrics.innerHTML = [
        {
          title: `${pendingCharges.length} cobros abiertos`,
          copy: `Seguimiento activo dentro de ${currentScopeLabel}.`,
          badge: "Operación"
        },
        {
          title: `${pendingReviews} comprobantes por revisar`,
          copy: "Pagos reportados esperando validación administrativa.",
          badge: pendingReviews ? "Revisión" : "Sin revisión pendiente",
          tone: pendingReviews ? "warning" : "neutral"
        },
        {
          title: nextDueDate ? `Próximo vencimiento ${formatDate(nextDueDate)}` : "Sin vencimientos próximos",
          copy: "Usa Cobros y Comunicación para actuar rápido.",
          badge: "Agenda"
        },
        {
          title: `${activeReceipts} recibos emitidos`,
          copy: `Recibos oficiales asociados a ${formatPeriodLabel(summaryPeriod)}.`,
          badge: "Recibos"
        }
      ]
        .map(
          (metric) => `
            <article class="review-item">
              <div>
                <strong>${metric.title}</strong>
                <p>${metric.copy}</p>
              </div>
              <span class="status ${metric.tone || "neutral"}">${metric.badge}</span>
            </article>
          `
        )
        .join("");
    }

    updateSummarySectionChrome();
    renderSummaryReports(reportCharges, summaryPeriod, scopedProperties, scopedTenants);
    renderAdminScopeDiagnostics();
  }
  
  function renderSummaryReports(reportCharges, currentPeriod, scopedProperties = getScopedProperties(), scopedTenants = getScopedTenants()) {
    const generalSettings = resolveGeneralSettings();
  const scopedCharges = getScopedCharges();
  const total = reportCharges.reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);
  const collected = reportCharges
    .filter((charge) => charge.status === "paid")
    .reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);
  const pending = reportCharges
    .filter((charge) => charge.status === "pending")
    .reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);
  const overdue = reportCharges
    .filter((charge) => charge.status === "overdue")
    .reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);
  const inReview = reportCharges
    .filter((charge) => charge.status === "in_review")
    .reduce((sum, charge) => sum + Number(charge.total ?? 0), 0);
    const scopedPayments = getScopedPayments();
    const scopedRentReceipts = getScopedRentReceipts();
    const transferTotal = scopedPayments
      .filter((payment) => payment.method === "transfer")
      .reduce((sum, payment) => sum + Number(payment.amountConfirmed ?? payment.amountReported ?? 0), 0);
    const cardTotal = scopedPayments
      .filter((payment) => payment.method === "mercado_pago")
      .reduce((sum, payment) => sum + Number(payment.amountConfirmed ?? payment.amountReported ?? 0), 0);
    const delinquentCharges = scopedCharges.filter((charge) => charge.status === "overdue");
    const recentPayments = [...scopedPayments].sort((a, b) => sortByCreatedAtDesc(a, b)).slice(0, 5);
    const pendingReviews = countPendingPaymentReviews(scopedPayments);
    const delinquentCount = countDelinquentCharges(scopedCharges);
    const receiptCount = countReceiptsForPeriod(scopedRentReceipts, currentPeriod);
    const currentScopeLabel = normalizeOwnerLabel(getCurrentOwnerScope());

    if (isSuperadminRole()) {
      const snapshots = {
        enzo: buildOwnerSnapshot("enzo"),
        ivo: buildOwnerSnapshot("ivo")
      };
      elements.summaryFinancialReport.innerHTML = [
        ["Cobrado general", collected, "Toda La Casona"],
        ["Pendiente general", pending + overdue + inReview, formatPeriodLabel(currentPeriod)],
        ["Comprobantes pendientes", pendingReviews, "Revisión"],
        ["Inquilinos con deuda", delinquentCount, "Seguimiento"],
        ["Recibos emitidos", receiptCount, formatPeriodLabel(currentPeriod)]
      ]
        .map(
          ([label, value, footnote]) => `
            <article class="summary-mini-card">
              <span>${label}</span>
              <strong>${
                typeof value === "number"
                && !["Comprobantes pendientes", "Inquilinos con deuda", "Recibos emitidos"].includes(label)
                  ? formatCurrency(value)
                  : value
              }</strong>
              <p>${footnote}</p>
            </article>
          `
        )
        .join("");

      elements.summaryPaymentMethods.innerHTML = ["enzo", "ivo"]
        .map((ownerScope) => {
          const snapshot = snapshots[ownerScope];
          const periodCharges = snapshot.charges.filter((charge) => String(charge.period || "") === currentPeriod);
          const ownerCollected = sumChargeTotals(periodCharges, ["paid"]);
          const ownerPending = sumChargeTotals(periodCharges, ["pending", "overdue", "in_review"]);
          const ownerReviews = countPendingPaymentReviews(snapshot.payments);
          return `
            <article class="review-item owner-comparison-card">
              <div>
                <strong>${normalizeOwnerLabel(ownerScope)}</strong>
                <p>${snapshot.properties.length} unidades · ${snapshot.tenants.length} inquilinos</p>
                <p>Cobrado ${formatCurrency(ownerCollected)} · Pendiente ${formatCurrency(ownerPending)}</p>
              </div>
              <span class="status ${ownerReviews ? "warning" : "neutral"}">${ownerReviews} por revisar</span>
            </article>
          `;
        })
        .join("");
    } else {
      elements.summaryFinancialReport.innerHTML = [
        ["Total generado", total, formatPeriodLabel(currentPeriod)],
        ["Cobrado", collected, currentScopeLabel],
        ["Pendiente", pending, "Sin pagar"],
        ["Vencido", overdue, "A seguir"],
        ["En revisión", inReview, "Pagos reportados"]
      ]
        .map(
          ([label, value, footnote]) => `
            <article class="summary-mini-card">
              <span>${label}</span>
              <strong>${formatCurrency(value)}</strong>
              <p>${footnote}</p>
            </article>
          `
        )
        .join("");

      elements.summaryPaymentMethods.innerHTML = `
        <article class="review-item">
          <div>
            <strong>${formatCurrency(transferTotal)}</strong>
            <p>Pagos por transferencia registrados en ${currentScopeLabel}.</p>
          </div>
          <span class="status success">Transferencia</span>
        </article>
        <article class="review-item">
          <div>
            <strong>${formatCurrency(cardTotal)}</strong>
            <p>Pagos por tarjeta registrados por Mercado Pago.</p>
          </div>
          <span class="status neutral">Tarjeta</span>
        </article>
      `;
    }

    elements.summaryDelinquency.innerHTML = delinquentCharges.length
      ? delinquentCharges
          .slice(0, 6)
          .map((charge) => {
            const tenant = scopedTenants.find((item) => item.id === charge.tenantId);
            const property = scopedProperties.find((item) => item.id === charge.propertyId);
            const ownerScope = resolvePropertyOwnerScope(property);
            return `
              <article class="table-row">
                <div>
                  <strong>${tenant?.fullName || "Sin inquilino"}</strong>
                  <p>${property?.name || "Unidad"} - ${formatPeriodLabel(charge.period)}${isSuperadminRole() ? ` · ${normalizeOwnerLabel(ownerScope)}` : ""}</p>
                </div>
                <div>
                  <strong>${formatCurrency(charge.total ?? 0)}</strong>
                  <p>Vencio ${formatDate(charge.dueDate)}${charge.overdueDays ? ` - ${charge.overdueDays} dias` : ""}</p>
                </div>
              <span class="status ${Number(charge.overdueDays ?? 0) >= generalSettings.morosoAfterDays ? "danger" : "warning"}">
                ${Number(charge.overdueDays ?? 0) >= generalSettings.morosoAfterDays ? "Moroso" : "Vencido"}
              </span>
            </article>
          `;
        })
        .join("")
    : buildEmptyState("No hay inquilinos morosos en el período.");

  elements.summaryRecentPayments.innerHTML = recentPayments.length
    ? recentPayments
          .map((payment) => {
            const tenant = scopedTenants.find((item) => item.id === payment.tenantId);
            const charge = scopedProperties.length ? getScopedCharges().find((item) => item.id === payment.chargeId) : null;
            const property = charge ? scopedProperties.find((item) => item.id === charge.propertyId) : null;
            const ownerScope = resolvePropertyOwnerScope(property);
            return `
              <article class="table-row">
                <div>
                  <strong>${tenant?.fullName || "Inquilino"}</strong>
                  <p>${humanizePaymentMethod(payment.method)} - ${humanizePaymentStatus(payment.status)}${isSuperadminRole() ? ` · ${normalizeOwnerLabel(ownerScope)}` : ""}</p>
                </div>
                <div>
                  <strong>${formatCurrency(payment.amountConfirmed ?? payment.amountReported ?? 0)}</strong>
                  <p>${formatDateTime(resolveDisplayDate(payment.createdAt))}</p>
              </div>
            </article>
          `;
        })
        .join("")
    : buildEmptyState("Todavía no hay pagos recientes.");
}

function renderCheckoutFeedback() {
  if (!state.checkoutStatus) {
    return;
  }

  const messages = {
    success: "Mercado Pago informo que el pago fue aprobado. El webhook puede tardar unos segundos en reflejarlo.",
    failure: "Mercado Pago informo que el pago no se completo. Puedes intentarlo de nuevo.",
    pending: "Mercado Pago informo que el pago quedó pendiente. Cuando se confirme, el sistema actualizara el cobro."
  };

  setMessage(messages[state.checkoutStatus] || "Se recibio una respuesta de Mercado Pago.");
  state.checkoutStatus = null;
}

  function renderProperties() {
    const scopedProperties = getScopedProperties();
    const scopedTenants = getScopedTenants();
    const summaryHost = document.querySelector("#property-suite-summary");
    const occupiedCount = scopedProperties.filter((property) =>
      scopedTenants.some((tenant) => tenant.propertyId === property.id && !["inactive", "deleted"].includes(String(tenant.status || "active")))
    ).length;
    const availableCount = Math.max(scopedProperties.length - occupiedCount, 0);
    const currentCharges = scopedTenants
      .map((tenant) => getPropertyCurrentCharge(tenant.id))
      .filter(Boolean);
    const pendingReviewCount = currentCharges.filter((charge) => ["in_review", "pending"].includes(String(charge.status || ""))).length;
    const delinquentCount = currentCharges.filter((charge) => {
      const overdueDays = Number(charge.overdueDays ?? 0);
      return charge.status === "overdue" || overdueDays >= resolveGeneralSettings().morosoAfterDays;
    }).length;

    if (summaryHost) {
      summaryHost.innerHTML = [
        ["Unidades ocupadas", occupiedCount, "Con inquilino activo"],
        ["Unidades disponibles", availableCount, "Listas para asignar"],
        ["Cobros en revisión", pendingReviewCount, "Pagos reportados"],
        ["Cobros con deuda", delinquentCount, "Seguimiento prioritario"]
      ]
        .map(([label, value, footnote]) => `
          <article class="summary-mini-card">
            <span>${label}</span>
            <strong>${value}</strong>
            <p>${footnote}</p>
          </article>
        `)
        .join("");
    }

    elements.propertyList.innerHTML = scopedProperties.length
        ? scopedProperties
          .map((property) => {
            const expanded = Boolean(state.propertyCardExpanded[property.id]);
            const detailPanelId = `property-detail-${property.id}`;
            const tenant = scopedTenants.find(
              (item) => item.propertyId === property.id && !["inactive", "deleted"].includes(String(item.status || "active"))
            );
          const occupancyStatus = getPropertyOccupancyStatus(property, tenant);
          const ownerScope = resolvePropertyOwnerScope(property);
          const ownerLabel = normalizeOwnerLabel(ownerScope);
          const tenantRentalStatus = tenant ? getTenantRentalStatus(tenant.id) : null;
          const tenantContractStatus = tenant ? getTenantContractStatus(tenant) : null;
          const punctuality = tenant ? getTenantPunctuality(tenant.id) : "Puntualidad: sin historial";
          const currentCharge = tenant ? getPropertyCurrentCharge(tenant.id) : null;
          const openCharges = tenant ? getOpenChargesForTenant(tenant.id) : [];
          const pendingReviewPayment = currentCharge ? getPendingReviewPaymentForCharge(currentCharge.id) : null;
          const chargeVisualStatus = currentCharge ? getChargeVisualStatus(currentCharge) : null;
          const baseRentAmount = resolveDisplayedBaseRent(tenant, property, currentCharge);
          const totalAmount = Number(currentCharge?.total ?? currentCharge?.subtotal ?? baseRentAmount ?? 0);
          const contractCopy = tenant ? describeTenantContract(tenant) : "Todavía no hay un contrato activo en esta unidad.";
          const referenceRent = getDefaultRentForUnitType(property?.unitType);
          const vacantNote = property.status === "maintenance"
            ? "La unidad está marcada en mantenimiento."
            : "Esta unidad todavía no tiene un inquilino activo asignado.";

            return `
              <article class="entity-card property-entity-card">
                <div class="property-card-layout">
                  <div class="property-card-main">
                    <div class="property-card-head property-card-summary">
                      <div>
                        <p class="section-label">${property.unitType || "Unidad"}</p>
                        <h4 class="property-card-title">${property.name}</h4>
                        <p class="property-card-subline">Código ${property.unitCode || "sin definir"} · ${humanizeTransferBlock(property.transferBlock, property.unitCode)}</p>
                      </div>
                      <div class="property-card-head-side">
                        <span class="status neutral">${ownerLabel}</span>
                          <button
                            class="ghost-action subtle-action small-button property-toggle-button"
                            type="button"
                            data-toggle-property-details="${property.id}"
                            aria-expanded="${expanded ? "true" : "false"}"
                            aria-controls="${detailPanelId}"
                          >
                          ${expanded ? "Ocultar detalle" : "Ver detalle"}
                        </button>
                      </div>
                    </div>
                    <div class="tenant-admin-meta property-status-meta">
                      <span class="status ${occupancyStatus.className}">${occupancyStatus.label}</span>
                      ${
                        tenantRentalStatus
                        ? `<span class="status ${tenantRentalStatus.className}">${tenantRentalStatus.label}</span>`
                        : ""
                    }
                    ${
                      tenantContractStatus
                        ? `<span class="status ${tenantContractStatus.className}">${tenantContractStatus.label}</span>`
                        : ""
                      }
                      ${tenant ? `<span class="status neutral">${punctuality}</span>` : ""}
                    </div>
                      <div id="${detailPanelId}" class="property-detail-panel ${expanded ? "" : "hidden"}">
                        ${
                          tenant
                            ? `
                              <div class="property-detail-top">
                                <div class="property-tenant-spotlight">
                                  <p class="property-tenant-label">Inquilino actual</p>
                                  <h5>${tenant.fullName}</h5>
                                  <p class="property-contact-line">${tenant.phone || "Sin teléfono"} · ${tenant.email || "Sin email"}</p>
                                </div>
                                <div class="entity-card-actions property-card-actions property-detail-actions">
                                  <div class="property-action-columns">
                                    <div class="property-action-column">
                                      <button class="ghost-action subtle-action small-button" type="button" data-edit-tenant="${tenant.id}">
                                        Editar inquilino
                                      </button>
                                      <button class="ghost-action subtle-action small-button" type="button" data-view-payment-history="${tenant.id}">
                                        Ver historial de pagos
                                      </button>
                                    </div>
                                    <div class="property-action-column">
                                      <button class="ghost-action subtle-action small-button" type="button" data-open-section="cobros">
                                        Ver cobros
                                      </button>
                                      <button class="ghost-action subtle-action small-button" type="button" data-open-section="comprobantes">
                                        Ver comprobantes
                                      </button>
                                    </div>
                                    <div class="property-action-column property-action-column-contract">
                                      <div class="tenant-menu property-action-menu">
                                        <button class="ghost-action contract-action small-button tenant-menu-trigger" type="button" data-tenant-menu="${tenant.id}">
                                          Contrato
                                        </button>
                                        <div class="tenant-menu-panel hidden" data-tenant-menu-panel="${tenant.id}">
                                          <button class="ghost-action small-button" type="button" data-renew-contract="${tenant.id}">Renovar contrato</button>
                                          <button class="ghost-action small-button" type="button" data-finalize-contract="${tenant.id}">Finalizar contrato</button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div class="property-meta-grid">
                                <div class="property-meta-item">
                                  <span>Alquiler base</span>
                                  <strong>${formatCurrency(baseRentAmount)}</strong>
                                </div>
                              <div class="property-meta-item">
                                <span>Estado del cobro</span>
                                <strong>${chargeVisualStatus?.label || "Pendiente"}</strong>
                              </div>
                              <div class="property-meta-item">
                                <span>Cobros abiertos</span>
                                <strong>${openCharges.length || 0}</strong>
                              </div>
                              <div class="property-meta-item">
                                <span>Total actual</span>
                                <strong>${currentCharge ? formatCurrency(totalAmount) : "Sin importe activo"}</strong>
                              </div>
                              <div class="property-meta-item">
                                <span>Contrato</span>
                                  <strong>${contractCopy}</strong>
                                </div>
                              <div class="property-meta-item">
                                <span>Vencimiento</span>
                                <strong>${describeTenantDueDay(tenant)}</strong>
                              </div>
                              <div class="property-meta-item">
                                <span>Próximo ajuste</span>
                                <strong>${describeTenantRentSchedule(tenant)}</strong>
                              </div>
                              </div>
                              ${
                                pendingReviewPayment
                                  ? `<div class="entity-card-actions property-card-actions">
                                      <button class="primary-action small-button" type="button" data-review-charge-payment="${currentCharge.id}">
                                        Revisar comprobante
                                      </button>
                                    </div>`
                                  : ""
                              }
                              <p class="property-detail-note">Desde esta unidad podés entrar al historial de pagos, revisar comprobantes y gestionar contrato sin cambiar de contexto.</p>
                            `
                          : `
                            <div class="property-empty-tenant">
                              <p class="property-tenant-label">Unidad disponible</p>
                              <p>${vacantNote}</p>
                              <p>${referenceRent > 0 ? `Valor actual de referencia: ${formatCurrency(referenceRent)}.` : "Todavía no hay un valor de alquiler de referencia configurado."}</p>
                            </div>
                              <p class="property-detail-note">Cuando asignes un inquilino, esta ficha mostrará contrato, puntualidad y el cobro vigente desde la misma unidad.</p>
                              <div class="entity-card-actions property-card-actions">
                                <div class="property-action-columns property-action-columns-single">
                                  <button class="ghost-action subtle-action small-button" type="button" data-open-section="inquilinos">
                                    Asignar o revisar inquilinos
                                  </button>
                                  <button class="ghost-action subtle-action small-button" type="button" data-open-section="cobros">
                                    Ver cobros
                                </button>
                              </div>
                            </div>
                          `
                      }
                    </div>
                  </div>
                </div>
              </article>
            `;
        })
        .join("")
    : buildEmptyState("Todavía no hay unidades cargadas para este alcance.");

  renderAdminScopeDiagnostics();
}

function renderAdminScopeDiagnostics() {
    document.querySelectorAll("[data-admin-diagnostics]").forEach((node) => node.remove());

    const shouldShowDiagnostics = new URLSearchParams(window.location.search).get("debugScope") === "1";
    if (!shouldShowDiagnostics) {
      return;
    }

    if (!isAdminRole() || isSuperadminRole()) {
      return;
  }

  const diagnostics = state.adminDiagnostics;
  const hosts = [
    document.querySelector('.view-section[data-section="resumen"] .section-head'),
    document.querySelector('.view-section[data-section="propiedades"] .section-head')
  ].filter(Boolean);

  hosts.forEach((host) => {
    const banner = document.createElement("div");
    banner.dataset.adminDiagnostics = "true";
    banner.className = "owner-scope-note";
    const frontendScope = normalizeOwnerLabel(getCurrentOwnerScope());
    const backendScope = diagnostics?.backendScope ? normalizeOwnerLabel(diagnostics.backendScope) : "sin respuesta";
    const counts = diagnostics?.counts || {};
    const sourceLabel = diagnostics?.source || "sin diagnóstico";
    const errorText = diagnostics?.error ? `<br><strong>Error:</strong> ${diagnostics.error}` : "";
    const propertySummary = diagnostics?.propertySummary;
    const summaryText = propertySummary
      ? `<br>Total propiedades: ${propertySummary.total ?? 0} · Enzo: ${propertySummary.enzo ?? 0} · Ivo: ${propertySummary.ivo ?? 0}`
      : "";
    const sampleText = Array.isArray(diagnostics?.propertySamples) && diagnostics.propertySamples.length
      ? `<br><strong>Muestras:</strong><br>${diagnostics.propertySamples
          .map((sample) => {
            const rawBits = [
              sample.ownerScope ? `ownerScope=${sample.ownerScope}` : "",
              sample.ownerId ? `ownerId=${sample.ownerId}` : "",
              sample.transferBlock ? `transferBlock=${sample.transferBlock}` : "",
              sample.unitCode ? `unitCode=${sample.unitCode}` : "",
              sample.sortOrder ? `sortOrder=${sample.sortOrder}` : ""
            ].filter(Boolean).join(" · ");
            return `${sample.name} => ${normalizeOwnerLabel(sample.resolvedScope)} (${sample.inferenceReason})${rawBits ? ` [${rawBits}]` : ""}`;
          })
          .join("<br>")}`
      : "";
    banner.innerHTML = `
        <strong>Diagnóstico de alcance</strong><br>
        Frontend: ${frontendScope} · Backend: ${backendScope} · Fuente: ${sourceLabel}<br>
        Unidades: ${counts.properties ?? 0} · Inquilinos: ${counts.tenants ?? 0} · Cobros: ${counts.charges ?? 0} · Pagos: ${counts.payments ?? 0}
        ${summaryText}
        ${sampleText}
        ${errorText}
      `;
    host.insertAdjacentElement("afterend", banner);
  });
}

function renderTenants() {
    const visibleTenants = getScopedTenants().filter(
      (tenant) => !["inactive", "deleted"].includes(String(tenant.status || "active"))
    ).sort((left, right) => {
      const leftProperty = getScopedProperties().find((item) => item.id === left.propertyId);
      const rightProperty = getScopedProperties().find((item) => item.id === right.propertyId);
      return comparePropertiesByDisplayOrder(leftProperty, rightProperty)
        || String(left.fullName || "").localeCompare(String(right.fullName || ""), "es", { sensitivity: "base" });
    });
    const scopedProperties = getScopedProperties();
    const summaryHost = document.querySelector("#tenant-suite-summary");
    if (summaryHost) {
      const activeCount = visibleTenants.length;
      const upToDateCount = visibleTenants.filter((tenant) => getTenantRentalStatus(tenant.id).className === "success").length;
      const attentionCount = visibleTenants.filter((tenant) => getTenantRentalStatus(tenant.id).className !== "success").length;
      const contractReviewCount = visibleTenants.filter((tenant) => getTenantContractStatus(tenant).className === "warning").length;
      summaryHost.innerHTML = [
        {
          label: "Inquilinos activos",
          value: String(activeCount),
          footnote: activeCount ? "Cuentas visibles en este alcance." : "Todavía no hay inquilinos cargados."
        },
        {
          label: "Al día",
          value: String(upToDateCount),
          footnote: upToDateCount ? "Sin deuda ni revisión pendiente." : "No hay cuentas totalmente regularizadas."
        },
        {
          label: "Con seguimiento",
          value: String(attentionCount),
          footnote: attentionCount ? "Incluye pendientes, vencidos o morosos." : "Sin alertas activas por ahora."
        },
        {
          label: "Contratos a revisar",
          value: String(contractReviewCount),
          footnote: contractReviewCount ? "Conviene revisar renovaciones o cierres." : "No hay contratos por cerrar todavía."
        }
      ].map((item) => `
        <article class="summary-card">
          <span>${item.label}</span>
          <strong>${item.value}</strong>
          <small>${item.footnote}</small>
        </article>
      `).join("");
    }

  elements.tenantList.innerHTML = visibleTenants.length
      ? visibleTenants
          .map((tenant) => {
            const expanded = Boolean(state.tenantCardExpanded[tenant.id]);
            const detailPanelId = `tenant-detail-${tenant.id}`;
            const property = scopedProperties.find((item) => item.id === tenant.propertyId);
            const displayedBaseRent = resolveDisplayedBaseRent(tenant, property, getPropertyCurrentCharge(tenant.id));
            const rentalStatus = getTenantRentalStatus(tenant.id);
            const contractStatus = getTenantContractStatus(tenant);
            const punctuality = getTenantPunctuality(tenant.id);
            return `
              <article class="entity-card tenant-entity-card">
                <div class="tenant-card-layout">
                  <div class="tenant-card-main">
                    <div class="tenant-card-head">
                      <div>
                        <h4 class="tenant-card-title">${tenant.fullName}</h4>
                        <p class="tenant-property-line">${property?.name || "Sin propiedad"} · ${formatCurrency(displayedBaseRent)}</p>
                      </div>
                      <button
                        class="ghost-action subtle-action small-button tenant-toggle-button"
                        type="button"
                        data-toggle-tenant-details="${tenant.id}"
                        aria-expanded="${expanded ? "true" : "false"}"
                        aria-controls="${detailPanelId}"
                      >
                        ${expanded ? "Ocultar detalle" : "Ver detalle"}
                      </button>
                    </div>
                    <div class="tenant-admin-meta">
                      <span class="status ${rentalStatus.className}">${rentalStatus.label}</span>
                      <span class="status ${contractStatus.className}">${contractStatus.label}</span>
                      <span class="status neutral">${punctuality}</span>
                    </div>
                    <div id="${detailPanelId}" class="tenant-detail-panel ${expanded ? "" : "hidden"}">
                      <div class="tenant-detail-grid">
                        <div class="tenant-detail-item">
                          <span>Contacto</span>
                          <strong>${tenant.phone || "Sin teléfono"} · ${tenant.email || "Sin email"}</strong>
                        </div>
                        <div class="tenant-detail-item">
                          <span>Invitación</span>
                          <strong>${humanizeInvitationStatus(tenant.invitationStatus)}</strong>
                        </div>
                        <div class="tenant-detail-item">
                          <span>Contrato</span>
                          <strong>${describeTenantContract(tenant)}</strong>
                        </div>
                        <div class="tenant-detail-item">
                          <span>Vencimiento</span>
                          <strong>${describeTenantDueDay(tenant)}</strong>
                        </div>
            <div class="tenant-detail-item">
              <span>Alquiler base</span>
              <strong>${formatCurrency(displayedBaseRent)}</strong>
            </div>
            <div class="tenant-detail-item">
              <span>Próximo ajuste</span>
              <strong>${describeTenantRentSchedule(tenant)}</strong>
            </div>
          </div>
          <p class="tenant-detail-note">Desde esta ficha podés editar el inquilino, revisar su historial y gestionar el contrato cuando haga falta.</p>
          <div class="entity-card-actions tenant-card-actions">
            <div class="tenant-primary-actions">
              <button class="ghost-action subtle-action small-button" type="button" data-send-profile-email="${tenant.id}">
                Enviar bienvenida
              </button>
              <button class="ghost-action subtle-action small-button" type="button" data-send-payment-link="${tenant.id}">
                Enviar link de pago
              </button>
              <button class="ghost-action subtle-action small-button" type="button" data-send-due-reminder="${tenant.id}">
                Recordatorio de vencimiento
              </button>
              <button class="ghost-action subtle-action small-button" type="button" data-admin-upload-receipt="${tenant.id}">
                Cargar comprobante
              </button>
              <button class="ghost-action subtle-action small-button" type="button" data-edit-tenant="${tenant.id}">
                Editar inquilino
              </button>
                          <button class="ghost-action subtle-action small-button" type="button" data-view-payment-history="${tenant.id}">
                            Ver historial de pagos
                          </button>
                          <div class="tenant-menu">
                            <button class="ghost-action contract-action small-button tenant-menu-trigger" type="button" data-tenant-menu="${tenant.id}">Contrato</button>
                            <div class="tenant-menu-panel hidden" data-tenant-menu-panel="${tenant.id}">
                              <button class="ghost-action small-button" type="button" data-renew-contract="${tenant.id}">Renovar contrato</button>
                              <button class="ghost-action small-button" type="button" data-finalize-contract="${tenant.id}">Finalizar contrato</button>
                            </div>
                          </div>
                        </div>
                        <div class="tenant-danger-actions">
                          <button class="ghost-action danger-action small-button" type="button" data-remove-tenant="${tenant.id}">
                            Eliminar inquilino
                          </button>
                          ${
                            isAdminRole()
                              ? `<button class="ghost-action hard-danger-action small-button" type="button" data-delete-tenant="${tenant.id}">
                                  Eliminar definitivamente
                                </button>`
                              : ""
                          }
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            `;
        })
        .join("")
    : buildEmptyState("Todavía no hay inquilinos cargados para este alcance.");
}

function renderCharges() {
  ensureChargesSectionExperience();
  ensureChargePeriodSection();
  const scopedCharges = getScopedCharges();
  const scopedTenants = getScopedTenants();
  const scopedProperties = getScopedProperties();
  elements.chargeList.innerHTML = scopedCharges.length
    ? scopedCharges
        .map((charge) => {
          const tenant = scopedTenants.find((item) => item.id === charge.tenantId);
          const property = scopedProperties.find((item) => item.id === charge.propertyId);
          const visualStatus = getChargeVisualStatus(charge);
          const pendingReviewPayment = getPendingReviewPaymentForCharge(charge.id);
          const cardId = `charge-card-${charge.id}`;

          return `
            <article class="entity-card charge-card charge-card-collapsible">
              <button
                class="collapsible-trigger charge-card-trigger"
                type="button"
                data-collapse-toggle="${cardId}"
                aria-expanded="false"
                aria-controls="${cardId}"
              >
                <span class="charge-card-trigger-copy">
                  <strong>${property?.name || "Unidad"} - ${tenant?.fullName || "Sin inquilino"}</strong>
                  <small>${formatPeriodLabel(charge.period)} · Vence ${formatDate(charge.dueDate)}</small>
                </span>
                <span class="charge-card-trigger-side">
                  <span class="status ${visualStatus.className}">${visualStatus.label}</span>
                  <span class="collapsible-indicator" aria-hidden="true">+</span>
                </span>
              </button>
              <div id="${cardId}" class="collapsible-content hidden">
                <div class="charge-card-body">
                  <div class="charge-main">
                    <p class="section-label">${charge.period}</p>
                    <h4>${property?.name || "Unidad"} - ${tenant?.fullName || "Sin inquilino"}</h4>
                    <p>Vence ${formatDate(charge.dueDate)}</p>
                    <div class="charge-tags">
                      <span class="status ${visualStatus.className}">${visualStatus.label}</span>
                      <span class="status neutral">${charge.overdueDays ? `${charge.overdueDays} dias de atraso` : "Sin atraso"}</span>
                    </div>
                    <div class="charge-breakdown">
                      <div class="charge-breakdown-row">
                        <span>Subtotal</span>
                        <strong>${formatCurrency(charge.subtotal ?? 0)}</strong>
                      </div>
                      <div class="charge-breakdown-row ${Number(charge.lateFeeAmount ?? 0) > 0 ? "late-fee-row" : ""}">
                        <span>Mora acumulada</span>
                        <strong>${formatCurrency(charge.lateFeeAmount ?? 0)}</strong>
                      </div>
                      <div class="charge-breakdown-row total-row">
                        <span>Total actual</span>
                        <strong>${formatCurrency(charge.total ?? 0)}</strong>
                      </div>
                    </div>
                  </div>
                  <div class="charge-meta">
                    <strong>${formatCurrency(charge.total ?? 0)}</strong>
                    <p>${visualStatus.helpText}</p>
                    ${
                      pendingReviewPayment
                        ? `<button class="primary-action small-button" type="button" data-review-charge-payment="${charge.id}">
                            Revisar comprobante
                          </button>`
                        : ""
                    }
                    <button class="ghost-action small-button" type="button" data-create-charge-link="${charge.id}">
                      Generar link único
                    </button>
                  </div>
                </div>
              </div>
            </article>
          `;
        })
        .join("")
      : buildEmptyState("Todavía no hay cobros generados para este alcance.");

  bindCollapsibleTriggers(elements.chargeList);
  renderChargePeriods();
}

function ensureChargePeriodSection() {
  const chargesSection = document.querySelector('.view-section[data-section="cobros"][data-admin-only="true"]');
  const periodsPanel = document.querySelector("#charges-periods-panel");
  if (!elements.chargeList || !chargesSection) {
    return;
  }

  chargesSection
    .querySelectorAll(".section-head.compact, #admin-payment-review")
    .forEach((node) => node.remove());

  const parent = periodsPanel || chargesSection;
  if (!parent) {
    return;
  }

  let host = parent.querySelector("#charge-period-receipts");
  if (!host) {
    const wrapper = document.createElement("div");
    wrapper.className = "charge-period-section";
    wrapper.innerHTML = `<div id="charge-period-receipts" class="entity-list"></div>`;
    parent.appendChild(wrapper);
    host = wrapper.querySelector("#charge-period-receipts");
  }

  elements.chargePeriodReceipts = host;
}

function renderChargePeriods() {
  if (!elements.chargePeriodReceipts) {
    return;
  }

  const scopedReceipts = getScopedRentReceipts().filter((receipt) => receipt?.pdfUrl);
  const scopedTenants = getScopedTenants();
  const scopedProperties = getScopedProperties();
  const paymentsById = new Map(getScopedPayments().map((payment) => [payment.id, payment]));
  const tenantById = new Map(scopedTenants.map((tenant) => [tenant.id, tenant]));
  const propertyById = new Map(scopedProperties.map((property) => [property.id, property]));
  const groupedReceipts = scopedReceipts.reduce((groups, receipt) => {
    const period = String(receipt.period || "sin-periodo");
    if (!groups[period]) {
      groups[period] = [];
    }
    groups[period].push(receipt);
    return groups;
  }, {});
  const periods = Object.keys(groupedReceipts).sort((left, right) => right.localeCompare(left));

  if (!periods.length) {
    elements.chargePeriodReceipts.innerHTML = buildEmptyState("Todavía no hay recibos emitidos para descargar.");
    return;
  }

  pruneChargePeriodSelections(periods, groupedReceipts);

  elements.chargePeriodReceipts.innerHTML = periods.map((period) => {
    const receipts = groupedReceipts[period].slice().sort((left, right) => sortByCreatedAtDesc(left, right));
    const selectedIds = new Set(state.chargePeriodSelections[period] || []);
    const selectableIds = receipts.map((receipt) => getRentReceiptSelectionKey(receipt));
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
    const selectedCount = selectableIds.filter((id) => selectedIds.has(id)).length;
    const periodPanelId = `charge-period-${period}`;

    return `
      <article class="entity-card charge-period-card">
        <button
          class="collapsible-trigger charge-period-trigger"
          type="button"
          data-collapse-toggle="${periodPanelId}"
          aria-expanded="false"
          aria-controls="${periodPanelId}"
        >
          <span class="charge-period-trigger-copy">
            <strong>${formatPeriodLabel(period)}</strong>
            <small>${receipts.length} recibo${receipts.length === 1 ? "" : "s"} generado${receipts.length === 1 ? "" : "s"}</small>
          </span>
          <span class="charge-period-trigger-side">
            <span class="status neutral">${selectedCount ? `${selectedCount} seleccionado${selectedCount === 1 ? "" : "s"}` : "Disponible"}</span>
            <span class="collapsible-indicator" aria-hidden="true">+</span>
          </span>
        </button>
        <div id="${periodPanelId}" class="collapsible-content hidden">
          <div class="charge-period-card-head">
            <div class="charge-period-actions">
              <label class="period-select-all">
                <input type="checkbox" data-rent-receipt-select-all data-period="${period}" ${allSelected ? "checked" : ""} />
                <span>Seleccionar todo</span>
              </label>
              <button class="ghost-action small-button" type="button" data-download-rent-receipts="selected" data-period="${period}" ${selectedCount ? "" : "disabled"}>
                Descargar selección
              </button>
              <button class="ghost-action small-button" type="button" data-download-rent-receipts="all" data-period="${period}">
                Descargar período
              </button>
            </div>
          </div>
          <div class="charge-period-receipt-list">
          ${receipts.map((receipt) => {
            const payment = paymentsById.get(receipt.paymentId);
            const tenant = tenantById.get(receipt.tenantId);
            const property = propertyById.get(payment?.propertyId || tenant?.propertyId);
            const receiptId = getRentReceiptSelectionKey(receipt);
            return `
              <article class="charge-period-receipt-row">
                <div class="charge-period-receipt-check">
                  <input type="checkbox" data-rent-receipt-select="${receiptId}" data-period="${period}" ${selectedIds.has(receiptId) ? "checked" : ""} />
                </div>
                <div class="charge-period-receipt-copy">
                  <strong>${tenant?.fullName || "Inquilino"} · ${property?.name || "Unidad"}</strong>
                  <p>Recibo ${receipt.receiptNumber || "sin numeración"} · emitido ${formatDateTime(receipt.issuedAt || receipt.createdAt)}</p>
                  <p>Código ${receipt.verificationCode || "sin código"}${payment?.total ? ` · ${formatCurrency(payment.total)}` : ""}</p>
                </div>
                <div class="charge-period-receipt-actions">
                  <span class="status neutral">${humanizeRentReceiptStatus(receipt.status)}</span>
                  <button class="ghost-action small-button" type="button" data-view-rent-receipt="${receipt.pdfUrl}">
                    Ver recibo
                  </button>
                </div>
              </article>
            `;
          }).join("")}
          </div>
        </div>
      </article>
    `;
  }).join("");
  bindCollapsibleTriggers(elements.chargePeriodReceipts);
}

function pruneChargePeriodSelections(periods, groupedReceipts) {
  const nextSelections = {};
  periods.forEach((period) => {
    const validIds = new Set((groupedReceipts[period] || []).map((receipt) => getRentReceiptSelectionKey(receipt)));
    const currentIds = (state.chargePeriodSelections[period] || []).filter((id) => validIds.has(String(id)));
    if (currentIds.length) {
      nextSelections[period] = currentIds;
    }
  });
  state.chargePeriodSelections = nextSelections;
}

function toggleRentReceiptSelection(period, receiptId, checked) {
  if (!period || !receiptId) {
    return;
  }

  const currentIds = new Set(state.chargePeriodSelections[period] || []);
  if (checked) {
    currentIds.add(receiptId);
  } else {
    currentIds.delete(receiptId);
  }

  if (currentIds.size) {
    state.chargePeriodSelections = {
      ...state.chargePeriodSelections,
      [period]: [...currentIds]
    };
  } else {
    const nextSelections = { ...state.chargePeriodSelections };
    delete nextSelections[period];
    state.chargePeriodSelections = nextSelections;
  }
}

function toggleRentReceiptPeriodSelection(period, checked) {
  if (!period) {
    return;
  }

  const ids = getScopedRentReceipts()
    .filter((receipt) => String(receipt.period || "sin-periodo") === period && receipt?.pdfUrl)
    .map((receipt) => getRentReceiptSelectionKey(receipt))
    .filter(Boolean);

  if (checked && ids.length) {
    state.chargePeriodSelections = {
      ...state.chargePeriodSelections,
      [period]: ids
    };
    return;
  }

  const nextSelections = { ...state.chargePeriodSelections };
  delete nextSelections[period];
  state.chargePeriodSelections = nextSelections;
}

async function handleRentReceiptDownloadRequest(mode, period = "") {
  const receipts = resolveRentReceiptsForDownload(mode, period);
  if (!receipts.length) {
    setMessage(
      mode === "selected"
        ? "Primero seleccioná al menos un recibo para descargar."
        : "No encontramos recibos para descargar en ese período.",
      "error"
    );
    return;
  }

  const scopeCopy = period ? ` de ${formatPeriodLabel(period)}` : "";
  try {
    setMessage(`Preparando archivo ZIP con ${receipts.length} recibo${receipts.length === 1 ? "" : "s"}${scopeCopy}...`);
    await requestRentReceiptsZip(receipts, period);
    setMessage(`ZIP listo: ${receipts.length} recibo${receipts.length === 1 ? "" : "s"}${scopeCopy}.`);
  } catch (error) {
    console.error(error);
    setMessage("No pudimos preparar el archivo ZIP de recibos. Intentá nuevamente.", "error");
  }
}

function resolveRentReceiptsForDownload(mode, period = "") {
  const scopedReceipts = getScopedRentReceipts().filter((receipt) => receipt?.pdfUrl);
  if (mode === "all") {
    return period
      ? scopedReceipts.filter((receipt) => String(receipt.period || "sin-periodo") === period)
      : scopedReceipts;
  }

  const selectedIds = period
    ? new Set(state.chargePeriodSelections[period] || [])
    : new Set(Object.values(state.chargePeriodSelections).flat());

  return scopedReceipts.filter((receipt) => selectedIds.has(getRentReceiptSelectionKey(receipt)));
}

async function requestRentReceiptsZip(receipts, period = "") {
  const prepareZip = httpsCallable(functions, "prepareRentReceiptsZip");
  const result = await prepareZip({
    receiptIds: receipts.map((receipt) => String(receipt.id || "")).filter(Boolean),
    period
  });
  const downloadUrl = result.data?.downloadUrl;
  const fileName = result.data?.fileName || buildRentReceiptZipName(receipts, period);

  if (!downloadUrl) {
    throw new Error("La Function no devolvió una URL de descarga.");
  }

  triggerFileDownload(downloadUrl, fileName);
}

function buildRentReceiptDownloadName(receipt, tenant, property) {
  const period = String(receipt.period || "sin-periodo");
  const unit = sanitizeDownloadSegment(property?.unitCode || property?.name || "unidad");
  const tenantName = sanitizeDownloadSegment(tenant?.fullName || "inquilino");
  return `recibo-${period}-${unit}-${tenantName}.pdf`;
}

function sanitizeDownloadSegment(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "archivo";
}

function getRentReceiptSelectionKey(receipt) {
  return String(receipt?.id || `${receipt?.paymentId || "pago"}-${receipt?.period || "sin-periodo"}-${receipt?.receiptNumber || "recibo"}`);
}

function buildRentReceiptZipName(receipts, period = "") {
  if (period) {
    return `recibos-${period}.zip`;
  }

  if (receipts.length === 1) {
    return `recibos-${String(receipts[0]?.period || "seleccion")}.zip`;
  }

  const sortedPeriods = [...new Set(receipts.map((receipt) => String(receipt.period || "sin-periodo")))].sort();
  const from = sortedPeriods[0] || "inicio";
  const to = sortedPeriods[sortedPeriods.length - 1] || "fin";
  return `recibos-${from}-a-${to}.zip`;
}

function saveBlobAsFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerFileDownload(url, filename) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function renderChargeRentUpdateSuite() {
  const suite = document.querySelector("#charge-rent-update-suite");
  if (!suite) {
    return;
  }

  const policyCardsHost = suite.querySelector("#rent-policy-card-list");
  if (policyCardsHost) {
    policyCardsHost.innerHTML = ["Departamento", "Local", "Casa"].map((unitType) => {
      const policy = getRentPolicyForCategory(unitType);
      return `
        <article class="entity-card rent-policy-card">
          <div>
            <p class="section-label">${unitType}</p>
            <h4>${policy ? describeRentPolicyHeadline(policy) : "Sin política activa"}</h4>
            <p>${policy ? describeRentPolicyBody(policy) : "Todavía no definimos una política para esta categoría."}</p>
          </div>
          <button class="ghost-action small-button" type="button" data-rent-policy-pick="${unitType}">Editar política</button>
        </article>
      `;
    }).join("");
  }

  const policyForm = suite.querySelector("#rent-policy-form");
  const selectedPolicyUnitType = suite.querySelector("#rent-policy-unit-type")?.value || "Departamento";
  const selectedPolicy = getRentPolicyForCategory(selectedPolicyUnitType);
  if (policyForm) {
    const updateSourceSelect = policyForm.querySelector("#rent-policy-update-source");
    const indexNameSelect = policyForm.querySelector("#rent-policy-index-name");
    const frequencySelect = policyForm.querySelector("#rent-policy-frequency");
    const nextPeriodInput = policyForm.querySelector("#rent-policy-next-period");
    const requiresApprovalInput = policyForm.querySelector("#rent-policy-requires-approval");

    if (updateSourceSelect && document.activeElement !== updateSourceSelect) {
      updateSourceSelect.value = selectedPolicy?.updateSource || "manual";
    }
    if (indexNameSelect && document.activeElement !== indexNameSelect) {
      indexNameSelect.value = selectedPolicy?.indexName || "ICL";
    }
    if (frequencySelect && document.activeElement !== frequencySelect) {
      frequencySelect.value = selectedPolicy?.frequency || "quarterly";
    }
    if (nextPeriodInput && document.activeElement !== nextPeriodInput) {
      nextPeriodInput.value = selectedPolicy?.nextAdjustmentPeriod || resolveNextPeriodValue();
    }
    if (requiresApprovalInput) {
      requiresApprovalInput.checked = Boolean(selectedPolicy?.requiresOwnerApproval);
    }
  }

  syncRentPolicyFormVisibility();

  const propertySelect = suite.querySelector("#rent-update-property-id");
  const propertyOptions = getScopedProperties()
    .filter((property) => getScopedTenants().some((tenant) => tenant.propertyId === property.id))
    .sort(comparePropertiesByDisplayOrder)
    .map((property) => `<option value="${property.id}">${property.name}</option>`)
    .join("");

  if (propertySelect) {
    propertySelect.innerHTML = propertyOptions || `<option value="">Sin unidades ocupadas</option>`;
    if (propertySelect.dataset.bound !== "true") {
      propertySelect.addEventListener("change", () => {
        renderChargeRentUpdateSuite();
      });
      propertySelect.dataset.bound = "true";
    }
  }

  const effectivePeriodInput = suite.querySelector("#rent-update-effective-period");
  const currentTargetMode = suite.querySelector("#rent-update-target-mode")?.value || "category";
  if (effectivePeriodInput) {
    if (currentTargetMode === "property") {
      const selectedPropertyId = propertySelect?.value || "";
      const propertySchedule = getPropertyRentScheduleDefaults(selectedPropertyId);
      if (document.activeElement !== effectivePeriodInput) {
        effectivePeriodInput.value = propertySchedule?.nextAdjustmentPeriod || effectivePeriodInput.value || resolveNextPeriodValue();
      }
    } else if (!effectivePeriodInput.value) {
      effectivePeriodInput.value = resolveNextPeriodValue();
    }
  }

  syncRentUpdateSuiteVisibility();

  const policyContextCopy = suite.querySelector("#rent-policy-context-copy");
  if (policyContextCopy) {
    const selectedUnitType = suite.querySelector("#rent-update-unit-type")?.value || "Departamento";
    const selectedPropertyId = suite.querySelector("#rent-update-property-id")?.value || "";
    const activePolicy = getRentPolicyForCategory(selectedUnitType);
    const isCategoryMode = (suite.querySelector("#rent-update-target-mode")?.value || "category") === "category";
    const propertySchedule = getPropertyRentScheduleDefaults(selectedPropertyId);
    policyContextCopy.classList.remove("hidden");
    if (isCategoryMode) {
      policyContextCopy.innerHTML = activePolicy
        ? `<strong>Política activa para ${selectedUnitType}:</strong> ${describeRentPolicyBody(activePolicy)}`
        : `<strong>${selectedUnitType}:</strong> sin política activa todavía. Este ajuste se tratará como actualización manual.`;
    } else {
      policyContextCopy.innerHTML = propertySchedule
        ? `<strong>Agenda de esta unidad:</strong> ${propertySchedule.updateSource === "indexed" ? `${propertySchedule.indexName || "Índice"} ` : ""}${humanizeRentFrequency(propertySchedule.frequency)} · próximo ajuste ${formatPeriodLabel(propertySchedule.nextAdjustmentPeriod || "") || "sin definir"}.`
        : "<strong>Agenda de esta unidad:</strong> sin configuración propia todavía. Si continuás, se aplicará como ajuste manual.";
    }
  }

  const previewHost = suite.querySelector("#rent-update-preview-host");
  if (previewHost) {
    const preview = state.rentUpdatePreview;
    previewHost.innerHTML = preview
      ? `
        <article class="entity-card rent-preview-card">
          <div class="rent-preview-head">
              <div>
                <p class="section-label">Vista previa</p>
                <h4>${preview.affectedCount} alquileres se actualizarán para ${formatPeriodLabel(preview.effectivePeriod)}</h4>
                <p>Ese valor impactará en los cobros desde ${formatPeriodLabel(preview.billingEffectivePeriod || addMonthsToPeriod(preview.effectivePeriod, 1))}.</p>
                <p class="panel-meta">${buildRentUpdatePreviewCopy(preview)}</p>
                <p class="rent-preview-policy-copy">${describeRentPolicyBody(preview.policy)}</p>
              </div>
              <span class="status neutral">${preview.targetMode === "category" ? "Categoría" : "Unidad puntual"}</span>
            </div>
          <div class="rent-preview-list">
            ${preview.items.map((item) => `
              <article class="rent-preview-item">
                <div>
                  <strong>${item.propertyName} · ${item.tenantName}</strong>
                  <p>${item.unitType} · ${normalizeOwnerLabel(item.ownerScope)}</p>
                </div>
                <div>
                  <span>Actual</span>
                  <strong>${formatCurrency(item.currentBaseRent)}</strong>
                </div>
                <div>
                  <span>Nuevo</span>
                  <strong>${formatCurrency(item.nextBaseRent)}</strong>
                </div>
              </article>
            `).join("")}
          </div>
        </article>
      `
      : buildEmptyState("Elegí el alcance del ajuste y pedí una vista previa antes de aplicar cambios.");
  }

  const historyHost = suite.querySelector("#rent-update-history-list");
  if (historyHost) {
    historyHost.innerHTML = state.rentAdjustments.length
      ? state.rentAdjustments
          .slice(0, 8)
          .map((adjustment) => `
            <article class="entity-card rent-adjustment-history-card">
              <div>
                <p class="section-label">${formatPeriodLabel(adjustment.effectivePeriod || "")}</p>
                <h4>${adjustment.summary || "Ajuste de alquiler aplicado"}</h4>
                  <p>${adjustment.targetMode === "category" ? `Categoría: ${adjustment.unitType || "Sin definir"}` : `Unidad: ${adjustment.propertyName || "Sin definir"}`}</p>
                  <p>${adjustment.adjustmentMode === "percent" ? `${Number(adjustment.value || 0)}%` : formatCurrency(adjustment.value || 0)} · ${adjustment.affectedCount || 0} alquileres</p>
                  <p>${describeRentPolicyBody(adjustment)}</p>
                  <p>${adjustment.createdAt ? `Aplicado ${formatDateTime(adjustment.createdAt)}` : "Aplicado recientemente"}</p>
                </div>
              </article>
          `)
          .join("")
      : buildEmptyState("Todavía no registramos ajustes manuales de alquiler para este alcance.");
  }

  const applyButton = suite.querySelector("#rent-update-apply-button");
  if (applyButton) {
    applyButton.disabled = !state.rentUpdatePreview?.affectedCount;
  }
}

async function handleRentUpdatePreviewSubmit(event) {
  event.preventDefault();

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede planificar actualizaciones de alquiler.", "error");
    return;
  }

  const suite = document.querySelector("#charge-rent-update-suite");
  if (!suite) {
    return;
  }

  const payload = readRentUpdateFormPayload(suite);
  if (!payload) {
    return;
  }

  try {
    setMessage("Calculando vista previa del ajuste...");
    const previewRentUpdate = httpsCallable(functions, "previewRentUpdate");
    const result = await previewRentUpdate(payload);
    state.rentUpdatePreview = result.data?.preview || null;
    renderChargeRentUpdateSuite();
    setMessage(
      state.rentUpdatePreview?.affectedCount
        ? `Vista previa lista. Se afectarían ${state.rentUpdatePreview.affectedCount} alquileres.`
        : "No encontramos alquileres activos para ese criterio."
    );
  } catch (error) {
    console.error(error);
    state.rentUpdatePreview = null;
    renderChargeRentUpdateSuite();
    setMessage(humanizeFunctionError(error) || "No pudimos calcular la vista previa del ajuste.", "error");
  }
}

async function handleRentPolicySubmit(event) {
  event.preventDefault();

  if (!isAdminRole()) {
    setMessage("Solo un administrador puede guardar políticas de alquiler.", "error");
    return;
  }

  const suite = document.querySelector("#charge-rent-update-suite");
  const form = suite?.querySelector("#rent-policy-form");
  if (!form) {
    return;
  }

  const payload = readRentPolicyFormPayload(form);
  if (!payload) {
    return;
  }

  try {
    setMessage("Guardando política de alquiler...");
    const saveRentUpdatePolicy = httpsCallable(functions, "saveRentUpdatePolicy");
    const result = await saveRentUpdatePolicy(payload);
    await reloadScopedAdminOperation();
    setMessage(result.data?.summary || "Política guardada correctamente.", "success");
  } catch (error) {
    console.error(error);
    setMessage(humanizeFunctionError(error) || "No pudimos guardar la política de alquiler.", "error");
  }
}

function handleRentPolicyCardAction(event) {
  const button = event.target.closest("[data-rent-policy-pick]");
  if (!button) {
    return;
  }

  const suite = document.querySelector("#charge-rent-update-suite");
  const category = button.getAttribute("data-rent-policy-pick");
  const select = suite?.querySelector("#rent-policy-unit-type");
  if (select && category) {
    select.value = category;
    renderChargeRentUpdateSuite();
    select.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function handleRentUpdateApplyPlan() {
  if (!isAdminRole()) {
    setMessage("Solo un administrador puede aplicar actualizaciones de alquiler.", "error");
    return;
  }

  const suite = document.querySelector("#charge-rent-update-suite");
  if (!suite) {
    return;
  }

  const preview = state.rentUpdatePreview;
  if (!preview?.affectedCount) {
    setMessage("Primero genera una vista previa válida antes de aplicar cambios.", "error");
    return;
  }

  const confirmed = window.confirm(
    `Se actualizarán ${preview.affectedCount} alquileres para ${formatPeriodLabel(preview.effectivePeriod)} y ese valor se cobrará desde ${formatPeriodLabel(preview.billingEffectivePeriod || addMonthsToPeriod(preview.effectivePeriod, 1))}. ¿Querés continuar?`
  );
  if (!confirmed) {
    setMessage("Actualización de alquileres cancelada.");
    return;
  }

  try {
    setMessage("Aplicando actualización de alquileres...");
    const applyRentUpdatePlan = httpsCallable(functions, "applyRentUpdatePlan");
    const payload = readRentUpdateFormPayload(suite);
    const result = await applyRentUpdatePlan(payload);
    state.rentUpdatePreview = null;
    await reloadScopedAdminOperation();
    setMessage(result.data?.summary || `Se actualizaron ${result.data?.applied ?? 0} alquileres.`, "success");
  } catch (error) {
    console.error(error);
    setMessage(humanizeFunctionError(error) || "No pudimos aplicar el ajuste de alquileres.", "error");
  }
}

function syncRentUpdateSuiteVisibility() {
  const suite = document.querySelector("#charge-rent-update-suite");
  if (!suite) {
    return;
  }

  const targetMode = suite.querySelector("#rent-update-target-mode")?.value || "category";
  const categoryWrap = suite.querySelector("#rent-update-unit-type-wrap");
  const propertyWrap = suite.querySelector("#rent-update-property-wrap");

  categoryWrap?.classList.toggle("hidden", targetMode !== "category");
  propertyWrap?.classList.toggle("hidden", targetMode !== "property");
}

function syncRentPolicyFormVisibility() {
  const suite = document.querySelector("#charge-rent-update-suite");
  if (!suite) {
    return;
  }

  const updateSource = suite.querySelector("#rent-policy-update-source")?.value || "manual";
  const indexWrap = suite.querySelector("#rent-policy-index-wrap");
  indexWrap?.classList.toggle("hidden", updateSource !== "indexed");
}

function readRentUpdateFormPayload(host) {
  const targetMode = host.querySelector("#rent-update-target-mode")?.value || "category";
  const adjustmentMode = host.querySelector("#rent-update-value-mode")?.value || "percent";
  const value = Number(host.querySelector("#rent-update-value")?.value || 0);
  const unitType = host.querySelector("#rent-update-unit-type")?.value || "";
  const propertyId = host.querySelector("#rent-update-property-id")?.value || "";
  const effectivePeriod = host.querySelector("#rent-update-effective-period")?.value || resolveNextPeriodValue();

  if (!Number.isFinite(value) || value === 0) {
    setMessage("Indica un valor distinto de cero para el ajuste.", "error");
    return null;
  }

  if (targetMode === "category" && !unitType) {
    setMessage("Elegí la categoría que querés actualizar.", "error");
    return null;
  }

  if (targetMode === "property" && !propertyId) {
    setMessage("Elegí una unidad puntual para continuar.", "error");
    return null;
  }

  const propertySchedule = targetMode === "property" ? getPropertyRentScheduleDefaults(propertyId) : null;
  const categoryPolicy = targetMode === "category" ? getRentPolicyForCategory(unitType) : null;
  const effectivePeriodValue = normalizeTenantPeriodValue(effectivePeriod)
    || propertySchedule?.nextAdjustmentPeriod
    || resolveNextPeriodValue();

  return {
    targetMode,
    adjustmentMode,
    value,
    unitType,
    propertyId,
    effectivePeriod: effectivePeriodValue,
    updateSource: targetMode === "property"
      ? propertySchedule?.updateSource || "manual"
      : categoryPolicy?.updateSource || "manual",
    indexName: targetMode === "property"
      ? propertySchedule?.indexName || null
      : categoryPolicy?.indexName || null,
    frequency: targetMode === "property"
      ? propertySchedule?.frequency || "quarterly"
      : categoryPolicy?.frequency || "quarterly",
    nextAdjustmentPeriod: targetMode === "property"
      ? propertySchedule?.nextAdjustmentPeriod || effectivePeriodValue
      : categoryPolicy?.nextAdjustmentPeriod || effectivePeriodValue,
    requiresOwnerApproval: targetMode === "property"
      ? Boolean(propertySchedule?.requiresOwnerApproval)
      : Boolean(categoryPolicy?.requiresOwnerApproval)
  };
}

function readRentPolicyFormPayload(host) {
  const unitType = host.querySelector("#rent-policy-unit-type")?.value || "";
  const updateSource = host.querySelector("#rent-policy-update-source")?.value || "manual";
  const indexName = host.querySelector("#rent-policy-index-name")?.value || "ICL";
  const frequency = host.querySelector("#rent-policy-frequency")?.value || "quarterly";
  const nextAdjustmentPeriod = host.querySelector("#rent-policy-next-period")?.value || resolveNextPeriodValue();
  const requiresOwnerApproval = host.querySelector("#rent-policy-requires-approval")?.checked === true;

  if (!unitType) {
    setMessage("Elegí una categoría para guardar la política.", "error");
    return null;
  }

  return {
    unitType,
    updateSource,
    indexName,
    frequency,
    nextAdjustmentPeriod,
    requiresOwnerApproval
  };
}

function resolveNextPeriodValue() {
  const today = new Date();
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

function buildRentUpdatePreviewCopy(preview) {
  if (!preview) {
    return "";
  }

  const changeCopy = preview.adjustmentMode === "percent"
    ? `${Number(preview.value || 0) > 0 ? "+" : ""}${Number(preview.value || 0)}%`
    : formatCurrency(Number(preview.value || 0));
  const scopeCopy = preview.targetMode === "category"
    ? `${preview.unitType || "Categoría"}`
    : preview.propertyName || "Unidad";

  const billingCopy = formatPeriodLabel(preview.billingEffectivePeriod || addMonthsToPeriod(preview.effectivePeriod, 1));
  return `${scopeCopy} · ${changeCopy} · alcance ${normalizeOwnerLabel(preview.ownerScope || getCurrentOwnerScope())} · se cobra desde ${billingCopy}.`;
}

function getRentPolicyForCategory(unitType) {
  const normalizedType = String(unitType || "").trim().toLowerCase();
  const currentScope = getCurrentOwnerScope();
  return state.rentAdjustmentPolicies.find((policy) => {
    const sameType = String(policy.unitType || "").trim().toLowerCase() === normalizedType;
    if (!sameType) {
      return false;
    }

    const policyScope = String(policy.ownerScope || "all").trim().toLowerCase();
    return policyScope === String(currentScope || "all").trim().toLowerCase();
  }) || state.rentAdjustmentPolicies.find((policy) => {
    const sameType = String(policy.unitType || "").trim().toLowerCase() === normalizedType;
    const policyScope = String(policy.ownerScope || "all").trim().toLowerCase();
    return sameType && policyScope === "all";
  }) || null;
}

function getRentPolicyForProperty(propertyId) {
  const normalizedPropertyId = String(propertyId || "").trim();
  if (!normalizedPropertyId) {
    return null;
  }

  return state.rentAdjustmentPolicies.find((policy) => String(policy.propertyId || "").trim() === normalizedPropertyId)
    || state.rentAdjustmentPolicies.find((policy) => String(policy.scopeKey || "").trim() === normalizedPropertyId && String(policy.scopeType || "").trim() === "property")
    || null;
}

function getPropertyRentScheduleDefaults(propertyId) {
  const propertyPolicy = getRentPolicyForProperty(propertyId);
  if (propertyPolicy) {
    return {
      updateSource: propertyPolicy.updateSource || "manual",
      indexName: propertyPolicy.indexName || null,
      frequency: propertyPolicy.frequency || "quarterly",
      nextAdjustmentPeriod: propertyPolicy.nextAdjustmentPeriod || null,
      requiresOwnerApproval: Boolean(propertyPolicy.requiresOwnerApproval)
    };
  }

  const tenant = getScopedTenants().find((item) => item.propertyId === propertyId);
  if (!tenant) {
    return null;
  }

  return {
    updateSource: "manual",
    indexName: null,
    frequency: tenant.rentSchedule?.frequency || tenant.rentUpdateConfig?.frequency || "quarterly",
    nextAdjustmentPeriod: tenant.rentSchedule?.nextAdjustmentPeriod || tenant.rentUpdateConfig?.nextAdjustmentPeriod || null,
    requiresOwnerApproval: Boolean(tenant.rentUpdateConfig?.requiresOwnerApproval)
  };
}

function describeRentPolicyHeadline(policy) {
  if (!policy) {
    return "Sin política activa";
  }

  return policy.updateSource === "indexed"
    ? `${policy.indexName || "Índice"} ${humanizeRentFrequency(policy.frequency)}`
    : "Ajuste manual";
}

function describeRentPolicyBody(policy) {
  if (!policy) {
    return "";
  }

  const frequencyCopy = humanizeRentFrequency(policy.frequency || "quarterly");
  const nextCopy = formatPeriodLabel(policy.nextAdjustmentPeriod || "");
  const approvalCopy = policy.requiresOwnerApproval
    ? "requiere autorización del locador"
    : "sin autorización previa";

  if (policy.updateSource === "indexed") {
    return `${policy.indexName || "Índice"} ${frequencyCopy} · próximo ajuste ${nextCopy} · ${approvalCopy}.`;
  }

  return `Actualización manual ${frequencyCopy} · próximo ajuste ${nextCopy} · ${approvalCopy}.`;
}

function humanizeRentFrequency(value) {
  if (value === "monthly") {
    return "mensual";
  }
  if (value === "semiannual") {
    return "semestral";
  }
  return "trimestral";
}

function normalizeTenantDueDayValue(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const rounded = Math.trunc(numeric);
  return rounded >= 1 && rounded <= 28 ? rounded : null;
}

function normalizeTenantRentFrequencyValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "monthly" || normalized === "quarterly" || normalized === "semiannual") {
    return normalized;
  }

  return "quarterly";
}

function normalizeTenantPeriodValue(value) {
  const period = String(value ?? "").trim();
  return /^\d{4}-\d{2}$/.test(period) ? period : null;
}

function describeTenantDueDay(tenant) {
  const dueDay = normalizeTenantDueDayValue(tenant?.dueDayOfMonth);
  if (dueDay) {
    return `Día ${dueDay} de cada mes`;
  }

  return `Día ${resolveGeneralSettings().dueDayOfMonth} (general)`;
}

function describeTenantRentSchedule(tenant) {
  const frequency = humanizeRentFrequency(tenant?.rentSchedule?.frequency || tenant?.rentUpdateConfig?.frequency || "quarterly");
  const nextPeriod = tenant?.rentSchedule?.nextAdjustmentPeriod || tenant?.rentUpdateConfig?.nextAdjustmentPeriod || "";
  if (!nextPeriod) {
    return `${frequency} · sin período definido`;
  }

  return `${frequency} · ${formatPeriodLabel(nextPeriod)}`;
}

function renderUtilityBills() {
  const scopedBills = getScopedUtilityBills();
  elements.utilityBillList.innerHTML = scopedBills.length
    ? scopedBills
        .map((bill) => {
          const canApply =
            typeof bill.amount === "number"
            && !Number.isNaN(Number(bill.amount))
            && canAutoApplyBillToProperty(bill);
          return `
            <article class="entity-card">
              <div>
                <p class="section-label">${bill.period || "Sin período"}</p>
                <h4>${bill.serviceType === "electricity" ? "Factura de luz" : "Factura de agua"}</h4>
                ${
                  bill.appliedToCharges
                    ? `<span class="status success">Factura aplicada</span>`
                    : ""
                }
                <p>${humanizeBillingGroup(bill.billingGroup)} - ${bill.fileName || "Sin archivo"}</p>
                <p>${bill.amount ? `Monto: ${formatCurrency(bill.amount)}` : "Monto pendiente de lectura"}</p>
                <p>${bill.dueDate ? `Vence ${formatDate(bill.dueDate)}` : "Vencimiento pendiente de lectura"}</p>
                <p>${describeBillChargePolicy(bill)}</p>
                <p>${bill.appliedToCharges ? "Estado: aplicada al proximo calculo." : "Estado: pendiente de aplicar."}</p>
                <p>${bill.extractionSummary || "Todavía sin lectura asistida."}</p>
                <div class="entity-card-actions">
                  <a class="entity-link" href="${bill.downloadURL}" target="_blank" rel="noreferrer">Abrir factura</a>
                  <button class="ghost-action small-button" type="button" data-analyze-bill="${bill.id}">
                    Analizar factura
                  </button>
                  ${
                    canApply
                      ? `<button class="primary-action small-button" type="button" data-apply-bill="${bill.id}">
                          Aplicar
                        </button>`
                      : ""
                  }
                </div>
              </div>
            </article>
          `;
        })
        .join("")
      : buildEmptyState("Todavía no hay facturas cargadas.");
}

function renderUtilityBillGroupOptions() {
  if (!elements.utilityBillPropertySelect) {
    return;
  }

  const groups = getBillingGroups(elements.utilityBillServiceType?.value || "electricity");
  elements.utilityBillPropertySelect.innerHTML = groups
    .map((group) => `<option value="${group.value}">${group.label}</option>`)
    .join("");
}

function renderAdminPaymentReview() {
  if (!elements.adminPaymentReview) {
    return;
  }

  const scopedPayments = getAdminVisiblePayments(getScopedPayments());
  const scopedTenants = getScopedTenants();
  const scopedCharges = getScopedCharges();
  const scopedProperties = getScopedProperties();
  const scopedReceipts = getScopedReceipts();
  const scopedRentReceipts = getScopedRentReceipts();
  const currentMonth = new Date().toISOString().slice(0, 7);
  const metricsWrap = document.querySelector("#comprobante-summary-cards");
  const tabRow = document.querySelector("#comprobante-tab-row");
  const propertyFilter = document.querySelector("#comprobante-filter-property");
  const ownerWrap = document.querySelector("#comprobante-owner-filter-wrap");

  if (metricsWrap) {
    const approvedThisMonth = scopedPayments.filter((payment) => {
      const approvedAt = String(payment.approvedAt ?? payment.providerConfirmedAt ?? "");
      return approvedAt.startsWith(currentMonth);
    }).length;
    const rejectedCount = scopedPayments.filter((payment) => payment.status === "rejected").length;
    const pendingCount = scopedPayments.filter((payment) => ["reported", "in_review"].includes(String(payment.status || ""))).length;
    const emittedCount = scopedRentReceipts.length;
    metricsWrap.innerHTML = [
      ["Pendientes de revisión", pendingCount],
      ["Aprobados este mes", approvedThisMonth],
      ["Rechazados", rejectedCount],
      ["Recibos emitidos", emittedCount]
    ]
      .map(([label, value]) => `
        <article class="summary-mini-card comprobante-summary-card">
          <span>${label}</span>
          <strong>${value}</strong>
          <p>${isSuperadminRole() ? "Vista global" : normalizeOwnerLabel(getCurrentOwnerScope())}</p>
        </article>
      `)
      .join("");
  }

  if (tabRow) {
    const tabs = [
      ["pending", "Pendientes"],
      ["approved", "Aprobados"],
      ["rejected", "Rechazados"],
      ["receipt_issued", "Recibos emitidos"],
      ["all", "Todos"]
    ];
    tabRow.innerHTML = tabs
      .map(
        ([value, label]) =>
          `<button class="ghost-action comprobante-tab-button ${state.comprobanteFilters.tab === value ? "active" : ""}" type="button" data-comprobante-tab="${value}">${label}</button>`
      )
      .join("");
  }

  if (propertyFilter) {
    const currentValue = state.comprobanteFilters.propertyId;
    propertyFilter.innerHTML = `<option value="">Todas</option>${
      scopedProperties
        .map((property) => `<option value="${property.id}" ${currentValue === property.id ? "selected" : ""}>${property.name}</option>`)
        .join("")
    }`;
  }

  if (ownerWrap) {
    ownerWrap.classList.toggle("hidden", !isSuperadminRole());
  }

  const filteredPayments = scopedPayments.filter((payment) => {
    const tenant = scopedTenants.find((item) => item.id === payment.tenantId);
    const charge = scopedCharges.find((item) => item.id === payment.chargeId);
    const property = scopedProperties.find((item) => item.id === charge?.propertyId);
    const rentReceipt = scopedRentReceipts.find((receipt) => receipt.paymentId === payment.id);
    const ownerScope = resolvePropertyOwnerScope(property);
    const searchTerm = state.comprobanteFilters.tenantSearch.trim().toLowerCase();
    const tab = state.comprobanteFilters.tab;
    const statusFilter = state.comprobanteFilters.status;

    if (state.comprobanteFilters.period && charge?.period !== state.comprobanteFilters.period) {
      return false;
    }
    if (state.comprobanteFilters.propertyId && charge?.propertyId !== state.comprobanteFilters.propertyId) {
      return false;
    }
    if (searchTerm && !String(tenant?.fullName || "").toLowerCase().includes(searchTerm)) {
      return false;
    }
    if (isSuperadminRole() && state.comprobanteFilters.owner !== "all" && ownerScope !== state.comprobanteFilters.owner) {
      return false;
    }
    if (tab === "pending" && !["reported", "in_review"].includes(String(payment.status || ""))) {
      return false;
    }
    if (tab === "approved" && !["approved", "provider_confirmed"].includes(String(payment.status || ""))) {
      return false;
    }
    if (tab === "rejected" && payment.status !== "rejected") {
      return false;
    }
    if (tab === "receipt_issued" && !rentReceipt) {
      return false;
    }
    if (statusFilter === "reported" && !["reported", "in_review"].includes(String(payment.status || ""))) {
      return false;
    }
    if (statusFilter === "approved" && !["approved", "provider_confirmed"].includes(String(payment.status || ""))) {
      return false;
    }
    if (statusFilter === "rejected" && payment.status !== "rejected") {
      return false;
    }
    if (statusFilter === "receipt_issued" && !rentReceipt) {
      return false;
    }
    if (statusFilter === "email_sent" && String(rentReceipt?.emailStatus || "") !== "sent") {
      return false;
    }
    if (statusFilter === "email_error" && String(rentReceipt?.emailStatus || "") !== "failed") {
      return false;
    }

    return true;
  });

  elements.adminPaymentReview.innerHTML = filteredPayments.length
    ? filteredPayments
        .map((payment) => {
          const tenant = scopedTenants.find((item) => item.id === payment.tenantId);
          const charge = scopedCharges.find((item) => item.id === payment.chargeId);
          const property = scopedProperties.find((item) => item.id === charge?.propertyId);
          const paymentReceipts = scopedReceipts.filter((receipt) => receipt.paymentId === payment.id);
          const rentReceipt = scopedRentReceipts.find((receipt) => receipt.paymentId === payment.id);
          const canReview = payment.method === "transfer" && ["in_review", "reported"].includes(String(payment.status || ""));
          const canIssueReceipt = ["approved", "provider_confirmed"].includes(String(payment.status || ""));
          const ownerLabel = normalizeOwnerLabel(resolvePropertyOwnerScope(property));
          const paymentTone = paymentStatusTone(payment.status);
          const financialSyncTone = paymentFinancialSyncTone(payment.financialSyncStatus);
          const receiptTone = rentReceiptStatusTone(rentReceipt?.status, rentReceipt?.emailStatus);
          return `
            <article class="entity-card comprobante-card">
              <div>
                <div class="comprobante-status-row">
                  <p class="section-label">${ownerLabel}</p>
                  <span class="status ${paymentTone}">${humanizePaymentStatus(payment.status)}</span>
                </div>
                ${
                  canIssueReceipt
                    ? `<div class="financial-sync-row">
                        <span class="status ${financialSyncTone}">${humanizePaymentFinancialSyncStatus(payment.financialSyncStatus)}</span>
                        ${payment.financialTransactionId ? `<span class="financial-sync-id">ID: ${payment.financialTransactionId}</span>` : ""}
                        ${payment.financialSyncError ? `<p class="error-text">${payment.financialSyncError}</p>` : ""}
                      </div>`
                    : ""
                }
                <h4>${tenant?.fullName || "Inquilino"} · ${property?.name || "Unidad"}</h4>
                <div class="comprobante-meta-grid">
                  <p><strong>Período</strong><span>${charge?.period || "Sin período"}</span></p>
                  <p><strong>Monto informado</strong><span>${formatCurrency(payment.amountReported ?? payment.amountConfirmed ?? 0)}</span></p>
                  <p><strong>Medio de pago</strong><span>${humanizePaymentMethod(payment.method)}</span></p>
                  <p><strong>Fecha de envío</strong><span>${formatDateTime(resolveDisplayDate(payment.createdAt || payment.reportedAt))}</span></p>
                </div>
                <p class="comprobante-observation">${payment.reviewNotes || "Sin observaciones por ahora."}</p>
                ${
                  payment.method === "mercado_pago"
                    ? `<p class="comprobante-provider-note">Estado Mercado Pago: ${payment.mercadoPagoStatus || "sin respuesta"}</p>`
                    : ""
                }
                ${
                  rentReceipt
                    ? `<div class="receipt-status-block">
                        <div class="comprobante-status-row">
                          <p><strong>Recibo emitido:</strong> ${rentReceipt.receiptNumber || "Generado"}</p>
                          <span class="status ${receiptTone}">${humanizeRentReceiptStatus(rentReceipt.status)}${String(rentReceipt.emailStatus || "") === "sent" ? " · Email enviado" : ""}</span>
                        </div>
                        <p>${rentReceipt.sentAt ? `Último envío ${formatDateTime(rentReceipt.sentAt)}` : "Pendiente de envío por correo."}</p>
                        <p>Código de verificación: ${rentReceipt.verificationCode || "sin código"}</p>
                        ${rentReceipt.lastError ? `<p class="error-text">${rentReceipt.lastError}</p>` : ""}
                      </div>`
                    : ""
                }
                ${
                  paymentReceipts.length
                    ? `<div class="receipt-review-list">
                        ${paymentReceipts
                          .map((receipt, index) => `
                            <article class="receipt-review-item">
                              <div>
                                <strong>Comprobante ${index + 1}</strong>
                                <p>${receipt.fileName || "Archivo sin nombre"}</p>
                                <p>${humanizeReceiptStatus(receipt.claudeExtractionStatus)}</p>
                                <p>${humanizeReceiptSuggestion(receipt.reviewSuggestion)}</p>
                                <p>${receipt.detectedDocumentType ? `Tipo detectado: ${humanizeReceiptDocumentType(receipt.detectedDocumentType)}` : "Tipo detectado: pendiente"}</p>
                                <p>${receipt.detectedAmount ? `Monto detectado: ${formatCurrency(receipt.detectedAmount)}` : "Monto detectado: sin lectura todavía"}</p>
                                <p>${receipt.detectedPaidAt ? `Fecha y hora detectadas: ${formatDateTime(receipt.detectedPaidAt)}` : receipt.detectedDate ? `Fecha detectada: ${formatDate(receipt.detectedDate)}` : "Fecha detectada: sin lectura todavía"}</p>
                              </div>
                              <div class="entity-card-actions">
                                <a class="entity-link" href="${receipt.downloadURL}" target="_blank" rel="noreferrer">Ver comprobante</a>
                                <button class="ghost-action small-button" type="button" data-analyze-receipt="${receipt.id}">Analizar</button>
                              </div>
                            </article>
                          `)
                          .join("")}
                      </div>`
                    : `<p class="comprobante-empty-copy">No hay archivos adjuntos para este pago.</p>`
                }
                <div class="entity-card-actions wrap-actions comprobante-action-row">
                  ${
                    canReview
                      ? `<button class="primary-action small-button" type="button" data-approve-payment="${payment.id}" data-charge-id="${payment.chargeId}">Aprobar y generar recibo</button>
                         <button class="ghost-action small-button" type="button" data-reject-payment="${payment.id}" data-charge-id="${payment.chargeId}">Rechazar</button>`
                      : ""
                  }
                  ${paymentReceipts[0]?.downloadURL ? `<a class="entity-link" href="${paymentReceipts[0].downloadURL}" target="_blank" rel="noreferrer">Ver comprobante</a>` : ""}
                  <button class="ghost-action small-button" type="button" data-open-section="mensajes">Enviar mensaje</button>
                  ${
                    rentReceipt?.pdfUrl
                      ? `<button class="ghost-action small-button" type="button" data-view-rent-receipt="${rentReceipt.pdfUrl}">Ver recibo</button>`
                      : ""
                  }
                  ${
                    canIssueReceipt
                      ? `<button class="ghost-action small-button" type="button" data-send-rent-receipt="${payment.id}" ${rentReceipt ? 'data-regenerate-receipt="true"' : ""}>
                           ${rentReceipt ? "Reenviar recibo" : "Generar y enviar recibo"}
                         </button>`
                      : ""
                  }
                </div>
                <p class="panel-meta">Acción principal: revisá el comprobante, aprobá el pago y emití el recibo oficial cuando corresponda.</p>
              </div>
            </article>
          `;
        })
        .join("")
    : buildEmptyState("No hay comprobantes pendientes de revisión.");
}

function getAdminVisiblePayments(payments = []) {
  const sortedPayments = [...payments].sort((left, right) => {
    const leftValue = resolveTimestamp(left.updatedAt ?? left.createdAt);
    const rightValue = resolveTimestamp(right.updatedAt ?? right.createdAt);
    return rightValue - leftValue;
  });
  const latestMercadoPagoByCharge = new Set();

  return sortedPayments.filter((payment) => {
    if (isMercadoPagoCheckoutPlaceholder(payment)) {
      return false;
    }

    if (String(payment.method || "") !== "mercado_pago") {
      return true;
    }

    const chargeId = String(payment.chargeId || "");
    if (!chargeId) {
      return true;
    }

    if (latestMercadoPagoByCharge.has(chargeId)) {
      return false;
    }

    latestMercadoPagoByCharge.add(chargeId);
    return true;
  });
}

function isMercadoPagoCheckoutPlaceholder(payment) {
  if (String(payment?.method || "") !== "mercado_pago") {
    return false;
  }

  const status = String(payment?.status || "");
  const mercadoPagoStatus = String(payment?.mercadoPagoStatus || "");
  const hasProviderPayment = Boolean(payment?.mercadoPagoPaymentId);
  const isResolved = ["approved", "provider_confirmed", "rejected"].includes(status);

  return !isResolved && !hasProviderPayment && mercadoPagoStatus === "preference_created";
}

function renderAuditLogs() {
  if (!elements.auditLogList) {
    return;
  }

  const scopedAuditLogs = getScopedAuditLogs();
  elements.auditLogList.innerHTML = scopedAuditLogs.length
    ? scopedAuditLogs
        .slice(0, 60)
        .map(
          (log) => `
            <article class="entity-card">
              <div>
                <p class="section-label">${humanizeAuditAction(log.action)}</p>
                <h4>${log.summary || "Movimiento registrado"}</h4>
                <p>${log.actorName || log.actorEmail || "Administrador"} - ${formatDateTime(log.createdAt)}</p>
                <p>${humanizeAuditEntity(log.entityType)} ${log.entityId || ""}</p>
              </div>
            </article>
          `
        )
        .join("")
    : buildEmptyState("Todavía no hay movimientos de auditoría para este alcance.");
}

function renderMessageTenantOptions() {
  if (!elements.messageTenantSelect) {
    return;
  }

  const activeTenants = getScopedTenants()
    .filter((tenant) => !["inactive", "deleted"].includes(String(tenant.status || "active")))
    .sort((left, right) => String(left.fullName || "").localeCompare(String(right.fullName || "")));

  elements.messageTenantSelect.innerHTML = activeTenants.length
    ? activeTenants
        .map((tenant) => `<option value="${tenant.id}">${tenant.fullName} - ${tenant.phone || "sin teléfono"}</option>`)
        .join("")
    : `<option value="">No hay inquilinos disponibles</option>`;

  handleMessageTemplateChange();
}

function renderMessages() {
  if (!elements.messageLogList) {
    return;
  }

  const scopedMessages = getScopedMessages();
  const scopedTenants = getScopedTenants();
  elements.messageLogList.innerHTML = scopedMessages.length
    ? scopedMessages
        .slice(0, 60)
        .map((message) => {
          const tenant = scopedTenants.find((item) => item.id === message.tenantId);
          const statusTone =
            message.status === "sent"
              ? "success"
              : message.status === "failed"
                ? "danger"
                : message.status === "blocked"
                  ? "danger"
                  : "warning";

          return `
            <article class="entity-card">
              <div>
                <p class="section-label">${humanizeMessageType(message.type)}</p>
                <h4>${tenant?.fullName || "Inquilino"} - ${humanizeMessageStatus(message.status)}</h4>
                <p>${humanizeMessageChannel(message.channel || message.requestedChannel || "auto")} - ${formatDateTime(resolveDisplayDate(message.createdAt || message.sentAt))}</p>
                <p>${message.body || "Sin contenido."}</p>
                <p>${message.providerResponse ? truncateText(message.providerResponse, 180) : "Sin respuesta del proveedor."}</p>
              </div>
              <span class="status ${statusTone}">${humanizeMessageStatus(message.status)}</span>
            </article>
          `;
        })
        .join("")
    : buildEmptyState("Todavía no hay mensajes enviados para este alcance.");
}

function renderUserAccessList() {
  if (!elements.userAccessList) {
    return;
  }

  if (elements.adminUserCreateForm) {
    elements.adminUserCreateForm.classList.toggle("hidden", !isSuperadminRole());
  }

  const sortedUsers = [...state.users]
    .filter((user) => isSuperadminRole() || String(user.role || "") !== "superadmin")
    .sort((left, right) =>
      String(left.displayName || left.email || "").localeCompare(String(right.displayName || right.email || ""))
    );

  elements.userAccessList.innerHTML = sortedUsers.length
    ? sortedUsers
        .map((user) => {
          const isCurrentUser = user.id === state.authUser?.uid;
          const tenant = user.tenantId
            ? getScopedTenants().find((item) => item.id === user.tenantId)
            : null;

          return `
            <article class="entity-card" data-user-card="${user.id}">
              <div>
                <h4>${user.displayName || user.email || "Usuario sin nombre"}</h4>
                <p>${user.email || "Sin correo"}</p>
                <p>${tenant ? `Inquilino vinculado: ${tenant.fullName}` : "Sin inquilino vinculado"}</p>
                <p>${String(user.role || "") === "tenant" ? "Sin ownerScope" : `Alcance: ${normalizeOwnerLabel(user.ownerScope || "all")}`}</p>
                ${isCurrentUser ? `<span class="status neutral">Tu cuenta actual</span>` : ""}
              </div>
              <div class="entity-card-actions user-access-actions">
                <label>
                  Rol
                  <select data-user-role ${isCurrentUser ? "disabled" : ""}>
                    <option value="tenant" ${user.role === "tenant" ? "selected" : ""}>Inquilino</option>
                    <option value="admin" ${user.role === "admin" ? "selected" : ""}>Admin</option>
                    <option value="superadmin" ${user.role === "superadmin" ? "selected" : ""}>Superadmin</option>
                  </select>
                </label>
                <label>
                  Estado
                  <select data-user-status ${isCurrentUser ? "disabled" : ""}>
                    <option value="active" ${(user.status || "active") === "active" ? "selected" : ""}>Activo</option>
                    <option value="inactive" ${user.status === "inactive" ? "selected" : ""}>Inactivo</option>
                  </select>
                </label>
                ${
                  String(user.role || "") !== "tenant"
                    ? `<label>
                        Alcance
                        <select data-user-owner-scope ${isCurrentUser || user.role === "superadmin" ? "disabled" : ""}>
                          <option value="all" ${normalizeOwnerScope(user.ownerScope) === "all" ? "selected" : ""}>Toda La Casona</option>
                          <option value="enzo" ${normalizeOwnerScope(user.ownerScope) === "enzo" ? "selected" : ""}>Enzo</option>
                          <option value="ivo" ${normalizeOwnerScope(user.ownerScope) === "ivo" ? "selected" : ""}>Ivo</option>
                        </select>
                      </label>`
                    : ""
                }
                <button class="primary-action small-button" type="button" data-save-user-access="${user.id}" ${isCurrentUser ? "disabled" : ""}>
                  Guardar permisos
                </button>
                <button class="ghost-action hard-danger-action small-button" type="button" data-delete-user-access="${user.id}" ${isCurrentUser ? "disabled" : ""}>
                  Eliminar usuario
                </button>
              </div>
            </article>
          `;
        })
        .join("")
    : buildEmptyState("Todavía no hay usuarios para administrar.");
}

async function writeAuditLog(input) {
  try {
    const writeLog = httpsCallable(functions, "writeAuditLog");
    await writeLog(input);
  } catch (error) {
    console.error("No se pudo registrar auditoría", error);
  }
}

function renderTenantPortal() {
  if (
    !elements.tenantCurrentCharge
    || !elements.tenantTransferAccount
    || !elements.tenantPaymentHistory
    || !elements.tenantReceiptHistory
    || !elements.tenantBillList
  ) {
    return;
  }

  const shouldShowTenantBills = canTenantSeeBills();

  if (elements.tenantFacturasNav) {
    elements.tenantFacturasNav.classList.remove("hidden");
  }

  const facturasSection = document.querySelector('.view-section[data-section="facturas"][data-tenant-only="true"]');
  if (facturasSection) {
    facturasSection.classList.remove("hidden");
  }

  const tenantActionableCharges = state.charges.filter((charge) =>
    canTenantSubmitReceiptForCharge(charge)
  );
  const currentCharge = [...state.charges]
    .sort((a, b) => String(b.period).localeCompare(String(a.period)))
    .find((charge) => canTenantSubmitReceiptForCharge(charge)) || state.charges[0];
  const transferAccount = resolveTransferAccount(state.currentProperty);
  const currentChargeVisualStatus = currentCharge ? getChargeVisualStatus(currentCharge) : null;
  const canSubmitReceipt = canTenantSubmitReceiptForCharge(currentCharge);
  const overdueTag = currentCharge?.overdueDays
    ? `<span class="status ${currentCharge.overdueDays >= resolveGeneralSettings().morosoAfterDays ? "danger" : "warning"}">${currentCharge.overdueDays} dias de atraso</span>`
    : "";

  elements.tenantCurrentCharge.innerHTML = currentCharge
    ? `
        <article class="entity-card charge-card">
          <div class="charge-main">
            <p class="section-label">${currentCharge.period}</p>
            <h4>Total actual ${formatCurrency(currentCharge.total ?? 0)}</h4>
            <p>Vence ${formatDate(currentCharge.dueDate)}</p>
            <div class="charge-tags">
              <span class="status ${currentChargeVisualStatus.className}">${currentChargeVisualStatus.label}</span>
              ${overdueTag}
            </div>
            <div class="charge-breakdown">
              ${buildChargeBreakdownRows(currentCharge)}
              <div class="charge-breakdown-row">
                <span>Subtotal</span>
                <strong>${formatCurrency(currentCharge.subtotal ?? 0)}</strong>
              </div>
              <div class="charge-breakdown-row ${Number(currentCharge.lateFeeAmount ?? 0) > 0 ? "late-fee-row" : ""}">
                <span>Mora acumulada</span>
                <strong>${formatCurrency(currentCharge.lateFeeAmount ?? 0)}</strong>
              </div>
              <div class="charge-breakdown-row total-row">
                <span>Total a pagar</span>
                <strong>${formatCurrency(currentCharge.total ?? 0)}</strong>
              </div>
            </div>
            ${resolveChargeExpenseAmount(currentCharge) > 0 ? `<p class="token-detail-note">Resumen del período: ${formatCurrency(resolveChargeRentAmount(currentCharge))} de alquiler + ${formatCurrency(resolveChargeExpenseAmount(currentCharge))} de expensas.</p>` : ""}
          </div>
          <div class="charge-meta">
                ${
                  canSubmitReceipt
                    ? `<div class="entity-card-actions payment-card-actions stacked-actions">
                      <button class="primary-action transfer-action small-button" type="button" data-transfer-toggle="true">Pagar por transferencia</button>
                      <div class="transfer-details hidden" data-transfer-details="true">
                        <p>Titular: ${transferAccount?.holderName || "Sin definir"}</p>
                        <p>Alias: ${transferAccount?.alias || "Sin definir"}</p>
                        <p>CBU: ${transferAccount?.cbu || "Sin definir"}</p>
                      </div>
                      <button class="primary-action mp-action small-button" type="button" data-pay-card="${currentCharge.id}">Pago con tarjeta</button>
                      <div class="payment-warning">
                        El link de Mercado Pago es de uso exclusivo para pagos con tarjetas de débito/crédito.
                      </div>
                      <button class="ghost-action small-button instructions-action" type="button" data-payment-instructions-toggle="true">Instrucciones para pagar</button>
                      </div>`
                  : ""
              }
              ${
                currentCharge.status === "in_review"
                  ? `<p class="status-copy">Tu comprobante ya fue enviado y esta en revisión administrativa.</p>`
                  : ""
              }
              ${
                currentCharge.status === "paid"
                  ? `<p class="status-copy">Tu pago ya fue aprobado. No necesitas volver a subir comprobantes.</p>`
                  : ""
              }
            </div>
          </article>
        `
    : buildEmptyState("Todavía no hay cobros asignados a tu cuenta.");
  elements.tenantTransferAccount.innerHTML = !currentCharge
    ? ""
    : currentCharge.status === "paid"
      ? buildEmptyState("Ya confirmamos tu ultimo pago. Si necesitas el respaldo, puedes verlo en Mis pagos.")
      : currentCharge.status === "in_review"
        ? buildEmptyState("Tu comprobante ya fue enviado y esta esperando revisión administrativa.")
        : "";

  elements.tenantPaymentHistory.innerHTML = state.payments.length
    ? [...state.payments]
        .sort((a, b) => sortByCreatedAtDesc(a, b))
        .map((payment) => {
          const rentReceipt = state.rentReceipts.find((receipt) => receipt.paymentId === payment.id);
          const approvalDate = resolveDisplayDate(
            payment.approvedAt
            ?? payment.providerConfirmedAt
            ?? payment.paidAt
          );
          return `
            <article class="entity-card">
              <div>
                <h4>${formatCurrency(payment.amountReported ?? payment.amountConfirmed ?? 0)}</h4>
                <p>${humanizePaymentMethod(payment.method)} - ${humanizePaymentStatus(payment.status)}</p>
                ${
                  approvalDate && ["approved", "provider_confirmed"].includes(String(payment.status || ""))
                    ? `<p>Pago aprobado el ${formatDateTime(approvalDate)}</p>`
                    : ""
                }
                <p>${payment.reviewNotes || "Sin novedades por ahora."}</p>
                ${
                  payment.method === "mercado_pago"
                    ? `<p>Respuesta de Mercado Pago: ${payment.mercadoPagoStatus || "pendiente"}</p>`
                    : ""
                }
                ${
                  rentReceipt
                    ? `<p>Recibo emitido: ${humanizeRentReceiptStatus(rentReceipt.status)}.</p>
                       ${rentReceipt.pdfUrl ? `<button class="ghost-action small-button" type="button" data-view-rent-receipt="${rentReceipt.pdfUrl}">Ver recibo</button>` : ""}`
                    : ""
                }
              </div>
            </article>
          `;
        })
        .join("")
    : buildEmptyState("Todavía no hay pagos registrados.");

  elements.tenantChargeSelect.innerHTML = tenantActionableCharges.length
    ? tenantActionableCharges
        .map(
          (charge) =>
            `<option value="${charge.id}">${charge.period} - ${formatCurrency(charge.total ?? 0)}</option>`
        )
        .join("")
    : `<option value="">No hay cobros disponibles</option>`;

  if (tenantActionableCharges.length) {
    const selectedCharge = tenantActionableCharges[0];
    elements.tenantPaymentAmount.value = Number(selectedCharge.total ?? 0);
  } else if (currentCharge) {
    elements.tenantPaymentAmount.value = Number(currentCharge.total ?? 0);
  }

  if (elements.tenantPaymentForm) {
    elements.tenantPaymentForm.classList.toggle("hidden", !tenantActionableCharges.length);
  }

  if (elements.tenantSettingsEmail) {
    elements.tenantSettingsEmail.value = state.authUser?.email || state.currentTenant?.email || "";
  }

  if (elements.tenantSettingsPhone) {
    elements.tenantSettingsPhone.value = state.currentTenant?.phone || "";
  }

  elements.tenantReceiptHistory.innerHTML = state.receipts.length
    ? state.receipts
        .map(
          (receipt, index) => `
            <article class="entity-card">
              <div>
                <h4>${receipt.fileName || `Comprobante ${index + 1}`}</h4>
                <p>${humanizeReceiptStatus(receipt.claudeExtractionStatus)}</p>
                <p>${humanizeReceiptSuggestion(receipt.reviewSuggestion)}</p>
                <p>${receipt.detectedDocumentType ? `Tipo detectado: ${humanizeReceiptDocumentType(receipt.detectedDocumentType)}` : "Tipo detectado: pendiente"}</p>
                <p>${
                  receipt.detectedAmount
                    ? `Monto detectado: ${formatCurrency(receipt.detectedAmount)}`
                    : "Monto detectado: pendiente"
                }</p>
                <p>${receipt.detectedPaidAt ? `Fecha y hora detectadas: ${formatDateTime(receipt.detectedPaidAt)}` : receipt.detectedDate ? `Fecha detectada: ${formatDate(receipt.detectedDate)}` : "Fecha detectada: pendiente"}</p>
                <p>${receipt.detectedDestination ? `Destino detectado: ${receipt.detectedDestination}` : "Destino detectado: pendiente"}</p>
                <p>${receipt.extractionSummary || "Sin resumen de lectura todavía."}</p>
                <a class="entity-link" href="${receipt.downloadURL}" target="_blank" rel="noreferrer">Abrir archivo</a>
              </div>
            </article>
          `
        )
        .join("")
    : buildEmptyState("Todavía no subiste comprobantes.");

  const tenantBills = shouldShowTenantBills
    ? state.utilityBills
        .filter((bill) => billAppliesToProperty(bill, state.currentProperty))
        .sort((a, b) => String(b.period || "").localeCompare(String(a.period || "")))
    : [];
  const tenantRentReceipts = [...state.rentReceipts].sort((a, b) => sortByCreatedAtDesc(a, b));
  const activeDocTab = state.tenantDocumentTab || "receipts";
  const receiptCards = tenantRentReceipts.length
    ? tenantRentReceipts
        .map((receipt) => `
          <article class="entity-card tenant-doc-card">
            <div>
              <div class="comprobante-status-row">
                <p class="section-label">${formatPeriod(receipt.period || "")}</p>
                <span class="status ${rentReceiptStatusTone(receipt.status, receipt.emailStatus)}">${humanizeRentReceiptStatus(receipt.status)}</span>
              </div>
              <h4>${receipt.receiptNumber || "Recibo emitido"}</h4>
              <p>${receipt.apartmentLabel || state.currentProperty?.name || "Unidad"}</p>
              <p>Monto: ${formatCurrency(receipt.amount ?? 0)}</p>
              <p>Fecha de emisión: ${formatDateTime(receipt.issuedAt)}</p>
              <p>Código de verificación: ${receipt.verificationCode || "sin código"}</p>
              <p>Estado: ${humanizeRentReceiptStatus(receipt.status)}</p>
              ${receipt.pdfUrl ? `<button class="ghost-action small-button" type="button" data-view-rent-receipt="${receipt.pdfUrl}">Ver recibo</button>` : ""}
            </div>
          </article>
        `)
        .join("")
    : buildEmptyState("Todavía no hay recibos de alquiler emitidos para tu cuenta.");
  const serviceCards = tenantBills.length
    ? tenantBills
        .map(
          (bill) => `
            <article class="entity-card tenant-doc-card">
              <div>
                <p class="section-label">${bill.period || "Sin período"}</p>
                <h4>${bill.serviceType === "electricity" ? "Boleta de luz" : "Boleta de agua"}</h4>
                <p>${humanizeBillingGroup(bill.billingGroup)}</p>
                <p>${bill.amount ? `Monto: ${formatCurrency(bill.amount)}` : "Monto pendiente de lectura"}</p>
                <p>${bill.dueDate ? `Vence ${formatDate(bill.dueDate)}` : "Vencimiento pendiente de lectura"}</p>
                <a class="entity-link" href="${bill.downloadURL}" target="_blank" rel="noreferrer">Ver factura</a>
              </div>
            </article>
          `
        )
        .join("")
    : buildEmptyState("Por el momento no hay facturas de servicios cargadas en el sistema. Si corresponde, recibirás las facturas de luz, agua u otros servicios por los canales habituales.");

  const tenantDocTabs = facturasSection?.querySelector("[data-tenant-doc-tabs]");
  if (tenantDocTabs) {
    tenantDocTabs.querySelectorAll("[data-tenant-doc-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.tenantDocTab === activeDocTab);
    });
  }

  elements.tenantBillList.innerHTML = activeDocTab === "services" ? serviceCards : receiptCards;
}

function canTenantSeeBills() {
  if (isAdminRole()) {
    return true;
  }

  if (!state.currentProperty) {
    return false;
  }

  const unitType = String(state.currentProperty?.unitType || "");
  return unitType !== "Departamento";
}

function getActiveSectionName() {
  const activeSection = Array.from(elements.sections).find((section) => section.classList.contains("active"));
  return activeSection?.dataset.section || "";
}

function setActiveSection(sectionName, options = {}) {
  if (!elements.navItems.length || !elements.sections.length) {
    return;
  }

  const { replaceHistory = false, skipHistory = false } = options;
  const targetSection = elements.sections.find((section) => section.dataset.section === sectionName);
  if (!targetSection) {
    return;
  }

  const currentSection = getActiveSectionName();
  if (replaceHistory) {
    state.sectionHistory = [sectionName];
  } else if (!skipHistory) {
    if (!state.sectionHistory.length) {
      if (currentSection) {
        state.sectionHistory.push(currentSection);
      }
    }
    if (currentSection !== sectionName && state.sectionHistory[state.sectionHistory.length - 1] !== sectionName) {
      state.sectionHistory.push(sectionName);
    }
    if (!state.sectionHistory.length) {
      state.sectionHistory.push(sectionName);
    }
  }

  state.activeSection = sectionName;

  elements.navItems.forEach((button) => {
    const match = button.dataset.navTarget === sectionName;
    button.classList.toggle("active", match);
  });

  elements.sections.forEach((section) => {
    section.classList.toggle("active", section.dataset.section === sectionName);
  });

  setMobileNavOpen(false);
  updateSectionBackButton();
}

function resetCollections() {
  state.currentTenant = null;
  state.currentProperty = null;
  state.properties = [];
  state.tenants = [];
  state.utilityBills = [];
  state.charges = [];
  state.payments = [];
  state.receipts = [];
  state.rentReceipts = [];
  state.chargePeriodSelections = {};
  state.auditLogs = [];
  state.users = [];
  state.messages = [];
  state.generalSettings = null;
  state.bankAccounts = null;
  state.sectionHistory = [];
  state.activeSection = "";
}

function clearSubscriptions() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
}

function getLastSessionActivityAt() {
  try {
    const raw = window.localStorage.getItem(SESSION_IDLE_STORAGE_KEY);
    return raw ? Number(raw) : 0;
  } catch (error) {
    console.warn("No se pudo leer la última actividad de sesión.", error);
    return 0;
  }
}

function setLastSessionActivityAt(timestamp) {
  try {
    window.localStorage.setItem(SESSION_IDLE_STORAGE_KEY, String(timestamp));
  } catch (error) {
    console.warn("No se pudo guardar la actividad de sesión.", error);
  }
}

function isSessionIdleExpired(now = Date.now()) {
  const lastActivityAt = getLastSessionActivityAt();
  if (!lastActivityAt) {
    return false;
  }

  return now - lastActivityAt >= SESSION_IDLE_LIMIT_MS;
}

function stampSessionActivity(force = false) {
  const now = Date.now();
  if (!force && now - state.lastActivityWriteAt < SESSION_IDLE_WRITE_THROTTLE_MS) {
    return;
  }

  state.lastActivityWriteAt = now;
  setLastSessionActivityAt(now);
}

async function handleSessionActivity() {
  if (!state.authUser) {
    return;
  }

  if (isSessionIdleExpired()) {
    await signOut(auth);
    return;
  }

  stampSessionActivity();
}

function startSessionIdleMonitor() {
  if (!state.sessionIdleMonitorBound) {
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((eventName) => {
      window.addEventListener(eventName, handleSessionActivity, { passive: true });
    });

    document.addEventListener("visibilitychange", handleSessionActivity);
    state.sessionIdleMonitorBound = true;
  }

  if (state.sessionTimeoutCheckTimer) {
    window.clearInterval(state.sessionTimeoutCheckTimer);
  }

  state.sessionTimeoutCheckTimer = window.setInterval(async () => {
    if (!state.authUser) {
      return;
    }

    if (isSessionIdleExpired()) {
      await signOut(auth);
    }
  }, 60000);
}

function stopSessionIdleMonitor() {
  if (state.sessionIdleMonitorBound) {
    const events = ["pointerdown", "keydown", "touchstart"];
    events.forEach((eventName) => {
      window.removeEventListener(eventName, handleSessionActivity);
    });
    document.removeEventListener("visibilitychange", handleSessionActivity);
    state.sessionIdleMonitorBound = false;
  }

  if (state.sessionTimeoutCheckTimer) {
    window.clearInterval(state.sessionTimeoutCheckTimer);
    state.sessionTimeoutCheckTimer = null;
  }

  state.lastActivityWriteAt = 0;
}

function isAdminRole() {
  return state.role === "admin" || state.role === "superadmin";
}

function isSuperadminRole() {
  return state.role === "superadmin";
}

function normalizeOwnerScope(value) {
  const scope = String(value || "").trim().toLowerCase();
  if (scope === "enzo" || scope === "ivo") {
    return scope;
  }

  return "all";
}

function transferBlockToOwnerScope(value) {
  return String(value || "").trim() === "block_2" ? "ivo" : "enzo";
}

function normalizeOwnerLabel(scope) {
  const labels = {
    all: "Toda La Casona",
    enzo: "Enzo",
    ivo: "Ivo"
  };

  return labels[normalizeOwnerScope(scope)] || "La Casona";
}

function getCurrentOwnerScope() {
  if (state.role === "superadmin") {
    return "all";
  }

  if (state.role === "admin") {
    return normalizeOwnerScope(state.profile?.ownerScope);
  }

  return "all";
}

function resolvePropertyOwnerScope(property) {
  if (!property) {
    return "all";
  }

  const explicitScope = normalizeOwnerScope(property.ownerScope);
  if (explicitScope === "enzo" || explicitScope === "ivo") {
    return explicitScope;
  }

  const ownerId = String(property.ownerId || "").trim().toLowerCase();
  if (ownerId === "owner_block_1" || ownerId === "enzo") {
    return "enzo";
  }
  if (ownerId === "owner_block_2" || ownerId === "ivo") {
    return "ivo";
  }

  return transferBlockToOwnerScope(property.transferBlock || inferTransferBlockFromUnitCode(property.unitCode));
}

function canCurrentAdminSeeOwner(scope) {
  if (!isAdminRole()) {
    return true;
  }

  const currentScope = getCurrentOwnerScope();
  return currentScope === "all" || normalizeOwnerScope(scope) === currentScope;
}

function getScopedProperties() {
    const visibleProperties = isAdminRole()
      ? state.properties.filter((property) => canCurrentAdminSeeOwner(resolvePropertyOwnerScope(property)))
      : state.properties;

    return [...visibleProperties].sort(comparePropertiesByDisplayOrder);
  }

  function comparePropertiesByDisplayOrder(left, right) {
    const leftOrder = resolvePropertyDisplayOrder(left);
    const rightOrder = resolvePropertyDisplayOrder(right);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return String(left?.name || "").localeCompare(String(right?.name || ""), "es", { numeric: true, sensitivity: "base" });
  }

  function resolvePropertyDisplayOrder(property) {
    const explicitSortOrder = Number(property?.sortOrder);
    if (Number.isFinite(explicitSortOrder) && explicitSortOrder > 0) {
      return explicitSortOrder;
    }

    const unitCodeMatch = String(property?.unitCode || "").match(/\d+/);
    if (unitCodeMatch) {
      return Number(unitCodeMatch[0]);
    }

    const nameMatch = String(property?.name || "").match(/\d+/);
    if (nameMatch) {
      return Number(nameMatch[0]);
    }

    return Number.MAX_SAFE_INTEGER;
  }

function getScopedTenants() {
  const scopedPropertyIds = new Set(getScopedProperties().map((property) => property.id));
  return isAdminRole()
    ? state.tenants.filter((tenant) => scopedPropertyIds.has(tenant.propertyId))
    : state.tenants;
}

function getScopedCharges() {
  const scopedPropertyIds = new Set(getScopedProperties().map((property) => property.id));
  return isAdminRole()
    ? state.charges.filter((charge) => scopedPropertyIds.has(charge.propertyId))
    : state.charges;
}

function getScopedPayments() {
  const scopedChargeIds = new Set(getScopedCharges().map((charge) => charge.id));
  const scopedTenantIds = new Set(getScopedTenants().map((tenant) => tenant.id));
  return isAdminRole()
    ? state.payments.filter((payment) => scopedChargeIds.has(payment.chargeId) || scopedTenantIds.has(payment.tenantId))
    : state.payments;
}

function getScopedReceipts() {
  const scopedTenantIds = new Set(getScopedTenants().map((tenant) => tenant.id));
  return isAdminRole()
    ? state.receipts.filter((receipt) => scopedTenantIds.has(receipt.tenantId))
    : state.receipts;
}

function getScopedRentReceipts() {
  const scopedTenantIds = new Set(getScopedTenants().map((tenant) => tenant.id));
  return isAdminRole()
    ? state.rentReceipts.filter((receipt) => scopedTenantIds.has(receipt.tenantId))
    : state.rentReceipts;
}

function getScopedMessages() {
  const scopedTenantIds = new Set(getScopedTenants().map((tenant) => tenant.id));
  return isAdminRole()
    ? state.messages.filter((message) => scopedTenantIds.has(message.tenantId))
    : state.messages;
}

function getScopedAuditLogs() {
  const scopedTenantIds = new Set(getScopedTenants().map((tenant) => tenant.id));
  const scopedChargeIds = new Set(getScopedCharges().map((charge) => charge.id));
  const scopedPaymentIds = new Set(getScopedPayments().map((payment) => payment.id));

  if (!isAdminRole()) {
    return state.auditLogs;
  }

  if (isSuperadminRole()) {
    return state.auditLogs;
  }

  return state.auditLogs.filter((log) => {
    if (log.entityType === "tenant") {
      return scopedTenantIds.has(log.entityId);
    }
    if (log.entityType === "charge") {
      return scopedChargeIds.has(log.entityId);
    }
    if (log.entityType === "payment" || log.entityType === "receipt") {
      return scopedPaymentIds.has(log.entityId)
        || scopedTenantIds.has(log.metadata?.tenantId)
        || scopedChargeIds.has(log.metadata?.chargeId);
    }
    if (log.entityType === "settings" || log.entityType === "user") {
      return false;
    }

    return true;
  });
}

function getScopedUtilityBills() {
  if (!isAdminRole()) {
    return state.utilityBills;
  }

  const currentScope = getCurrentOwnerScope();
  if (currentScope === "all") {
    return state.utilityBills;
  }

  return state.utilityBills.filter((bill) => {
    const billingGroup = String(bill.billingGroup || "");
    if (billingGroup === "water_house") {
      return currentScope === "enzo";
    }
    if (billingGroup.startsWith("electricity_local_") || billingGroup === "water_locals_2_3") {
      return currentScope === "ivo";
    }
    if (billingGroup === "electricity_house") {
      return currentScope === "enzo";
    }
    if (billingGroup === "electricity_departments" || billingGroup === "water_departments_local_1") {
      return currentScope === "enzo" || currentScope === "ivo";
    }

    return true;
  });
}

function renderAdminSettings() {
  if (!elements.adminSettingsForm || !isAdminRole()) {
    return;
  }

  ensureAdminDefaultRentFields();
  const bankAccounts = resolveBankAccounts();
  const generalSettings = resolveGeneralSettings();
  const defaultRentDepartamentoField = document.querySelector("#admin-default-rent-departamento");
  const defaultRentCasaField = document.querySelector("#admin-default-rent-casa");
  const defaultRentLocalField = document.querySelector("#admin-default-rent-local");

  elements.adminSettingsName.value = state.profile?.displayName || state.authUser?.email?.split("@")[0] || "";
  elements.adminSettingsEmail.value = state.authUser?.email || state.profile?.email || "";
  elements.adminSettingsPhone.value = state.profile?.phone || "";
  elements.adminGeneralDueDay.value = String(generalSettings.dueDayOfMonth);
  elements.adminGeneralLateFeeRate.value = String(roundToTwo(generalSettings.lateFeeDailyRate * 100));
  elements.adminGeneralMorosoDays.value = String(generalSettings.morosoAfterDays);
  elements.adminDefaultNotificationChannel.value = generalSettings.defaultNotificationChannel;
  elements.adminAutoNotifyNewCharge.checked = generalSettings.autoNotifyNewCharge;
  elements.adminAutoNotifyOverdue.checked = generalSettings.autoNotifyOverdue;
  elements.adminRentAdjustmentPercent.value = generalSettings.lastRentAdjustmentPercent
    ? String(generalSettings.lastRentAdjustmentPercent)
    : "";
  if (defaultRentDepartamentoField) {
    defaultRentDepartamentoField.value = String(generalSettings.defaultRents.Departamento || 0);
  }
  if (defaultRentCasaField) {
    defaultRentCasaField.value = String(generalSettings.defaultRents.Casa || 0);
  }
  if (defaultRentLocalField) {
    defaultRentLocalField.value = String(generalSettings.defaultRents.Local || 0);
  }
  elements.adminBankBlock1Holder.value = bankAccounts.block_1.holderName;
  elements.adminBankBlock1Alias.value = bankAccounts.block_1.alias;
  elements.adminBankBlock1Cbu.value = bankAccounts.block_1.cbu;
  elements.adminBankBlock1Dni.value = bankAccounts.block_1.dni;
  elements.adminBankBlock1Email.value = bankAccounts.block_1.email;
  elements.adminBankBlock1Phone.value = bankAccounts.block_1.phone;
  elements.adminBankBlock2Holder.value = bankAccounts.block_2.holderName;
  elements.adminBankBlock2Alias.value = bankAccounts.block_2.alias;
  elements.adminBankBlock2Cbu.value = bankAccounts.block_2.cbu;
  elements.adminBankBlock2Dni.value = bankAccounts.block_2.dni;
  elements.adminBankBlock2Email.value = bankAccounts.block_2.email;
  elements.adminBankBlock2Phone.value = bankAccounts.block_2.phone;
  if (elements.messageChannelSelect) {
    elements.messageChannelSelect.value = generalSettings.defaultNotificationChannel;
  }
  applyAdminScopeToSettingsForm();
}

function ensureAdminDefaultRentFields() {
  const form = elements.adminSettingsForm;
  if (!form || form.querySelector("#admin-default-rent-panel")) {
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  const panel = document.createElement("section");
  panel.id = "admin-default-rent-panel";
  panel.className = "settings-subpanel";
  panel.innerHTML = `
    <h4>Valores actuales de alquiler</h4>
    <p class="panel-meta">
      Estos importes se usan como referencia operativa y como valor inicial para nuevos inquilinos por categoría.
    </p>
    <label>
      Departamento
      <input id="admin-default-rent-departamento" name="defaultRentDepartamento" type="number" min="0" step="0.01" />
    </label>
    <label>
      Casa
      <input id="admin-default-rent-casa" name="defaultRentCasa" type="number" min="0" step="0.01" />
    </label>
    <label>
      Local
      <input id="admin-default-rent-local" name="defaultRentLocal" type="number" min="0" step="0.01" />
    </label>
  `;

  submitButton?.insertAdjacentElement("beforebegin", panel);
}

function applyAdminScopeToSettingsForm() {
  if (!isAdminRole()) {
    return;
  }

  const currentScope = getCurrentOwnerScope();
  const form = elements.adminSettingsForm;
  const isScopedAdmin = currentScope !== "all";
  if (form) {
    let note = form.querySelector(".owner-scope-note");
    if (!note) {
      note = document.createElement("p");
      note.className = "owner-scope-note";
      form.querySelector("h4")?.insertAdjacentElement("afterend", note);
    }
    note.textContent = isScopedAdmin
      ? `Estás administrando únicamente la operación de ${normalizeOwnerLabel(currentScope)}. Los ajustes globales quedan reservados para superadmin.`
      : "Desde esta pantalla podés administrar parámetros globales y cuentas bancarias de ambos bloques.";
  }

  const generalPanel = elements.adminGeneralDueDay?.closest(".collapsible-panel");
  const block1Panel = elements.adminBankBlock1Holder?.closest(".settings-subpanel");
  const block2Panel = elements.adminBankBlock2Holder?.closest(".settings-subpanel");
  const block1Heading = block1Panel?.querySelector("h4");
  const block2Heading = block2Panel?.querySelector("h4");
  const togglePanel = (panel, shouldHide) => {
    if (!panel) {
      return;
    }
    panel.classList.toggle("hidden", shouldHide);
    panel.querySelectorAll("input, select, textarea").forEach((field) => {
      field.disabled = shouldHide;
    });
  };

  if (block1Heading) {
    block1Heading.textContent = "Cuenta bancaria de Enzo";
  }
  if (block2Heading) {
    block2Heading.textContent = "Cuenta bancaria de Ivo";
  }
  if (generalPanel) {
    generalPanel.classList.toggle("hidden", isScopedAdmin);
  }
  togglePanel(block1Panel, currentScope === "ivo");
  togglePanel(block2Panel, currentScope === "enzo");
  if (elements.adminRentAdjustmentButton) {
    elements.adminRentAdjustmentButton.disabled = isScopedAdmin;
  }
}

function mapDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

function setMessage(message, tone = "info") {
  if (!elements.message) {
    return;
  }
  elements.message.textContent = message;
  elements.message.dataset.tone = tone;
}

function setAuthPending(pending) {
  state.authPending = pending;
  const submitButton = elements.authForm?.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.textContent = pending ? "Ingresando..." : "Ingresar";
    submitButton.dataset.loading = pending ? "true" : "false";
  }
  [
    elements.authEmail,
    elements.authPassword,
    elements.registerButton,
    elements.tenantProfileButton,
    elements.resetPasswordButton,
    elements.bootstrapButton,
    ...elements.authForm.querySelectorAll("button, input")
  ].forEach((element) => {
    if (element) {
      element.disabled = pending;
    }
  });
}

function setTenantOnboardingPending(pending) {
  state.tenantOnboardingPending = pending;
  [
    ...elements.tenantOnboardingForm.querySelectorAll("button, input, select"),
    elements.tenantOnboardingBack
  ].forEach((element) => {
    if (element) {
      element.disabled = pending;
    }
  });
}

function setMobileNavOpen(isOpen) {
  document.body.classList.toggle("mobile-nav-open", isOpen);
  if (elements.mobileNavToggle) {
    elements.mobileNavToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }
  if (elements.mobileNavBackdrop) {
    elements.mobileNavBackdrop.classList.toggle("hidden", !isOpen);
  }
}

function setAuthMessage(message, tone = "info") {
  if (!elements.authMessage) {
    return;
  }
  elements.authMessage.textContent = message;
  elements.authMessage.dataset.tone = tone;
  elements.authMessage.classList.toggle("visible", Boolean(message));
}

function setTenantOnboardingMessage(message, tone = "info") {
  elements.tenantOnboardingMessage.textContent = message;
  elements.tenantOnboardingMessage.dataset.tone = tone;
}

function toggleCollapsibleSection(button) {
  const targetId = button.dataset.collapseToggle;
  const target = document.getElementById(targetId);
  const indicator = button.querySelector(".collapsible-indicator");

  if (!target) {
    return;
  }

  const willOpen = target.classList.contains("hidden");
  target.classList.toggle("hidden", !willOpen);
  button.setAttribute("aria-expanded", willOpen ? "true" : "false");

  if (indicator) {
    indicator.textContent = willOpen ? "-" : "+";
  }
}

function installMobileFocusAssist() {
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (
      window.innerWidth > 760 ||
      !(target instanceof HTMLElement) ||
      !target.matches("input, select, textarea")
    ) {
      return;
    }

    window.setTimeout(() => {
      target.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    }, 220);
  });
}

function buildEmptyState(message) {
  return `<article class="empty-state"><p>${message}</p></article>`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  }).format(Number(value ?? 0));
}

function formatDate(value) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-AR").format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  if (!value) {
    return "Sin fecha";
  }

  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function resolveDisplayDate(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }

  if (typeof value.seconds === "number") {
    return new Date(value.seconds * 1000).toISOString();
  }

  return "";
}

function humanizeChargeStatus(status) {
  const labels = {
    pending: "Pendiente",
    overdue: "Vencido",
    in_review: "En revisión",
    paid: "Pagado",
    cancelled: "Cancelado"
  };

  return labels[status] || "Sin estado";
}

function humanizePaymentStatus(status) {
  const labels = {
    reported: "Reportado",
    in_review: "En revisión",
    approved: "Aprobado",
    rejected: "Rechazado",
    provider_confirmed: "Confirmado",
    pending: "Pendiente"
  };

  return labels[status] || "Sin estado";
}

function humanizePaymentFinancialSyncStatus(status) {
  const labels = {
    synced: "Finanzas sincronizado",
    error: "Error al sincronizar finanzas"
  };

  return labels[status] || "Finanzas pendiente";
}

function humanizePaymentMethod(method) {
  const labels = {
    transfer: "Transferencia",
    mercado_pago: "Mercado Pago"
  };

  return labels[method] || "Metodo";
}

function paymentStatusTone(status) {
  const tones = {
    reported: "warning",
    in_review: "info",
    approved: "success",
    provider_confirmed: "success",
    rejected: "danger",
    pending: "neutral"
  };

  return tones[status] || "neutral";
}

function paymentFinancialSyncTone(status) {
  const tones = {
    synced: "success",
    error: "danger"
  };

  return tones[status] || "warning";
}

function humanizeRentReceiptStatus(status) {
  const labels = {
    generated: "Generado",
    sent: "Enviado",
    resent: "Reenviado",
    send_error: "Error de envio"
  };

  return labels[status] || "Generado";
}

function rentReceiptStatusTone(status, emailStatus) {
  if (emailStatus === "failed" || status === "send_error") {
    return "danger";
  }
  if (emailStatus === "sent" || status === "sent" || status === "resent") {
    return "success";
  }
  return "warning";
}

function humanizeMessageChannel(channel) {
  const labels = {
      auto: "Automatico",
      whatsapp: "WhatsApp",
      sms: "SMS",
      email: "Correo"
    };

  return labels[channel] || "Canal";
}

function humanizeMessageStatus(status) {
  const labels = {
    queued: "En cola",
    sent: "Enviado",
    failed: "Fallido",
    blocked: "Bloqueado"
  };

  return labels[status] || "Sin estado";
}

function humanizeMessageType(type) {
  const labels = {
      general: "Mensaje manual",
      period_available: "Nuevo período disponible",
      due_reminder: "Recordatorio",
      late_fee_notice: "Aviso por mora",
      profile_created: "Perfil creado",
      payment_in_review: "Pago en revisión",
      payment_approved: "Pago aprobado",
      payment_rejected: "Pago rechazado",
      contract_renewed: "Contrato renovado",
      contract_finalized: "Contrato finalizado"
    };

  return labels[type] || "Mensaje";
}

function buildMessageTemplate(template, tenant) {
  const tenantName = tenant?.fullName || "inquilino";
  const tenantCharge = state.charges
    .filter((charge) => charge.tenantId === tenant?.id)
    .sort((left, right) => String(right.period || "").localeCompare(String(left.period || "")))[0];
  const total = tenantCharge ? formatCurrency(tenantCharge.total ?? 0) : "el total informado";
  const dueDate = tenantCharge?.dueDate ? formatDate(tenantCharge.dueDate) : "la fecha informada";
  const contractDate = tenant?.contractEndDate ? formatDate(tenant.contractEndDate) : "la fecha informada";

  const templates = {
      period_available: {
        body: `Hola ${tenantName}, ya tenés disponible un nuevo período de pago en La Casona. Puedes ingresar a tu portal para revisar el detalle y elegir cómo abonarlo.`,
        helper: "Ideal para avisar que el cobro mensual ya fue generado y esta disponible."
      },
      due_reminder: {
        body: `Hola ${tenantName}, te recordamos que tu cobro actual vence el ${dueDate} por un total de ${total}. Si ya realizaste el pago, podes informarlo desde tu portal.`,
        helper: "Usa el total y vencimiento del cobro mas reciente del inquilino."
      },
      late_fee_notice: {
        body: `Hola ${tenantName}, tu cobro actual registra mora y su total actualizado es de ${total}. Te recomendamos revisarlo cuanto antes desde tu portal para evitar que siga acumulando interes.`,
        helper: "Sirve para avisar que el cobro ya paso a vencido o moroso."
      },
      payment_in_review: {
        body: `Hola ${tenantName}, recibimos tu comprobante de pago y ya quedó en revisión administrativa. Te avisaremos apenas se confirme.`,
        helper: "Sirve para avisar que el comprobante fue recibido correctamente."
    },
    payment_approved: {
      body: `Hola ${tenantName}, confirmamos tu pago correctamente. Tu cobro actual ya figura como pagado. Muchas gracias.`,
      helper: "Confirma al inquilino que el pago ya fue aprobado."
    },
    payment_rejected: {
      body: `Hola ${tenantName}, revisamos el comprobante enviado pero no pudimos validarlo correctamente. Por favor revisa monto, fecha y destino de la transferencia o comunicate con administración.`,
      helper: "Aclara que el comprobante no pudo ser validado y pide una nueva accion."
    },
    contract_renewed: {
      body: `Hola ${tenantName}, te confirmamos que tu contrato fue renovado hasta ${contractDate}. Si necesitas una copia o detalle adicional, podes responder este mensaje.`,
      helper: "Toma la fecha de contrato actualmente guardada para el inquilino."
    },
    contract_finalized: {
      body: `Hola ${tenantName}, te informamos que tu contrato quedó configurado para finalizar el ${contractDate}. Si necesitas coordinar los pasos siguientes, comunicate con administración.`,
      helper: "Sirve para informar una finalización ya cargada en el sistema."
    }
  };

  return templates[template] || {
    body: "",
    helper: "Elegí una plantilla para autocompletar el mensaje."
  };
}

function humanizeAuditAction(action) {
  const labels = {
    admin_settings_updated: "Configuración",
    user_permissions_updated: "Permisos",
    user_deleted: "Usuario eliminado",
    message_sent: "Mensaje enviado",
    contract_renewed: "Contrato renovado",
    contract_finalized: "Contrato finalizado",
    tenant_deactivated: "Baja de inquilino",
    tenant_deleted: "Eliminación definitiva",
    payment_link_created: "Link único",
    payment_approved: "Pago aprobado",
    payment_rejected: "Pago rechazado",
    receipt_generated: "Comprobante emitido",
    receipt_regenerated: "Comprobante regenerado",
    receipt_resent: "Comprobante reenviado"
  };

  return labels[action] || "Movimiento";
}

function humanizeAuditEntity(entityType) {
  const labels = {
    tenant: "Inquilino",
    payment: "Pago",
    charge: "Cobro",
    settings: "Configuración",
    receipt: "Comprobante",
    user: "Usuario"
  };

  return labels[entityType] || "Entidad";
}

function humanizeUserRole(role) {
  const labels = {
    superadmin: "Superadmin",
    admin: "Admin",
    tenant: "Inquilino"
  };

  return labels[role] || "Usuario";
}

function humanizeReceiptStatus(status) {
  const labels = {
    pending: "Pendiente de lectura",
    processed: "Procesado",
    failed: "No se pudo leer"
  };

  return labels[status] || "Pendiente de revisión";
}

function humanizeReceiptSuggestion(status) {
  const labels = {
    pending_manual_review: "Revisión manual pendiente",
    likely_match: "Coincidencia probable con el cobro",
    amount_mismatch: "Monto detectado distinto al cobro"
  };

  return labels[status] || "Sin sugerencia todavía";
}

function humanizeReceiptDocumentType(type) {
  const labels = {
    transfer_receipt: "Transferencia bancaria",
    cash_deposit_ticket: "Ticket de depósito bancario",
    bank_receipt: "Comprobante bancario",
    unknown: "Documento no identificado"
  };

  return labels[type] || "Documento no identificado";
}

function buildReceiptVerificationUrl(verificationCode) {
  if (!verificationCode) {
    return `${window.location.origin}/verificar-comprobante.html`;
  }

  return `${window.location.origin}/verificar-comprobante.html?code=${encodeURIComponent(verificationCode)}`;
}

function humanizeInvitationStatus(status) {
  const labels = {
    pending: "Pendiente",
    claimed: "Aceptada",
    not_sent: "Sin enviar"
  };

  return labels[status] || "Sin estado";
}

function humanizeTransferBlock(value, unitCode) {
  const labels = {
    block_1: "Bloque 1 - cobra Enzo",
    block_2: "Bloque 2 - cobra Ivo"
  };

  return labels[value] || `Bloque inferido desde unidad ${unitCode || "sin código"}`;
}

function humanizeAuthError(error) {
  const code = error?.code || "";
  const message = error?.message || "";

  if (code.includes("network-request-failed")) {
    return "Hubo un problema de conexión. Intenta nuevamente.";
  }

  if (code.includes("invalid-email")) {
    return "Ingresa un correo electrónico válido.";
  }

  if (code.includes("invalid-credential")) {
    return "Correo o contraseña incorrectos.";
  }

  if (code.includes("wrong-password")) {
    return "La contraseña es incorrecta.";
  }

  if (code.includes("too-many-requests")) {
    return "Hubo demasiados intentos. Espera un momento e intenta nuevamente.";
  }

  if (code.includes("email-already-in-use")) {
    return "Ese correo ya tiene una cuenta. Iniciá sesión con esa cuenta y usá Reclamar acceso para entrar al portal.";
  }

  if (code.includes("weak-password")) {
    return "La contraseña debe ser más segura.";
  }

  if (code.includes("already-exists")) {
    return "Esa propiedad o ese perfil ya no están disponibles.";
  }

  if (code.includes("unauthenticated")) {
    return "No pudimos validar la sesión para crear el perfil.";
  }

  if (message) {
    return message;
  }

  return "No se pudo completar la acción en Firebase.";
}

function humanizeFunctionError(error) {
  const code = error?.code || "";
  const message = error?.message || "";

  if (code.includes("permission-denied")) {
    return message || "No tienes permisos para realizar esta accion.";
  }

  if (code.includes("invalid-argument")) {
    return message || "Revisa los datos enviados e intenta nuevamente.";
  }

  if (code.includes("already-exists")) {
    return message || "Ese usuario ya existe o no puede reutilizarse asi.";
  }

  if (code.includes("unauthenticated")) {
    return "Tu sesión ya no es válida. Vuelve a ingresar.";
  }

  if (message) {
    return message;
  }

  return "No se pudo completar la accion solicitada.";
}

function sortByCreatedAtDesc(left, right) {
  const leftValue = resolveTimestamp(left.createdAt);
  const rightValue = resolveTimestamp(right.createdAt);
  return rightValue - leftValue;
}

function formatConfidence(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "";
  }

  return `${Math.round(value * 100)}%`;
}

function truncateText(value, maxLength = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function resolveGeneralSettings() {
  return {
      lateFeeDailyRate: Number(state.generalSettings?.lateFeeDailyRate ?? 0.001),
      reminderDaysBeforeDue: Number(state.generalSettings?.reminderDaysBeforeDue ?? 3),
      dueDayOfMonth: Number(state.generalSettings?.dueDayOfMonth ?? 10),
      morosoAfterDays: Number(state.generalSettings?.morosoAfterDays ?? 15),
      defaultNotificationChannel: String(state.generalSettings?.defaultNotificationChannel ?? "email"),
      autoNotifyNewCharge: state.generalSettings?.autoNotifyNewCharge !== false,
      autoNotifyOverdue: state.generalSettings?.autoNotifyOverdue !== false,
      lastRentAdjustmentPercent: Number(state.generalSettings?.lastRentAdjustmentPercent ?? 0),
      defaultRents: {
        Departamento: Number(state.generalSettings?.defaultRents?.Departamento ?? 0),
        Casa: Number(state.generalSettings?.defaultRents?.Casa ?? 0),
        Local: Number(state.generalSettings?.defaultRents?.Local ?? 0)
      }
    };
}

function getDefaultRentForUnitType(unitType) {
  const normalizedUnitType = String(unitType || "").trim();
  if (normalizedUnitType === "Departamento") {
    return 321680;
  }
  return Number(resolveGeneralSettings().defaultRents[normalizedUnitType] ?? 0);
}

function resolveDisplayedBaseRent(tenant, property, currentCharge = null) {
  const chargeRentAmount = resolveChargeRentAmount(currentCharge);
  if (chargeRentAmount > 0) {
    return chargeRentAmount;
  }

  const currentPeriod = resolveCurrentPeriodValue();
  const configuredCurrentBaseRent = Number(tenant?.rentUpdateConfig?.currentBaseRent ?? 0);
  const pendingBaseRent = Number(tenant?.rentUpdateConfig?.pendingBaseRent ?? tenant?.rentUpdateConfig?.nextBaseRent ?? 0);
  const billingEffectivePeriod = String(
    tenant?.rentUpdateConfig?.billingEffectivePeriod
      || addMonthsToPeriod(String(tenant?.rentUpdateConfig?.effectivePeriod ?? "").trim(), 1)
  ).trim();
  const explicitBaseRent = Number(tenant?.baseRent ?? 0);

  if (
    billingEffectivePeriod
    && billingEffectivePeriod > currentPeriod
    && Number.isFinite(configuredCurrentBaseRent)
    && configuredCurrentBaseRent > 0
  ) {
    return configuredCurrentBaseRent;
  }

  if (
    billingEffectivePeriod
    && billingEffectivePeriod <= currentPeriod
    && Number.isFinite(pendingBaseRent)
    && pendingBaseRent > 0
  ) {
    return pendingBaseRent;
  }

  if (Number.isFinite(explicitBaseRent) && explicitBaseRent > 0) {
    return explicitBaseRent;
  }

  return getDefaultRentForUnitType(property?.unitType);
}

function resolveChargeRentAmount(charge) {
  if (!charge || !Array.isArray(charge.items)) {
    return 0;
  }

  const rentItem = charge.items.find((item) => String(item?.key || "") === "rent");
  const rentAmount = Number(rentItem?.amount ?? 0);
  return Number.isFinite(rentAmount) && rentAmount > 0 ? rentAmount : 0;
}

function resolveChargeExpenseAmount(charge) {
  if (!charge || !Array.isArray(charge.items)) {
    return 0;
  }

  const expenseItem = charge.items.find((item) => String(item?.key || "") === "expenses");
  const expenseAmount = Number(expenseItem?.amount ?? 0);
  return Number.isFinite(expenseAmount) && expenseAmount > 0 ? expenseAmount : 0;
}

function buildChargeBreakdownRows(charge) {
  if (!charge) {
    return "";
  }

  const rentAmount = resolveChargeRentAmount(charge);
  const expenseAmount = resolveChargeExpenseAmount(charge);
  const utilityItems = Array.isArray(charge.items)
    ? charge.items.filter((item) => !["rent", "expenses"].includes(String(item?.key || "")))
    : [];

  const rows = [];
  if (rentAmount > 0) {
    rows.push(`
      <div class="charge-breakdown-row">
        <span>Alquiler</span>
        <strong>${formatCurrency(rentAmount)}</strong>
      </div>
    `);
  }
  if (expenseAmount > 0) {
    rows.push(`
      <div class="charge-breakdown-row">
        <span>Expensas</span>
        <strong>${formatCurrency(expenseAmount)}</strong>
      </div>
    `);
  }
  utilityItems.forEach((item) => {
    rows.push(`
      <div class="charge-breakdown-row">
        <span>${item.label || "Concepto"}</span>
        <strong>${formatCurrency(item.amount ?? 0)}</strong>
      </div>
    `);
  });

  return rows.join("");
}

function resolveCurrentPeriodValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function resolveSummaryPeriod(charges = []) {
  const currentPeriod = resolveCurrentPeriodValue();
  const availablePeriods = [...new Set(
    charges
      .map((charge) => String(charge?.period || "").trim())
      .filter(Boolean)
  )].sort((left, right) => right.localeCompare(left));

  if (!availablePeriods.length) {
    return currentPeriod;
  }

  if (availablePeriods.includes(currentPeriod)) {
    return currentPeriod;
  }

  return availablePeriods[0];
}

function addMonthsToPeriod(period, months) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period || "").trim());
  if (!match) {
    return "";
  }

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const shifted = new Date(year, monthIndex + months, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function roundToTwo(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function resolveTransferAccount(property) {
  if (!property) {
    return null;
  }

  const transferBlock = property.transferBlock || inferTransferBlockFromUnitCode(property.unitCode);
  const bankAccounts = resolveBankAccounts();

  if (transferBlock === "block_2") {
    return {
      title: "Bloque 2",
      holderName: bankAccounts.block_2.holderName,
      alias: bankAccounts.block_2.alias,
      cbu: bankAccounts.block_2.cbu,
      helpText: "Las unidades 7 al 12 transfieren a la cuenta de Ivo."
    };
  }

  return {
    title: "Bloque 1",
    holderName: bankAccounts.block_1.holderName,
    alias: bankAccounts.block_1.alias,
    cbu: bankAccounts.block_1.cbu,
    helpText: "Las unidades 1 al 6 transfieren a la cuenta de Enzo."
  };
}

function resolveBankAccounts() {
  return {
    block_1: {
      holderName: state.bankAccounts?.block_1?.holderName || "Enzo",
      alias: state.bankAccounts?.block_1?.alias || "ENZO.STEFANOFF",
      cbu: state.bankAccounts?.block_1?.cbu || "3110001211000017138077",
      dni: state.bankAccounts?.block_1?.dni || "44086381",
      email: state.bankAccounts?.block_1?.email || "",
      phone: state.bankAccounts?.block_1?.phone || ""
    },
    block_2: {
      holderName: state.bankAccounts?.block_2?.holderName || "Ivo",
      alias: state.bankAccounts?.block_2?.alias || "IVO.STEFANOFF2",
      cbu: state.bankAccounts?.block_2?.cbu || "3110001211001029834072",
      dni: state.bankAccounts?.block_2?.dni || "46147628",
      email: state.bankAccounts?.block_2?.email || "",
      phone: state.bankAccounts?.block_2?.phone || ""
    }
  };
}

function inferTransferBlockFromUnitCode(unitCode) {
  const match = String(unitCode || "").match(/\d+/);
  const number = match ? Number(match[0]) : NaN;
  return !Number.isNaN(number) && number >= 7 ? "block_2" : "block_1";
}

function getBillingGroups(serviceType) {
  if (serviceType === "water") {
    return [
      { value: "water_departments_local_1", label: "Agua - Departamentos + Local 1" },
      { value: "water_locals_2_3", label: "Agua - Locales 2 y 3" },
      { value: "water_house", label: "Agua - Casa" }
    ];
  }

  return [
    { value: "electricity_departments", label: "Luz - Departamentos (unificado)" },
    { value: "electricity_house", label: "Luz - Casa" },
    { value: "electricity_local_1", label: "Luz - Local 1" },
    { value: "electricity_local_2", label: "Luz - Local 2" },
    { value: "electricity_local_3", label: "Luz - Local 3" },
    { value: "electricity_local_4", label: "Luz - Local 4" }
  ];
}

function humanizeBillingGroup(value) {
  const match = getBillingGroups("electricity")
    .concat(getBillingGroups("water"))
    .find((group) => group.value === value);

  return match?.label || "Grupo sin definir";
}

function resolveTenantUtilityBillingGroups(property) {
  if (!property) return [];
  const unitType = String(property.unitType || "");
  const unitCode = String(property.unitCode || "");

  const groups = [];

  if (unitType === "Casa") {
    groups.push("electricity_house", "water_house");
  } else if (unitType === "Departamento") {
    groups.push("water_departments_local_1");
  } else if (unitType === "Local") {
    if (unitCode === "1") {
      groups.push("electricity_local_1", "water_departments_local_1");
    } else if (unitCode === "2") {
      groups.push("electricity_local_2", "water_locals_2_3");
    } else if (unitCode === "3") {
      groups.push("electricity_local_3", "water_locals_2_3");
    } else if (unitCode === "4") {
      groups.push("electricity_local_4");
    }
  }

  return groups;
}

function getTenantRentalStatus(tenantId) {
  const currentCharge = getPropertyCurrentCharge(tenantId);
  const generalSettings = resolveGeneralSettings();

  if (!currentCharge) {
    return { label: "Pendiente", className: "warning" };
  }

  const overdueDays = Number(currentCharge.overdueDays ?? 0);
  const status = String(currentCharge.status || "");

  if (status === "paid") {
    return { label: "Al día", className: "success" };
  }

  if (["in_review", "reported"].includes(status)) {
    return { label: "En revisión", className: "info" };
  }

  if (overdueDays >= generalSettings.morosoAfterDays) {
    return { label: "Moroso", className: "danger" };
  }

  if (status === "overdue" || overdueDays > 0) {
    return { label: "Vencido", className: "warning" };
  }

  return { label: "Pendiente", className: "warning" };
}

function getPropertyOccupancyStatus(property, tenant) {
  if (tenant) {
    return { label: "Ocupada", className: "success" };
  }

  if (String(property?.status || "").toLowerCase() === "maintenance") {
    return { label: "En mantenimiento", className: "warning" };
  }

  if (property?.status && String(property.status).toLowerCase() !== "active") {
    return { label: "No disponible", className: "danger" };
  }

  return { label: "Disponible", className: "neutral" };
}

function getPropertyCurrentCharge(tenantId) {
  const relevantCharges = state.charges
    .filter((charge) => charge.tenantId === tenantId && charge.status !== "cancelled")
    .sort((a, b) => {
      const priorityDifference = getPropertyChargePriority(b) - getPropertyChargePriority(a);
      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return resolveDateSortValue(a.dueDate) - resolveDateSortValue(b.dueDate);
    });

  return relevantCharges[0] || null;
}

function getOpenChargesForTenant(tenantId) {
  return state.charges
    .filter((charge) => charge.tenantId === tenantId && !["paid", "cancelled"].includes(String(charge.status || "")))
    .sort((left, right) => {
      const priorityDifference = getPropertyChargePriority(right) - getPropertyChargePriority(left);
      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return String(right.period || "").localeCompare(String(left.period || ""));
    });
}

function getPendingReviewPaymentForCharge(chargeId) {
  if (!chargeId) {
    return null;
  }

  return state.payments.find(
    (payment) => payment.chargeId === chargeId && ["reported", "in_review"].includes(String(payment.status || ""))
  ) || null;
}

function getTenantReceiptableCharges(tenantId) {
  const actionable = state.charges
    .filter((charge) => charge.tenantId === tenantId && ["pending", "overdue", "reported"].includes(String(charge.status || "")))
    .sort((left, right) => String(right.period || "").localeCompare(String(left.period || "")));

  if (actionable.length) {
    return actionable;
  }

  const currentCharge = getPropertyCurrentCharge(tenantId);
  if (currentCharge && !["paid", "cancelled"].includes(String(currentCharge.status || ""))) {
    return [currentCharge];
  }

  return [];
}

function getPropertyChargePriority(charge) {
  const generalSettings = resolveGeneralSettings();
  const overdueDays = Number(charge?.overdueDays ?? 0);

  if (["in_review", "reported"].includes(String(charge?.status || ""))) {
    return 6;
  }

  if (charge?.status === "paid") {
    return 1;
  }

  if (overdueDays >= generalSettings.morosoAfterDays) {
    return 5;
  }

  if (charge?.status === "overdue") {
    return 4;
  }

  if (["pending", "in_review", "reported"].includes(charge?.status)) {
    return 3;
  }

  return 2;
}

function resolveDateSortValue(value) {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }

  const timestamp = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function getChargeVisualStatus(charge) {
  const generalSettings = resolveGeneralSettings();
  const overdueDays = Number(charge?.overdueDays ?? 0);

  if (charge?.status === "paid") {
    return {
      label: "Pagado",
      className: "success",
      helpText: "El cobro ya fue confirmado."
    };
  }

  if (charge?.status === "in_review") {
    return {
      label: "En revisión",
      className: "neutral",
      helpText: "Hay un pago informado esperando revisión administrativa."
    };
  }

  if (overdueDays >= generalSettings.morosoAfterDays) {
    return {
      label: "Moroso",
      className: "danger",
      helpText: `Supero el umbral de ${generalSettings.morosoAfterDays} dias configurado para morosidad.`
    };
  }

  if (charge?.status === "overdue" || overdueDays > 0) {
    return {
      label: "Vencido",
      className: "warning",
      helpText: "El cobro vencio y ya esta acumulando mora."
    };
  }

  return {
    label: "Pendiente",
    className: "neutral",
    helpText: "Todavía esta dentro de fecha o sin atraso acumulado."
  };
}

function canTenantSubmitReceiptForCharge(charge) {
  if (!charge) {
    return false;
  }

  const status = String(charge.status || "");
  return !["paid", "in_review", "cancelled"].includes(status);
}

function getTenantContractStatus(tenant) {
  if (tenant?.status === "finishing" || tenant?.contractStatus === "ending") {
    return { label: "Contrato por finalizar", className: "warning" };
  }

  if (tenant?.contractStatus === "renewed") {
    return { label: "Contrato renovado", className: "success" };
  }

  if (tenant?.status && tenant.status !== "active") {
    return { label: "Contrato inactivo", className: "danger" };
  }

  return { label: "Contrato vigente", className: "neutral" };
}

function describeTenantContract(tenant) {
  const formattedDate = formatDate(tenant?.contractEndDate);

  if (tenant?.status === "finishing" || tenant?.contractStatus === "ending") {
    return `Contrato configurado para finalizar el ${formattedDate}`;
  }

  if (tenant?.contractStatus === "renewed") {
    return `Contrato renovado hasta ${formattedDate}`;
  }

  return `Contrato hasta ${formattedDate}`;
}

function getTenantPunctuality(tenantId) {
  const paidCharges = state.charges.filter(
    (charge) => charge.tenantId === tenantId && charge.status === "paid"
  );

  if (!paidCharges.length) {
    return "Puntualidad: sin historial";
  }

  const onTimeCount = paidCharges.filter((charge) => {
    const paidAt = resolveTimestamp(charge.paidAt);
    const dueAt = new Date(`${charge.dueDate}T23:59:59`).getTime();
    return paidAt > 0 && paidAt <= dueAt;
  }).length;

  const score = Math.round((onTimeCount / paidCharges.length) * 100);
  return `Puntualidad: ${score}%`;
}

function billAppliesToProperty(bill, property) {
  if (!bill || !property) {
    return false;
  }

  const unitType = String(property.unitType || "");
  const unitCode = String(property.unitCode || "");
  const billGroup = String(bill.billingGroup || "");

  if (billGroup === "electricity_departments") {
    return false;
  }

  if (billGroup === "electricity_house") {
    return unitType === "Casa";
  }

  if (billGroup.startsWith("electricity_local_")) {
    return unitType === "Local" && unitCode === billGroup.replace("electricity_local_", "");
  }

  if (billGroup === "water_departments_local_1") {
    return unitType === "Departamento" || (unitType === "Local" && unitCode === "1");
  }

  if (billGroup === "water_locals_2_3") {
    return unitType === "Local" && ["2", "3"].includes(unitCode);
  }

  if (billGroup === "water_house") {
    return unitType === "Casa";
  }

  return false;
}

function canAutoApplyBillToProperty(bill) {
  const billGroup = String(bill?.billingGroup || "");

  return [
    "electricity_house",
    "electricity_local_1",
    "electricity_local_2",
    "electricity_local_3",
    "electricity_local_4",
    "water_house"
  ].includes(billGroup);
}

function describeBillChargePolicy(bill) {
  const billGroup = String(bill?.billingGroup || "");

  if (billGroup === "electricity_departments") {
    return "Los departamentos pagan esta boleta de luz por su cuenta. No se muestra en su portal ni se suma al cobro.";
  }

  return canAutoApplyBillToProperty(bill)
    ? "Se puede sumar automaticamente al cobro."
    : "Este grupo requiere distribucion manual antes de sumarse al cobro.";
}

function resolveTimestamp(value) {
  if (!value) {
    return 0;
  }

  if (typeof value === "string") {
    return new Date(value).getTime();
  }

  if (typeof value.seconds === "number") {
    return value.seconds * 1000;
  }

  return 0;
}
