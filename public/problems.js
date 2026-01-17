const problemsList = document.getElementById('problemsList');
const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refreshBtn');

function getBasePathPrefix() {
    const path = window.location.pathname;
    const idx = path.indexOf('/ui');
    if (idx <= 0) {
        return '';
    }
    return path.substring(0, idx);
}

function buildApiUrl(pathname, searchParams) {
    const basePathPrefix = getBasePathPrefix();
    const url = new URL(`${window.location.origin}${basePathPrefix}${pathname}`);
    if (searchParams) {
        Object.entries(searchParams).forEach(([key, value]) => {
            if (typeof value === 'string' && value.trim().length === 0) {
                return;
            }
            if (typeof value === 'undefined' || value === null) {
                return;
            }
            url.searchParams.set(key, String(value));
        });
    }
    return url.toString();
}

function escapeHtml(unsafe) {
    return String(unsafe)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function setStatus(message, variant) {
    if (!message) {
        statusEl.textContent = '';
        statusEl.className = 'files-status';
        return;
    }

    statusEl.textContent = message;
    statusEl.className = `files-status ${variant || ''}`.trim();
}

function renderProblems(items) {
    if (!Array.isArray(items) || items.length === 0) {
        problemsList.innerHTML = '<div class="empty-state">No problematic records found</div>';
        return;
    }

    problemsList.innerHTML = items
        .map(item => {
            const id = escapeHtml(item.id);
            const filename = escapeHtml(item.filename);
            const status = escapeHtml(item.status || '—');
            const optimizationStatus = escapeHtml(item.optimizationStatus || '—');
            const uploadedAt = item.uploadedAt ? new Date(item.uploadedAt).toLocaleString() : '—';
            const statusChangedAt = item.statusChangedAt ? new Date(item.statusChangedAt).toLocaleString() : '—';
            const url = escapeHtml(item.url);

            const problems = Array.isArray(item.problems) ? item.problems : [];
            const problemsHtml =
                problems.length > 0
                    ? `<ul class="problem-list">${problems
                          .map(p => `<li><strong>${escapeHtml(p.code)}:</strong> ${escapeHtml(p.message)}</li>`)
                          .join('')}</ul>`
                    : '<div class="hint">No problems</div>';

            return `
                <div class="file-row">
                    <div class="file-row-main">
                        <div class="file-row-title">
                            <span class="file-row-filename">${filename}</span>
                            <span class="file-status-badge">${status}</span>
                        </div>
                        <div class="file-row-meta">
                            <span><strong>ID:</strong> ${id}</span>
                            <span><strong>Uploaded:</strong> ${escapeHtml(uploadedAt)}</span>
                            <span><strong>Status changed:</strong> ${escapeHtml(statusChangedAt)}</span>
                            <span><strong>Optimization:</strong> ${optimizationStatus}</span>
                        </div>
                        <div class="file-row-warning">
                            ${problemsHtml}
                        </div>
                    </div>
                    <div class="file-row-actions">
                        <a class="link" href="${url}" target="_blank" rel="noreferrer">Download</a>
                    </div>
                </div>
            `;
        })
        .join('');
}

async function loadProblems() {
    setStatus('Loading...', 'info');

    const url = buildApiUrl('/api/v1/files/problems', {
        limit: 10,
    });

    try {
        const response = await fetch(url);

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const message = typeof body.message === 'string' ? body.message : 'Request failed';
            throw new Error(message);
        }

        const data = await response.json();
        renderProblems(data.items);
        setStatus(`Loaded ${Array.isArray(data.items) ? data.items.length : 0} item(s)`, 'success');
    } catch (error) {
        renderProblems([]);
        setStatus(error?.message || 'Failed to load problems', 'error');
    }
}

refreshBtn.addEventListener('click', () => {
    loadProblems();
});

loadProblems();
