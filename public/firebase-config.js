window.__LA_CASONA_PUBLIC_CONFIG__ = {
  // "auto" keeps this no-build frontend safe: localhost/127.0.0.1 uses emulators,
  // production Hosting keeps the existing production Firebase project.
  mode: "auto",
  local: {
    firebase: {
      apiKey: "demo-api-key",
      authDomain: "demo-alquileres-la-casona.firebaseapp.com",
      projectId: "demo-alquileres-la-casona",
      storageBucket: "demo-alquileres-la-casona.appspot.com",
      messagingSenderId: "demo",
      appId: "demo"
    },
    emulators: {
      enabled: true,
      host: "127.0.0.1",
      authPort: 9099,
      firestorePort: 8080,
      storagePort: 9199,
      functionsPort: 5001
    },
    functions: {
      region: "us-central1",
      baseUrl: "",
      allowCloudFunctionsFallback: false
    }
  },
  production: {
    firebase: {
      apiKey: "AIzaSyAEbdMVbEaYBqx-f_iyrumSDTofWmVWjYs",
      authDomain: "alquileres-la-casona.firebaseapp.com",
      projectId: "alquileres-la-casona",
      storageBucket: "alquileres-la-casona.firebasestorage.app",
      messagingSenderId: "903231232968",
      appId: "1:903231232968:web:c34bdd3f60fb05a05bfefd"
    },
    emulators: {
      enabled: false
    },
    functions: {
      region: "us-central1",
      baseUrl: "",
      allowCloudFunctionsFallback: false
    }
  }
};

// Backward-compatible read alias during migration. New code must use
// LaCasonaRuntime.getConfig().firebase after runtime-config.js loads.
window.__FIREBASE_CONFIG__ = window.__LA_CASONA_PUBLIC_CONFIG__.production.firebase;
