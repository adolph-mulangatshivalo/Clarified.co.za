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
            const articles = (db.articles || []).sort((a, b) => b.date - a.date);
            return res.status(200).json(articles);
        }
        return res.status(200).json([]);
    } catch(err) {
        return res.status(500).json({ error: err.message });
    }
}
