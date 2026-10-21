import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const MCP_SECRET = process.env.MCP_AUTH_SECRET || process.env.FIREBASE_API_KEY || "clarified-mcp-editorial-v2-secure-key";

export function generateMcpToken(serverName) {
    const timestamp = Date.now();
    const payload = `${serverName || 'clarified'}:${timestamp}`;
    const sig = crypto.createHmac('sha256', MCP_SECRET).update(payload).digest('hex').substring(0, 32);
    return `mcp_${timestamp}_${sig}`;
}

export function verifyMcpToken(token, serverName) {
    if (!token || typeof token !== 'string' || !token.startsWith('mcp_')) return false;
    const parts = token.split('_');
    if (parts.length < 3) return false;
    const timestamp = parseInt(parts[1], 10);
    const sig = parts[2];
    if (isNaN(timestamp)) return false;
    // 30 days validity
    if (Date.now() - timestamp > 30 * 24 * 60 * 60 * 1000) return false;

    // Check with expected serverName or 'clarified'
    const namesToCheck = [serverName, 'clarified', 'novamira-clarified-co-za'].filter(Boolean);
    for (const name of namesToCheck) {
        const expectedSig = crypto.createHmac('sha256', MCP_SECRET).update(`${name}:${timestamp}`).digest('hex').substring(0, 32);
        if (sig === expectedSig) return true;
    }
    return false;
}

export function findMcpConfig() {
    const primaryPath = path.join(process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\adolp', '.gemini', 'config', 'mcp_config.json');
    const candidatePaths = [
        primaryPath,
        path.join(process.cwd(), 'mcp_config.json'),
        path.join(process.cwd(), 'config.json'),
        path.join(process.cwd(), '.agents', 'mcp_config.json'),
        path.join(process.cwd(), 'dashboard', 'mcp_config.json')
    ];

    for (const candidate of candidatePaths) {
        try {
            if (fs.existsSync(candidate)) {
                const stat = fs.statSync(candidate);
                if (stat.size > 0) {
                    const raw = fs.readFileSync(candidate, 'utf8').trim();
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        const servers = parsed.mcpServers || {};
                        const serverKeys = Object.keys(servers);
                        if (serverKeys.length > 0) {
                            return {
                                path: candidate,
                                hasServers: true,
                                serverName: serverKeys[0],
                                serverNames: serverKeys,
                                servers
                            };
                        }
                    }
                }
            }
        } catch (e) {}
    }

    // Fallback: check if built-in MCP server exists in the repository
    const builtInServer = path.join(process.cwd(), 'mcp', 'server.js');
    if (fs.existsSync(builtInServer)) {
        const defaultName = process.env.MCP_SERVER_NAME || 'clarified';
        return {
            path: path.join(process.cwd(), 'mcp_config.json'),
            hasServers: true,
            serverName: defaultName,
            serverNames: [defaultName],
            servers: {
                [defaultName]: {
                    command: 'node',
                    args: ['mcp/server.js'],
                    description: 'Clarified Editorial AI & Publishing Engine'
                }
            }
        };
    }

    return {
        path: candidatePaths[1],
        hasServers: false,
        serverName: null,
        serverNames: [],
        servers: {}
    };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-mcp-auth');
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    try {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) { body = {}; }
        }
        body = body || {};

        const action = body.action || 'authenticate';
        const sessionPath = path.join(process.cwd(), 'dashboard', '.mcp-session.json');

        if (action === 'disconnect') {
            const candidatePaths = [
                path.join(process.cwd(), 'dashboard', '.mcp-active.json'),
                path.join(process.cwd(), 'Clarified Dashboard', '.mcp-active.json'),
                path.join(process.cwd(), '.mcp-active.json')
            ];
            for (const p of candidatePaths) {
                try {
                    if (fs.existsSync(p)) {
                        const d = JSON.parse(fs.readFileSync(p, 'utf8'));
                        if (d && d.pid && d.pid !== process.pid) {
                            try { process.kill(d.pid, 'SIGKILL'); } catch(e) {}
                        }
                        fs.unlinkSync(p);
                    }
                } catch(e) {}
            }

            try {
                if (fs.existsSync(sessionPath)) {
                    fs.unlinkSync(sessionPath);
                }
            } catch(e) {}

            return res.status(200).json({
                success: true,
                connected: false,
                message: 'MCP disconnected successfully.'
            });
        }

        // Authenticate flow
        const configInfo = findMcpConfig();
        if (!configInfo.hasServers) {
            return res.status(400).json({
                success: false,
                connected: false,
                error: 'No MCP server configured in mcp_config.json. Please add your server configuration first.',
                configPath: configInfo.path
            });
        }

        // Generate cryptographically verifiable session token
        const token = generateMcpToken(configInfo.serverName);
        const sessionData = {
            connected: true,
            serverName: configInfo.serverName,
            configPath: configInfo.path,
            authenticatedAt: Date.now(),
            token
        };

        try {
            const dir = path.dirname(sessionPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2), 'utf8');
        } catch(e) {
            // Ignored if filesystem is read-only (e.g. Vercel Serverless)
        }

        return res.status(200).json({
            success: true,
            connected: true,
            serverName: configInfo.serverName,
            token,
            message: `Successfully authenticated and connected to ${configInfo.serverName}.`
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            connected: false,
            error: err.message
        });
    }
}
