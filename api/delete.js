import { getFileContent, createCommitAndPush } from './github-helper.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
        if (!data.id) return res.status(400).json({ error: 'Article ID is required' });

        const dbFile = await getFileContent(GITHUB_OWNER, GITHUB_REPO, 'Clarified Dashboard/db.json', GITHUB_BRANCH, GITHUB_TOKEN);
        if (!dbFile) return res.status(500).json({ error: 'Could not find db.json' });

        const db = JSON.parse(dbFile.content);
        const article = (db.articles || []).find(a => String(a.id) === String(data.id));

        if (!article) {
            return res.status(404).json({ error: 'Article not found' });
        }

        db.articles = db.articles.filter(a => String(a.id) !== String(data.id));

        const filesToCommit = [
            {
                path: 'Clarified Dashboard/db.json',
                content: JSON.stringify(db, null, 2)
            }
        ];

        const commitMsg = `Delete article: ${article.title}`;
        const commit = await createCommitAndPush(GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, commitMsg, filesToCommit, GITHUB_TOKEN);

        return res.status(200).json({
            success: true,
            commitSha: commit.sha,
            message: 'Article deleted and committed to GitHub. Vercel is redeploying.'
        });
    } catch(err) {
        console.error('Error in /api/delete:', err);
        return res.status(500).json({ error: err.message });
    }
}
