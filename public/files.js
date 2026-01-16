const filesList = document.getElementById('filesList');
const statusEl = document.getElementById('status');
const searchInput = document.getElementById('searchInput');
const mimeInput = document.getElementById('mimeInput');
const refreshBtn = document.getElementById('refreshBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');

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

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 Bytes';
    }

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);

    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
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

function renderFiles(items) {
    if (!Array.isArray(items) || items.length === 0) {
        filesList.innerHTML = '<div class="empty-state">No files found</div>';
        return;
    }

    filesList.innerHTML = items
        .map(item => {
            const id = escapeHtml(item.id);
            const filename = escapeHtml(item.filename);
            const mimeType = escapeHtml(item.mimeType);
            const size = formatFileSize(item.size);
            const uploadedAt = item.uploadedAt ? new Date(item.uploadedAt).toLocaleString() : '';
            const url = escapeHtml(item.url);

            return `
                <div class="file-row">
                    <div class="file-row-main">
                        <div class="file-row-title">${filename}</div>
                        <div class="file-row-meta">
                            <span><strong>ID:</strong> ${id}</span>
                            <span><strong>MIME:</strong> ${mimeType}</span>
                            <span><strong>Size:</strong> ${size}</span>
                            <span><strong>Uploaded:</strong> ${escapeHtml(uploadedAt)}</span>
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

async function loadFiles() {
    setStatus('Loading...', 'info');

    const q = searchInput.value;
    const mimeType = mimeInput.value;

    const url = buildApiUrl('/api/v1/files', {
        limit: 10,
        offset: 0,
        sortBy: 'uploadedAt',
        order: 'desc',
        q: q,
        mimeType: mimeType,
    });

    try {
        const response = await fetch(url);

        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const message = typeof body.message === 'string' ? body.message : 'Request failed';
            throw new Error(message);
        }

        const data = await response.json();
        renderFiles(data.items);
        setStatus(`Loaded ${Array.isArray(data.items) ? data.items.length : 0} item(s)`, 'success');
    } catch (error) {
        renderFiles([]);
        setStatus(error?.message || 'Failed to load files', 'error');
    }
}

let debounceTimer;
function debounceLoad() {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        loadFiles();
    }, 250);
}

refreshBtn.addEventListener('click', () => {
    loadFiles();
});

clearFiltersBtn.addEventListener('click', () => {
    searchInput.value = '';
    mimeInput.value = '';
    loadFiles();
});

searchInput.addEventListener('input', () => {
    debounceLoad();
});

mimeInput.addEventListener('input', () => {
    debounceLoad();
});

loadFiles();
