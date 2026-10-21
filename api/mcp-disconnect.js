import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-mcp-auth');
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed. Use POST.' });
    }

    try {
        const candidatePaths = [
            path.join(process.cwd(), 'dashboard', '.mcp-active.json'),
            path.join(process.cwd(), 'Clarified Dashboard', '.mcp-active.json'),
            path.join(process.cwd(), '.mcp-active.json')
        ];

        // 1. Terminate any active background MCP child process if found
        for (const p of candidatePaths) {
            try {
                if (fs.existsSync(p)) {
                    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                    if (data && data.pid && data.pid !== process.pid) {
                        try { process.kill(data.pid, 'SIGTERM'); } catch (e) {}
                        setTimeout(() => {
                            try { process.kill(data.pid, 'SIGKILL'); } catch (e) {}
                        }, 300);
                    }
                    fs.unlinkSync(p);
                }
            } catch (e) {}
        }

        // 2. Terminate any orphan node processes running mcp/server.js
        try {
            if (process.platform === 'win32') {
                const killCmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like \'*mcp/server.js*\' -and $_.ProcessId -ne ' + process.pid + ' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"';
                execSync(killCmd, { timeout: 3000, stdio: 'ignore' });
            }
        } catch (e) {}

        // 3. Remove session cache
        const sessionPaths = [
            path.join(process.cwd(), 'dashboard', '.mcp-session.json'),
            path.join(process.cwd(), 'Clarified Dashboard', '.mcp-session.json'),
            path.join(process.cwd(), '.mcp-session.json')
        ];
        for (const sp of sessionPaths) {
            try {
                if (fs.existsSync(sp)) fs.unlinkSync(sp);
            } catch (e) {}
        }

        return res.status(200).json({
            success: true,
            connected: false,
            message: 'MCP server disconnected cleanly. All background processes and sessions terminated.'
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: err.message
        });
    }
}
