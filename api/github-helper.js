// GitHub REST API Helper for Vercel Serverless Functions
// Allows the CMS to commit changes directly to the GitHub repository

export async function githubRequest(endpoint, token, options = {}) {
    const url = `https://api.github.com${endpoint}`;
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Clarified-CMS',
        ...(options.headers || {})
    };

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const errorMsg = data && data.message ? data.message : `GitHub API error: ${res.status}`;
        throw new Error(errorMsg);
    }
    return data;
}

export async function getBranchRef(owner, repo, branch, token) {
    const data = await githubRequest(`/repos/${owner}/${repo}/git/ref/heads/${branch}`, token);
    return data.object.sha;
}

export async function getFileContent(owner, repo, filePath, branch, token) {
    try {
        const data = await githubRequest(`/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${branch}`, token);
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return { content, sha: data.sha };
    } catch (err) {
        if (err.message && err.message.toLowerCase().includes('not found')) {
            return null;
        }
        throw err;
    }
}

export async function createBlob(owner, repo, base64Content, token) {
    const data = await githubRequest(`/repos/${owner}/${repo}/git/blobs`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            content: base64Content,
            encoding: 'base64'
        })
    });
    return data.sha;
}

export async function createCommitAndPush(owner, repo, branch, message, files, token) {
    // 1. Get latest commit SHA on branch
    const latestCommitSha = await getBranchRef(owner, repo, branch, token);
    
    // 2. Get tree SHA of the latest commit
    const latestCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, token);
    const baseTreeSha = latestCommit.tree.sha;

    // 3. Build tree items
    // files format: [{ path: 'articles/foo.html', content: '...', mode: '100644', type: 'blob' }, ...]
    // or if blobSha: { path: 'images/foo.png', sha: blobSha, mode: '100644', type: 'blob' }
    const treeItems = files.map(f => {
        if (f.sha) {
            return {
                path: f.path,
                mode: f.mode || '100644',
                type: 'blob',
                sha: f.sha
            };
        }
        return {
            path: f.path,
            mode: f.mode || '100644',
            type: 'blob',
            content: f.content
        };
    });

    // 4. Create new tree
    const newTree = await githubRequest(`/repos/${owner}/${repo}/git/trees`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            base_tree: baseTreeSha,
            tree: treeItems
        })
    });

    // 5. Create new commit pointing to the new tree
    const newCommit = await githubRequest(`/repos/${owner}/${repo}/git/commits`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message,
            tree: newTree.sha,
            parents: [latestCommitSha]
        })
    });

    // 6. Update branch ref to point to the new commit
    await githubRequest(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sha: newCommit.sha,
            force: false
        })
    });

    return newCommit;
}
