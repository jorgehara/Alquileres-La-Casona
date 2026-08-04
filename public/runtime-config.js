(function initLaCasonaRuntime(global) {
  const ALLOWED_FUNCTIONS = new Set([
    "resolvePaymentAccessToken",
    "createCheckoutFromPaymentAccessToken",
    "submitTransferFromPaymentAccessToken",
    "verifyPaymentReceipt"
  ]);

  const DEFAULT_REGION = "us-central1";
  const LOCAL_PROJECT_ID = "demo-alquileres-la-casona";
  const PRODUCTION_PROJECT_ID = "alquileres-la-casona";
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);
  const REQUIRED_FIREBASE_FIELDS = ["apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId"];
  const REQUIRED_EMULATOR_PORTS = ["authPort", "firestorePort", "storagePort", "functionsPort"];

  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || "").trim().replace(/\/+$/, "");
  }

  function appendParams(url, params) {
    const searchParams = new URLSearchParams();

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        searchParams.set(key, String(value));
      }
    });

    const queryString = searchParams.toString();
    return queryString ? `${url}?${queryString}` : url;
  }

  function createRuntimeError(message, details = {}) {
    const error = new Error(message);
    error.name = "LaCasonaRuntimeError";
    error.details = {
      origin: global.location?.origin || "unknown",
      ...details
    };
    return error;
  }

  function isLocalHost(hostname = global.location?.hostname || "") {
    return LOCAL_HOSTS.has(String(hostname).toLowerCase());
  }

  function getRequestedMode() {
    try {
      return new URLSearchParams(global.location?.search || "").get("firebaseMode") || "";
    } catch (_) {
      return "";
    }
  }

  function getRawConfig() {
    return global.__LA_CASONA_PUBLIC_CONFIG__ || {
      mode: "production",
      production: {
        firebase: global.__FIREBASE_CONFIG__,
        emulators: { enabled: false },
        functions: {
          region: global.__FUNCTIONS_REGION__ || DEFAULT_REGION,
          baseUrl: global.__FUNCTIONS_BASE_URL__ || "",
          allowCloudFunctionsFallback: global.__ALLOW_CLOUDFUNCTIONS_FALLBACK__ === true
        }
      }
    };
  }

  function resolveMode(rawConfig = getRawConfig()) {
    const requestedMode = getRequestedMode();
    const configuredMode = rawConfig.mode || "production";

    if (requestedMode) {
      if (!["local", "production"].includes(requestedMode)) {
        throw createRuntimeError(`Modo Firebase no soportado: ${requestedMode}`, { field: "firebaseMode" });
      }
      if (requestedMode === "local" && !isLocalHost()) {
        throw createRuntimeError("El modo local solo puede activarse desde localhost/127.0.0.1.", {
          field: "firebaseMode",
          expected: "Abrí el sitio desde el Hosting Emulator"
        });
      }
      return requestedMode;
    }

    if (configuredMode === "auto") {
      return isLocalHost() ? "local" : "production";
    }

    if (!["local", "production"].includes(configuredMode)) {
      throw createRuntimeError(`Modo Firebase no soportado: ${configuredMode}`, { field: "mode" });
    }

    return configuredMode;
  }

  function getModeProfile(rawConfig = getRawConfig(), mode = resolveMode(rawConfig)) {
    const profile = rawConfig[mode] || rawConfig;
    return {
      mode,
      firebase: profile.firebase || rawConfig.firebase,
      emulators: profile.emulators || { enabled: false },
      functions: {
        region: profile.functions?.region || rawConfig.functions?.region || DEFAULT_REGION,
        baseUrl: normalizeBaseUrl(profile.functions?.baseUrl || rawConfig.functions?.baseUrl || ""),
        allowCloudFunctionsFallback:
          profile.functions?.allowCloudFunctionsFallback === true || rawConfig.functions?.allowCloudFunctionsFallback === true
      }
    };
  }

  function getConfig() {
    return getModeProfile();
  }

  function getMode() {
    return getConfig().mode;
  }

  function isLocalRuntime() {
    return getMode() === "local";
  }

  function assertFirebaseConfig(config) {
    REQUIRED_FIREBASE_FIELDS.forEach((field) => {
      if (!config.firebase?.[field]) {
        throw createRuntimeError(`Falta configurar Firebase: ${field}.`, { field: `firebase.${field}` });
      }
    });
  }

  function assertLocalRuntime(config) {
    const expectedLocalAuthDomain = `${LOCAL_PROJECT_ID}.firebaseapp.com`;
    const expectedLocalStorageBucket = `${LOCAL_PROJECT_ID}.appspot.com`;

    if (!isLocalHost()) {
      throw createRuntimeError("El modo local requiere abrir el sitio desde localhost/127.0.0.1.", {
        field: "origin",
        expected: "http://127.0.0.1:5000"
      });
    }
    if (config.firebase.projectId !== LOCAL_PROJECT_ID) {
      throw createRuntimeError("El modo local no puede usar el proyecto Firebase de producción.", {
        field: "firebase.projectId",
        actual: config.firebase.projectId,
        expected: LOCAL_PROJECT_ID
      });
    }
    if (String(config.firebase.authDomain || "") !== expectedLocalAuthDomain) {
      throw createRuntimeError("El authDomain local apunta a producción.", {
        field: "firebase.authDomain",
        actual: String(config.firebase.authDomain || ""),
        expected: expectedLocalAuthDomain
      });
    }
    if (String(config.firebase.storageBucket || "") !== expectedLocalStorageBucket) {
      throw createRuntimeError("El storageBucket local apunta a producción.", {
        field: "firebase.storageBucket",
        actual: String(config.firebase.storageBucket || ""),
        expected: expectedLocalStorageBucket
      });
    }
    if (config.emulators?.enabled !== true) {
      throw createRuntimeError("El modo local requiere emuladores habilitados.", {
        field: "emulators.enabled",
        expected: true
      });
    }
    REQUIRED_EMULATOR_PORTS.forEach((field) => {
      if (!Number(config.emulators?.[field])) {
        throw createRuntimeError(`Falta puerto de emulador: ${field}.`, { field: `emulators.${field}` });
      }
    });
    if (config.functions.allowCloudFunctionsFallback) {
      throw createRuntimeError("El modo local no permite fallback a cloudfunctions.net.", {
        field: "functions.allowCloudFunctionsFallback",
        expected: false
      });
    }
    if (/cloudfunctions\.net/i.test(config.functions.baseUrl)) {
      throw createRuntimeError("El modo local no puede usar una baseUrl de cloudfunctions.net.", {
        field: "functions.baseUrl",
        expected: "same-origin /api/* o Functions Emulator"
      });
    }
  }

  function assertProductionRuntime(config) {
    if (config.emulators?.enabled === true) {
      throw createRuntimeError("Producción no puede iniciar conectores de emuladores.", {
        field: "emulators.enabled",
        expected: false
      });
    }
  }

  function assertSafeRuntime() {
    const config = getConfig();
    assertFirebaseConfig(config);
    if (config.mode === "local") {
      assertLocalRuntime(config);
    } else {
      assertProductionRuntime(config);
    }
    return config;
  }

  function connectEmulatorsIfNeeded({ auth, db, storage, functions, connectors } = {}) {
    const config = assertSafeRuntime();
    if (config.mode !== "local") {
      return false;
    }

    const requiredConnectors = [
      "connectAuthEmulator",
      "connectFirestoreEmulator",
      "connectStorageEmulator",
      "connectFunctionsEmulator"
    ];
    requiredConnectors.forEach((name) => {
      if (typeof connectors?.[name] !== "function") {
        throw createRuntimeError(`Falta conector Firebase SDK: ${name}.`, { field: `connectors.${name}` });
      }
    });

    const host = config.emulators.host || "127.0.0.1";
    connectors.connectAuthEmulator(auth, `http://${host}:${config.emulators.authPort}`, { disableWarnings: true });
    connectors.connectFirestoreEmulator(db, host, Number(config.emulators.firestorePort));
    connectors.connectStorageEmulator(storage, host, Number(config.emulators.storagePort));
    connectors.connectFunctionsEmulator(functions, host, Number(config.emulators.functionsPort));
    return true;
  }

  function resolveProjectFallback(functionName) {
    const config = getConfig();
    if (config.functions.allowCloudFunctionsFallback !== true || config.mode === "local") {
      return "";
    }

    const projectId = config.firebase?.projectId;
    if (!projectId) {
      return "";
    }

    const region = config.functions.region || DEFAULT_REGION;
    return `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;
  }

  function resolveApiUrl(functionName, params = {}) {
    if (!ALLOWED_FUNCTIONS.has(functionName)) {
      throw new Error(`Endpoint no permitido: ${functionName}`);
    }

    const config = assertSafeRuntime();
    const overrideBaseUrl = config.functions.baseUrl;
    if (overrideBaseUrl) {
      return appendParams(`${overrideBaseUrl}/${functionName}`, params);
    }

    if (global.location?.origin && global.location.origin !== "null") {
      return appendParams(`${global.location.origin}/api/${functionName}`, params);
    }

    const fallbackUrl = resolveProjectFallback(functionName);
    if (fallbackUrl) {
      return appendParams(fallbackUrl, params);
    }

    throw new Error(
      "No se pudo resolver el endpoint de funciones. Configurá window.__FUNCTIONS_BASE_URL__ para entornos locales/estáticos."
    );
  }

  global.LaCasonaRuntime = Object.freeze({
    getConfig,
    getMode,
    isLocalRuntime,
    assertSafeRuntime,
    connectEmulatorsIfNeeded,
    resolveApiUrl,
    allowedFunctions: Array.from(ALLOWED_FUNCTIONS)
  });
})(window);
