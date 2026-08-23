import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const app = initializeApp({ projectId: "demo-alquileres-la-casona" });

const users = [
  { uid: "IJ1eFcfGPvj2ZetVHXoYA8Ytb6ij", email: "jorgejara2014@gmail.com", displayName: "Jorge Hara" },
];

async function run() {
  const auth = getAuth(app);
  const db = getFirestore(app);

  for (const user of users) {
    await auth.setCustomUserClaims(user.uid, {
      role: "superadmin",
      ownerScope: "all",
    });

    await db.collection("users").doc(user.uid).set({
      role: "superadmin",
      ownerScope: "all",
      status: "active",
      email: user.email,
      displayName: user.displayName,
      createdAt: new Date().toISOString(),
      createdBy: "system",
    });

    console.log(`Superadmin created: ${user.displayName} (${user.email}) uid=${user.uid}`);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
