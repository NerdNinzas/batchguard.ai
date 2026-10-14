"use client";

/** Firebase client: only used for Google sign-in. Enabled when NEXT_PUBLIC_FIREBASE_API_KEY is set. */
export const firebaseEnabled = Boolean(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);

export async function googleIdToken(): Promise<string> {
  if (!firebaseEnabled) throw new Error("Google sign-in is not configured. Set NEXT_PUBLIC_FIREBASE_* in .env.local and FIREBASE_PROJECT_ID in backend/.env.");
  const { initializeApp, getApps } = await import("firebase/app");
  const { getAuth, GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const app = getApps()[0] ?? initializeApp({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });
  const cred = await signInWithPopup(getAuth(app), new GoogleAuthProvider());
  return cred.user.getIdToken();
}
