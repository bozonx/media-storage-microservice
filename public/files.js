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

function formatJson(value) {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return '[unserializable]';
    }
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
            const originalSize = typeof item.originalSize === 'number' ? formatFileSize(item.originalSize) : '—';
            const uploadedAt = item.uploadedAt ? new Date(item.uploadedAt).toLocaleString() : '';
            const statusChangedAt = item.statusChangedAt
                ? new Date(item.statusChangedAt).toLocaleString()
                : '';
            const url = escapeHtml(item.url);
            const appId = escapeHtml(item.appId || '—');
            const userId = escapeHtml(item.userId || '—');
            const purpose = escapeHtml(item.purpose || '—');
            const status = escapeHtml(item.status || '—');
            const originalMimeType = escapeHtml(item.originalMimeType || '—');
            const optimizationStatus = escapeHtml(item.optimizationStatus || '—');
            const optimizationError =
                typeof item.optimizationError === 'string' && item.optimizationError.trim().length > 0
                    ? escapeHtml(item.optimizationError)
                    : '';

            const metadataValue = item && typeof item === 'object' ? item.metadata : undefined;
            const hasMetadata =
                metadataValue &&
                typeof metadataValue === 'object' &&
                !Array.isArray(metadataValue) &&
                Object.keys(metadataValue).length > 0;
            const metadataText = hasMetadata ? escapeHtml(formatJson(metadataValue)) : '';

            const statusClass = typeof item.status === 'string' ? `status-${escapeHtml(item.status)}` : '';

            return `
                <div class="file-row">
                    <div class="file-row-main">
                        <div class="file-row-title">
                            <span class="file-row-filename">${filename}</span>
                            <span class="file-status-badge ${statusClass}">${status}</span>
                        </div>
                        <div class="file-row-meta">
                            <span><strong>ID:</strong> ${id}</span>
                            <span><strong>appId:</strong> ${appId}</span>
                            <span><strong>userId:</strong> ${userId}</span>
                            <span><strong>purpose:</strong> ${purpose}</span>
                            <span><strong>MIME:</strong> ${mimeType}</span>
                            <span><strong>Size:</strong> ${size}</span>
                            <span><strong>Original:</strong> ${originalMimeType} / ${originalSize}</span>
                            <span><strong>Uploaded:</strong> ${escapeHtml(uploadedAt)}</span>
                            <span><strong>Status:</strong> ${status}</span>
                            <span><strong>Status changed:</strong> ${escapeHtml(statusChangedAt || '—')}</span>
                            <span><strong>Optimization:</strong> ${optimizationStatus}</span>
                        </div>
                        ${optimizationError ? `<div class="file-row-warning"><strong>Optimization error:</strong> ${optimizationError}</div>` : ''}
                        ${hasMetadata
                    ? `<details class="file-row-details">
                                      <summary>metadata</summary>
                                      <pre class="file-row-metadata">${metadataText}</pre>
                                   </details>`
                    : ''
                }
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
