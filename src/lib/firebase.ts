import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'AIzaSyDGZyZmeEMho2vimhvUfdTGvZePt4w8c8c',
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'platform-dashboard-f3e9d.firebaseapp.com',
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'platform-dashboard-f3e9d',
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'platform-dashboard-f3e9d.firebasestorage.app',
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '1034350678640',
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:1034350678640:web:e8c3b47efd091a7cfe9ab5',
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || 'G-VD5NNEJSJC',
};

const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

export function initializeFirebaseAnalytics(): Promise<void> {
    // Analytics is optional for auth-only integration.
    // Keep this as a no-op to avoid hard dependency on firebase/analytics.
    return Promise.resolve();
}

export { app, auth };
