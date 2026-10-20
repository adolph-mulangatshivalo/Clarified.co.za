import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate');

    try {
        let dbPath = path.join(process.cwd(), 'dashboard', 'db.json');
        if (!fs.existsSync(dbPath)) {
            dbPath = path.join(process.cwd(), 'Clarified Dashboard', 'db.json');
        }
        if (fs.existsSync(dbPath)) {
            const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            const articles = db.articles || [];
            return res.status(200).json({
                total: articles.length,
                published: articles.filter(a => a.status === 'published').length,
                drafts: articles.filter(a => a.status === 'draft').length
            });
        }
        return res.status(200).json({ total: 0, published: 0, drafts: 0 });
    } catch(err) {
        return res.status(500).json({ error: err.message });
    }
}
