// Firebase Authentication Configuration for Clarified Dashboard
// Replace the values below with your Firebase project configuration:
// Firebase Console (https://console.firebase.google.com/) -> Project Settings -> General -> Your apps -> Web app
export const firebaseConfig = {
    apiKey: (typeof window !== 'undefined' && window.__FIREBASE_API_KEY__) || "YOUR_FIREBASE_API_KEY",
    authDomain: "clarigit-ce50e.firebaseapp.com",
    projectId: "clarigit-ce50e",
    storageBucket: "clarigit-ce50e.firebasestorage.app",
    messagingSenderId: "522068670781",
    appId: "1:522068670781:web:50cad8efdbd16c0f46ad54",
    measurementId: "G-C9616RZKMD"
};

// Authorized Admin Emails who are allowed into the Dashboard
// Leave empty [] to allow any authenticated user in your Firebase project,
// or specify your email address(es) to restrict access strictly to you:
export const ALLOWED_ADMIN_EMAILS = [
    // Stored as SHA-256 hash to protect admin identity from public repository scrapers
    "4c909297955f5107960485634d341da82f983625c43d0d4a7fdb66ee9048ab50"
];
