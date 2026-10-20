/**
 * Security Guard for Vercel Serverless Functions
 * Verifies that requests are made by an authenticated Firebase Admin user.
 * Blocks unauthorized access, hackers, and malicious bots from modifying the site.
 */

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyBwNSi_ROjHpNBTlT1MjDouEMQAKeyE4cg";

// Hash of authorized admin email (prevents exposing the raw email in code)
// Matches SHA-256 of adolphusmulanga723@gmail.com
const AUTHORIZED_EMAIL_HASH = "4c909297955f5107960485634d341da82f983625c43d0d4a7fdb66ee9048ab50";

function sha256(str) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update((str || '').toLowerCase().trim()).digest('hex');
}

export async function verifyAdminAuth(req) {
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
        return {
            authorized: false,
            status: 401,
            error: 'Access Denied: Missing Authorization Bearer token.'
        };
    }

    const idToken = authHeader.split('Bearer ')[1].trim();
    if (!idToken) {
        return {
            authorized: false,
            status: 401,
            error: 'Access Denied: Empty authentication token.'
        };
    }

    try {
        const verifyEndpoint = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`;
        const res = await fetch(verifyEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken })
        });

        const data = await res.json();

        if (!res.ok || !data.users || data.users.length === 0) {
            return {
                authorized: false,
                status: 401,
                error: 'Access Denied: Invalid or expired authentication token. Please re-login.'
            };
        }

        const user = data.users[0];
        const email = user.email || '';
        const userHash = sha256(email);

        // Verify that the user is the authorized admin
        if (AUTHORIZED_EMAIL_HASH && userHash !== AUTHORIZED_EMAIL_HASH) {
            return {
                authorized: false,
                status: 403,
                error: `Access Denied: The account ${email} is not authorized to publish or delete content.`
            };
        }

        return {
            authorized: true,
            user: { email, localId: user.localId }
        };
    } catch (err) {
        return {
            authorized: false,
            status: 500,
            error: 'Security verification error: ' + err.message
        };
    }
}
