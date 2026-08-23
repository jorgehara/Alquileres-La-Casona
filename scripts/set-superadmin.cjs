const { initializeApp, getApps } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) {
  initializeApp();
}

async function setSuperAdmin() {
  const auth = getAuth();
  const db = getFirestore();
  
  // Set custom claims
  await auth.setCustomUserClaims('IJ1eFcfGPvj2ZetVHXoYA8Ytb6ij', {
    role: 'superadmin',
    ownerScope: 'all'
  });
  
  // Create Firestore profile
  await db.collection('users').doc('IJ1eFcfGPvj2ZetVHXoYA8Ytb6ij').set({
    role: 'superadmin',
    ownerScope: 'all',
    status: 'active',
    email: 'jorgejara2014@gmail.com',
    displayName: 'Jorge Hara',
    createdAt: new Date().toISOString(),
    createdBy: 'system'
  });
  
  console.log('Superadmin created successfully for uid: IJ1eFcfGPvj2ZetVHXoYA8Ytb6ij');
  process.exit(0);
}

setSuperAdmin().catch(err => {
  console.error(err);
  process.exit(1);
});
