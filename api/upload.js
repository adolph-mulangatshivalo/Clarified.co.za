import { createBlob, createCommitAndPush } from './github-helper.js';
import { verifyAdminAuth } from './auth-verify.js';

export default async function handler(req, res) {
    // Security: Restrict CORS
    const origin = req.headers.origin || '';
    if (origin.includes('clarified.co.za') || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('vercel.app')) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://clarified.co.za');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Security: Verify Admin Authentication
    const authResult = await verifyAdminAuth(req);
    if (!authResult.authorized) {
        return res.status(authResult.status || 401).json({ error: authResult.error });
    }

    const {
        GITHUB_TOKEN,
        GITHUB_OWNER,
        GITHUB_REPO,
        GITHUB_BRANCH = 'main'
    } = process.env;

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        return res.status(500).json({ error: 'Missing GitHub configuration in Vercel environment variables.' });
    }

    try {
        const data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        if (!data.image) return res.status(400).json({ error: 'No image data provided' });

        const matches = data.image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) {
            return res.status(400).json({ error: 'Invalid base64 image data' });
        }

        let ext = (matches[1].split('/')[1] || 'png').toLowerCase();
        if (ext === 'jpeg') ext = 'jpg';
        if (ext.includes('+')) ext = ext.split('+')[0];

        const filename = `upload_${Date.now()}.${ext}`;
        const relativePath = `images/${filename}`;

        // Create blob on GitHub
        const blobSha = await createBlob(GITHUB_OWNER, GITHUB_REPO, matches[2], GITHUB_TOKEN);

        // Commit image to GitHub repository
        await createCommitAndPush(
            GITHUB_OWNER,
            GITHUB_REPO,
            GITHUB_BRANCH,
            `Upload image: ${filename}`,
            [{ path: relativePath, sha: blobSha }],
            GITHUB_TOKEN
        );

        return res.status(200).json({ url: relativePath });
    } catch(err) {
        console.error('Error in /api/upload:', err);
        return res.status(500).json({ error: err.message });
    }
}
