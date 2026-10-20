// Firebase Authentication Configuration for Clarified Dashboard
// Replace the values below with your Firebase project configuration:
// Firebase Console (https://console.firebase.google.com/) -> Project Settings -> General -> Your apps -> Web app
export const firebaseConfig = {
    apiKey: "AIzaSyBwNSi_ROjHpNBTlT1MjDouEMQAKeyE4cg",
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
    "adolphusmulanga723@gmail.com"
];
