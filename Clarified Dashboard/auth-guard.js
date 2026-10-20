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
    if (auth) {
        await signOut(auth);
    }
    window.location.replace('login.html');
}

// Attach logout helper to window for HTML button onclick
window.dashboardLogout = logout;

if (isConfigured && auth) {
    onAuthStateChanged(auth, user => {
        if (!user) {
            // Not logged in -> redirect to login
            const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.replace(`login.html?returnUrl=${returnUrl}`);
            return;
        }

        // Email Whitelist Verification
        if (Array.isArray(ALLOWED_ADMIN_EMAILS) && ALLOWED_ADMIN_EMAILS.length > 0) {
            const userEmail = (user.email || '').toLowerCase();
            const isAllowed = ALLOWED_ADMIN_EMAILS.some(e => e.toLowerCase() === userEmail);
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
} else {
    // If Firebase config has not been entered yet (e.g. initial dev), warn but allow UI
    console.warn("[Clarified Auth] Firebase config has placeholder keys. To protect dashboard, fill in firebase-config.js.");
    revealUI();
}
