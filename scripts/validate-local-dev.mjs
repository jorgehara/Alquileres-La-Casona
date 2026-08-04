import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function readText(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hasAll(text, values) {
  return values.every((value) => text.includes(value));
}

function checkRootToolingContract() {
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");

  assert(pkg.private === true, "Root package must remain private/tooling-only.");
  assert(pkg.devDependencies?.["firebase-tools"] === "15.24.0", "Root devDependencies must pin firebase-tools exactly to 15.24.0.");
  assert(lock.packages?.[""]?.devDependencies?.["firebase-tools"] === "15.24.0", "Root package-lock must lock firebase-tools from the root package.");
  assert(lock.packages?.["node_modules/firebase-tools"]?.version === "15.24.0", "package-lock must resolve firebase-tools 15.24.0.");

  ["firebase", "install:functions", "build:functions", "lint:functions", "validate", "validate:local-dev", "emulators"].forEach((script) => {
    assert(typeof pkg.scripts?.[script] === "string", `package.json must define npm script ${script}.`);
  });
  assert(pkg.scripts["install:functions"].includes("--prefix functions"), "install:functions must run against the functions package boundary.");
  assert(pkg.scripts["build:functions"].includes("--prefix functions"), "build:functions must run against the functions package boundary.");
  assert(pkg.scripts["lint:functions"].includes("--prefix functions"), "lint:functions must run against the functions package boundary.");
  assert(!Object.keys(pkg.scripts).some((script) => /deploy|login/i.test(script)), "Root local tooling scripts must not add deploy/login shortcuts.");
}

function checkEmulatorConfiguration() {
  const firebaseConfig = readJson("firebase.json");
  const emulators = firebaseConfig.emulators ?? {};
  const expectedPorts = {
    hosting: 5000,
    functions: 5001,
    firestore: 8080,
    auth: 9099,
    storage: 9199
  };

  Object.entries(expectedPorts).forEach(([service, port]) => {
    assert(emulators[service]?.port === port, `firebase.json must configure ${service} emulator on port ${port}.`);
  });
  assert(emulators.ui?.enabled === true, "firebase.json must enable Emulator UI.");
  assert(emulators.ui?.port === 4000, "firebase.json must configure Emulator UI on port 4000.");
  assert(emulators.singleProjectMode === true, "firebase.json must enable singleProjectMode for local emulator safety.");
}

function checkEnvironmentAndProjectSafety() {
  const gitignore = readText(".gitignore");
  const envExample = readText("functions/.env.example");
  const firebasercExample = readJson(".firebaserc.example");

  [".env.*", "!.env.example", ".firebaserc", "!.firebaserc.example", "functions/.env.*", "!functions/.env.example", ".firebase/", "firebase-export-*/", "emulator-data/", "*.log"].forEach((pattern) => {
    assert(gitignore.includes(pattern), `.gitignore must include ${pattern}.`);
  });
  assert(envExample.includes("WEBAPP_URL=http://127.0.0.1:5000"), "functions/.env.example must use local Hosting URL.");
  assert(envExample.includes("BACKEND_BASE_URL=http://127.0.0.1:5001/demo-alquileres-la-casona/us-central1"), "functions/.env.example must use local Functions emulator URL.");
  assert(hasAll(envExample, ["placeholder", "example.test"]), "functions/.env.example must use placeholders/example domains, not real secrets.");
  assert(!envExample.includes("https://us-central1-alquileres-la-casona.cloudfunctions.net"), "functions/.env.example must not include production Cloud Functions URLs.");
  assert(firebasercExample.projects?.default === "demo-alquileres-la-casona", ".firebaserc.example must use demo project id for emulator-safe setup.");
  assert(!existsSync(resolve(root, ".github/workflows")), "Stage 1 validation must not add CI workflows.");
}

function checkFrontendRuntimeIsolation() {
  const firebaseConfig = readText("public/firebase-config.js");
  const runtimeConfig = readText("public/runtime-config.js");
  const app = readText("public/app.js");
  const verifyReceipt = readText("public/verify-receipt.js");
  const firebaseJson = readJson("firebase.json");
  const rewriteSources = (firebaseJson.hosting?.rewrites || []).map((rewrite) => rewrite.source);

  assert(firebaseConfig.includes("window.__LA_CASONA_PUBLIC_CONFIG__"), "public/firebase-config.js must define the public runtime config contract.");
  assert(firebaseConfig.includes('mode: "auto"'), "public/firebase-config.js must use auto mode so localhost is isolated and production Hosting stays compatible.");
  assert(firebaseConfig.includes('projectId: "demo-alquileres-la-casona"'), "public/firebase-config.js local profile must use demo project id.");
  assert(firebaseConfig.includes('projectId: "alquileres-la-casona"'), "public/firebase-config.js production profile must preserve production project id.");
  assert(hasAll(firebaseConfig, ["authPort: 9099", "firestorePort: 8080", "storagePort: 9199", "functionsPort: 5001"]), "public/firebase-config.js must declare all emulator ports.");
  assert(firebaseConfig.includes("allowCloudFunctionsFallback: false"), "public/firebase-config.js must disable cloudfunctions.net fallback by default.");

  assert(hasAll(runtimeConfig, ["assertSafeRuntime", "connectEmulatorsIfNeeded", "resolveApiUrl", "LOCAL_PROJECT_ID", "PRODUCTION_PROJECT_ID"]), "public/runtime-config.js must expose runtime safety and emulator helpers.");
  assert(runtimeConfig.includes("El modo local no puede usar una baseUrl de cloudfunctions.net"), "runtime-config.js must reject cloudfunctions.net base URLs in local mode.");
  assert(runtimeConfig.includes("/api/${functionName}"), "runtime-config.js must preserve same-origin /api/* endpoint resolution.");

  ["connectAuthEmulator", "connectFirestoreEmulator", "connectStorageEmulator", "connectFunctionsEmulator"].forEach((name) => {
    assert(app.includes(name), `public/app.js must connect ${name} for local emulator isolation.`);
  });
  assert(app.indexOf("assertRuntimeIsSafe") < app.indexOf("onAuthStateChanged(auth"), "public/app.js must assert runtime safety before auth listeners can run.");
  assert(app.includes("Configuración local insegura"), "public/app.js must render a blocking runtime failure message.");

  ["/api/resolvePaymentAccessToken", "/api/createCheckoutFromPaymentAccessToken", "/api/submitTransferFromPaymentAccessToken", "/api/verifyPaymentReceipt"].forEach((source) => {
    assert(rewriteSources.includes(source), `firebase.json must preserve Hosting rewrite ${source}.`);
  });
  assert(verifyReceipt.includes("LaCasonaRuntime.resolveApiUrl"), "public/verify-receipt.js must keep using LaCasonaRuntime.resolveApiUrl.");
}

function checkReadmeRootFirstWorkflow() {
  const readme = readText("README.md");
  const requiredSnippets = [
    "npm install",
    "npm run install:functions",
    "cp functions/.env.example functions/.env.alquileres-la-casona",
    "npm run build:functions",
    "npm run emulators",
    "JDK 21 o superior",
    "No hace falta instalar Firebase CLI globalmente",
    "no agrega flujo de login ni deploy",
    "Auth, Firestore, Storage y Functions usan emuladores",
    "http://127.0.0.1:5000",
    "docs/local-tenant-emulator-flow.md"
  ];

  requiredSnippets.forEach((snippet) => {
    assert(readme.includes(snippet), `README.md must document: ${snippet}`);
  });
  assert(!/cd\s+functions[\s\S]{0,120}firebase\s+emulators:start/i.test(readme), "README.md must not document firebase emulators:start from functions/.");
  assert(existsSync(resolve(root, "docs/local-tenant-emulator-flow.md")), "docs/local-tenant-emulator-flow.md must exist.");
}

const checks = [
  checkRootToolingContract,
  checkEmulatorConfiguration,
  checkEnvironmentAndProjectSafety,
  checkFrontendRuntimeIsolation,
  checkReadmeRootFirstWorkflow,
];

for (const check of checks) {
  check();
}

console.log(`Local development validation passed (${checks.length} reproducible setup checks).`);
