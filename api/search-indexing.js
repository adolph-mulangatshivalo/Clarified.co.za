import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function base64url(str) {
    return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Automatically submit sitemap and clean article URLs to Google Search Console & IndexNow
 */
export async function submitToSearchEngines({ slug, siteUrl = 'https://clarified.co.za' } = {}) {
    const report = {
        timestamp: new Date().toISOString(),
        gscSitemap: null,
        indexNow: null,
        errors: []
    };

    // 1. Google Search Console Sitemap Submission
    try {
        let creds = null;
        if (process.env.GSC_SERVICE_ACCOUNT_KEY) {
            try { creds = JSON.parse(process.env.GSC_SERVICE_ACCOUNT_KEY); } catch (e) {}
        }
        if (!creds) {
            const rootDir = process.cwd();
            const candidates = [
                path.join(rootDir, 'clarigit-ce50e-65aea355061b.json'),
                path.join(rootDir, 'mcp', 'gsc-key.json')
            ];
            for (const c of candidates) {
                if (fs.existsSync(c)) {
                    try { creds = JSON.parse(fs.readFileSync(c, 'utf8')); break; } catch (e) {}
                }
            }
        }

        if (creds) {
            const now = Math.floor(Date.now() / 1000);
            const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
            const claimSet = base64url(JSON.stringify({
                iss: creds.client_email,
                scope: 'https://www.googleapis.com/auth/webmasters',
                aud: 'https://oauth2.googleapis.com/token',
                exp: now + 3600,
                iat: now
            }));

            const signer = crypto.createSign('RSA-SHA256');
            signer.update(header + '.' + claimSet);
            const signature = signer.sign(creds.private_key, 'base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            const jwt = header + '.' + claimSet + '.' + signature;

            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt)
            });
            const { access_token } = await tokenRes.json();
            if (access_token) {
                const feedpath = `${siteUrl}/sitemap.xml`;
                const gscRes = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl + '/')}/sitemaps/${encodeURIComponent(feedpath)}`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${access_token}` }
                });
                report.gscSitemap = { status: gscRes.status, success: gscRes.ok || gscRes.status === 204 };
            }
        }
    } catch (err) {
        report.errors.push(`GSC error: ${err.message}`);
    }

    // 2. IndexNow Instant Submission (Bing, Yandex, Seznam, Naver)
    try {
        const key = '8bf7094258814ecb819f7cc91e5d36e2';
        const urlList = [
            `${siteUrl}/`,
            `${siteUrl}/sitemap.xml`
        ];
        if (slug) {
            urlList.push(`${siteUrl}/articles/${slug}`);
        }

        const indexNowRes = await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                host: 'clarified.co.za',
                key: key,
                keyLocation: `${siteUrl}/${key}.txt`,
                urlList
            })
        });
        report.indexNow = {
            status: indexNowRes.status,
            success: indexNowRes.status === 200 || indexNowRes.status === 202,
            urlList
        };
    } catch (err) {
        report.errors.push(`IndexNow error: ${err.message}`);
    }

    return report;
}
