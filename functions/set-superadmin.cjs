const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const app = initializeApp({
  projectId: 'demo-alquileres-la-casona'
});

async function setSuperAdmin() {
  const auth = getAuth(app);
  const db = getFirestore(app);
  const uid = 'IJ1eFcfGPvj2ZetVHXoYA8Ytb6ij';
  
  await auth.setCustomUserClaims(uid, {
    role: 'superadmin',
    ownerScope: 'all'
  });
  
  await db.collection('users').doc(uid).set({
    role: 'superadmin',
    ownerScope: 'all',
    status: 'active',
    email: 'jorgejara2014@gmail.com',
    displayName: 'Jorge Hara',
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  });
  
  console.log('Superadmin created successfully for uid: ' + uid);
  process.exit(0);
}

setSuperAdmin().catch(err => {
  console.error(err);
  process.exit(1);
});
