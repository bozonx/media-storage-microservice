const filesList = document.getElementById('filesList');
const statusEl = document.getElementById('status');
const searchInput = document.getElementById('searchInput');
const mimeInput = document.getElementById('mimeInput');
const appIdInput = document.getElementById('appIdInput');
const userIdInput = document.getElementById('userIdInput');
const purposeInput = document.getElementById('purposeInput');
const refreshBtn = document.getElementById('refreshBtn');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');

async function bulkDeleteFiles(filters) {
    const url = buildApiUrl('/api/v1/files/bulk-delete');

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(filters || {}),
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = typeof body.message === 'string' ? body.message : 'Bulk delete request failed';
        throw new Error(message);
    }

    return response.json().catch(() => ({}));
}

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

function buildThumbnailUrl(fileId, params) {
    return buildApiUrl(`/api/v1/files/${encodeURIComponent(fileId)}/thumbnail`, params);
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

async function deleteFileById(fileId) {
    const url = buildApiUrl(`/api/v1/files/${encodeURIComponent(fileId)}`);

    const response = await fetch(url, {
        method: 'DELETE',
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message = typeof body.message === 'string' ? body.message : 'Delete request failed';
        throw new Error(message);
    }
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
            const appId = escapeHtml(item.appId || '—');
            const userId = escapeHtml(item.userId || '—');
            const purpose = escapeHtml(item.purpose || '—');

            const isImage = typeof item.mimeType === 'string' && item.mimeType.startsWith('image/');
            const thumbnailUrl = isImage
                ? buildThumbnailUrl(item.id, {
                      width: 96,
                      height: 96,
                  })
                : null;

            return `
                <div class="file-row">
                    <div class="file-row-thumb">
                        ${
                            isImage
                                ? `<img class="file-thumb" src="${thumbnailUrl}" alt="Thumbnail" loading="lazy" onerror="this.closest('.file-row-thumb').classList.add('failed')">`
                                : `<div class="file-thumb-placeholder">—</div>`
                        }
                    </div>
                    <div class="file-row-main">
                        <div class="file-row-title">${filename}</div>
                        <div class="file-row-meta">
                            <span><strong>ID:</strong> ${id}</span>
                            <span><strong>appId:</strong> ${appId}</span>
                            <span><strong>userId:</strong> ${userId}</span>
                            <span><strong>purpose:</strong> ${purpose}</span>
                            <span><strong>MIME:</strong> ${mimeType}</span>
                            <span><strong>Size:</strong> ${size}</span>
                            <span><strong>Uploaded:</strong> ${escapeHtml(uploadedAt)}</span>
                        </div>
                    </div>
                    <div class="file-row-actions">
                        <a class="link" href="${url}" target="_blank" rel="noreferrer">Download</a>
                        <button type="button" class="btn btn-danger file-delete" data-file-id="${id}">Delete</button>
                    </div>
                </div>
            `;
        })
        .join('');
}

filesList.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
        return;
    }

    const button = target.closest('button.file-delete');
    if (!(button instanceof HTMLButtonElement)) {
        return;
    }

    const fileId = button.getAttribute('data-file-id');
    if (!fileId) {
        return;
    }

    button.disabled = true;
    setStatus('Deleting...', 'info');

    try {
        await deleteFileById(fileId);

        const row = button.closest('.file-row');
        if (row) {
            row.remove();
        }

        const remainingRows = filesList.querySelectorAll('.file-row');
        if (remainingRows.length === 0) {
            renderFiles([]);
        }

        setStatus('Deleted', 'success');
    } catch (error) {
        button.disabled = false;
        setStatus(error?.message || 'Failed to delete file', 'error');
    }
});

async function loadFiles() {
    setStatus('Loading...', 'info');

    const q = searchInput.value;
    const mimeType = mimeInput.value;
    const appId = appIdInput.value;
    const userId = userIdInput.value;
    const purpose = purposeInput.value;

    const url = buildApiUrl('/api/v1/files', {
        limit: 10,
        offset: 0,
        sortBy: 'uploadedAt',
        order: 'desc',
        q: q,
        mimeType: mimeType,
        appId: appId,
        userId: userId,
        purpose: purpose,
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
    appIdInput.value = '';
    userIdInput.value = '';
    purposeInput.value = '';
    loadFiles();
});

searchInput.addEventListener('input', () => {
    debounceLoad();
});

mimeInput.addEventListener('input', () => {
    debounceLoad();
});

appIdInput.addEventListener('input', () => {
    debounceLoad();
});

userIdInput.addEventListener('input', () => {
    debounceLoad();
});

purposeInput.addEventListener('input', () => {
    debounceLoad();
});

bulkDeleteBtn.addEventListener('click', async () => {
    const appId = appIdInput.value;
    const userId = userIdInput.value;
    const purpose = purposeInput.value;

    if (!appId.trim() && !userId.trim() && !purpose.trim()) {
        setStatus('Provide at least one tag filter (appId, userId or purpose) for bulk delete', 'error');
        return;
    }

    const confirmed = window.confirm('Soft delete files matching current tag filters?');
    if (!confirmed) {
        return;
    }

    bulkDeleteBtn.disabled = true;
    setStatus('Bulk deleting...', 'info');

    try {
        const result = await bulkDeleteFiles({
            appId: appId,
            userId: userId,
            purpose: purpose,
        });

        const deleted = typeof result.deleted === 'number' ? result.deleted : 0;
        const matched = typeof result.matched === 'number' ? result.matched : 0;

        await loadFiles();
        setStatus(`Bulk delete completed. Matched: ${matched}, deleted: ${deleted}`, 'success');
    } catch (error) {
        setStatus(error?.message || 'Bulk delete failed', 'error');
    } finally {
        bulkDeleteBtn.disabled = false;
    }
});

loadFiles();
