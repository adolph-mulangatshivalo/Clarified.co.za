import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { firebaseConfig, ALLOWED_ADMIN_EMAILS } from "./firebase-config.js";

// Check if Firebase has dummy config
export const isConfigured = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes("YOUR_API_KEY");

let app = null;
let auth = null;

if (isConfigured) {
    app  = initializeApp(firebaseConfig);
    auth = getAuth(app);
}

// Initial state protection: hide body until auth verified (prevents UI flashing)
const style = document.createElement('style');
style.id = 'auth-guard-style';
style.textContent = `
    body { opacity: 0; transition: opacity 0.2s ease-in-out; }
    body.auth-ready { opacity: 1; }
`;
document.head.appendChild(style);

function revealUI() {
    document.body.classList.add('auth-ready');
}

export function getCurrentUser() {
    return auth ? auth.currentUser : null;
}

export async function getIdToken() {
    if (!auth || !auth.currentUser) return null;
    return await auth.currentUser.getIdToken();
}

export async function logout() {
    sessionStorage.removeItem('clarified_admin_session');
    if (auth) {
        await signOut(auth).catch(() => {});
    }
    const loginPath = '/dashboard/login.html';
    window.location.replace(loginPath);
}

// Attach helpers to window for HTML access
window.dashboardLogout = logout;
window.getAuthToken = getIdToken;

// Clear session whenever user clicks any link that navigates away from the dashboard
document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && a.href) {
        try {
            const url = new URL(a.href, window.location.origin);
            if (!url.pathname.startsWith('/dashboard') && !url.pathname.startsWith('/Clarified%20Dashboard')) {
                sessionStorage.removeItem('clarified_admin_session');
                if (auth) signOut(auth).catch(() => {});
            }
        } catch(err) {}
    }
});

async function hashString(str) {
    const data = new TextEncoder().encode((str || '').toLowerCase().trim());
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

if (isConfigured && auth) {
    // Must have logged in during this active session
    const hasActiveSession = sessionStorage.getItem('clarified_admin_session');
    if (!hasActiveSession) {
        // No active session in this tab/window! Force sign out and require login
        signOut(auth).catch(() => {});
        const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/dashboard/login.html?returnUrl=${returnUrl}`);
    } else {
        onAuthStateChanged(auth, async user => {
            if (!user) {
                // Not logged in -> redirect to login
                sessionStorage.removeItem('clarified_admin_session');
                const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
                const loginPath = '/dashboard/login.html';
                window.location.replace(`${loginPath}?returnUrl=${returnUrl}`);
                return;
            }

            // Email Whitelist Verification (Supports plain email or SHA-256 privacy hash)
            if (Array.isArray(ALLOWED_ADMIN_EMAILS) && ALLOWED_ADMIN_EMAILS.length > 0) {
                const userEmail = (user.email || '').toLowerCase().trim();
                const emailHash = await hashString(userEmail);
                const isAllowed = ALLOWED_ADMIN_EMAILS.some(item => {
                    const target = item.toLowerCase().trim();
                    return target === userEmail || target === emailHash;
                });
                if (!isAllowed) {
                    alert(`Access Denied: The account ${user.email} is not authorized to access this dashboard.`);
                    logout();
                    return;
                }
            }

            // User is authorized: update topbar avatar & email
            const avatarEl = document.querySelector('.avatar');
            if (avatarEl) {
                const letter = (user.displayName || user.email || 'A').charAt(0).toUpperCase();
                avatarEl.textContent = letter;
                avatarEl.title = user.email || '';
                avatarEl.style.cursor = 'pointer';
            }

            // Inject Sign Out link in sidebar if not already present
            const sidebarNav = document.querySelector('.sidebar');
            if (sidebarNav && !document.getElementById('nav-signout')) {
                const logoutDiv = document.createElement('div');
                logoutDiv.id = 'nav-signout';
                logoutDiv.style.padding = '8px 16px 16px 16px';
                logoutDiv.innerHTML = `
                    <a href="#" onclick="dashboardLogout(); return false;" class="nav-sub-item" style="display:flex;align-items:center;gap:8px;color:var(--danger,#e53e3e);text-decoration:none;font-weight:600;font-size:13px;">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                        Sign out (${(user.email || 'Admin').split('@')[0]})
                    </a>
                `;
                const liveSiteContainer = sidebarNav.lastElementChild;
                if (liveSiteContainer) {
                    sidebarNav.insertBefore(logoutDiv, liveSiteContainer);
                } else {
                    sidebarNav.appendChild(logoutDiv);
                }
            }

            revealUI();
        });
    }
} else {
    // If Firebase config has not been entered yet (e.g. initial dev), warn but allow UI
    console.warn("[Clarified Auth] Firebase config has placeholder keys. To protect dashboard, fill in firebase-config.js.");
    revealUI();
}
