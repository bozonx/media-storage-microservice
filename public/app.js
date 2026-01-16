const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');
const fileList = document.getElementById('fileList');
const uploadControls = document.getElementById('uploadControls');
const uploadBtn = document.getElementById('uploadBtn');
const clearBtn = document.getElementById('clearBtn');
const results = document.getElementById('results');

let selectedFiles = [];

function getBasePathPrefix() {
    const path = window.location.pathname;
    const idx = path.indexOf('/ui');
    if (idx <= 0) {
        return '';
    }
    return path.substring(0, idx);
}

function buildApiUrl(pathname) {
    const basePathPrefix = getBasePathPrefix();
    return `${basePathPrefix}${pathname}`;
}

function buildThumbnailUrl(fileId, params) {
    const basePathPrefix = getBasePathPrefix();
    const search = new URLSearchParams({
        width: String(params.width),
        height: String(params.height),
        ...(typeof params.quality === 'number' ? { quality: String(params.quality) } : {}),
    });
    return `${basePathPrefix}/files/${encodeURIComponent(fileId)}/thumbnail?${search.toString()}`;
}

browseBtn.addEventListener('click', () => {
    fileInput.click();
});

dropZone.addEventListener('click', (e) => {
    if (e.target !== browseBtn) {
        fileInput.click();
    }
});

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
});

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    addFiles(files);
    fileInput.value = '';
});

clearBtn.addEventListener('click', () => {
    selectedFiles = [];
    renderFileList();
    results.innerHTML = '';
});

uploadBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;
    
    uploadBtn.disabled = true;
    document.querySelector('.btn-text').style.display = 'none';
    document.querySelector('.btn-loader').style.display = 'block';
    results.innerHTML = '';
    
    for (const file of selectedFiles) {
        await uploadFile(file);
    }
    
    uploadBtn.disabled = false;
    document.querySelector('.btn-text').style.display = 'block';
    document.querySelector('.btn-loader').style.display = 'none';
    
    selectedFiles = [];
    renderFileList();
});

function addFiles(files) {
    files.forEach(file => {
        if (!selectedFiles.find(f => f.name === file.name && f.size === file.size)) {
            selectedFiles.push(file);
        }
    });
    renderFileList();
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    renderFileList();
}

function renderFileList() {
    if (selectedFiles.length === 0) {
        fileList.innerHTML = '';
        uploadControls.style.display = 'none';
        return;
    }
    
    uploadControls.style.display = 'flex';
    
    fileList.innerHTML = selectedFiles.map((file, index) => `
        <div class="file-item">
            <div class="file-info">
                <div class="file-icon">${getFileExtension(file.name)}</div>
                <div class="file-details">
                    <div class="file-name">${file.name}</div>
                    <div class="file-size">${formatFileSize(file.size)}</div>
                </div>
            </div>
            <button class="file-remove" onclick="removeFile(${index})">Remove</button>
        </div>
    `).join('');
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(buildApiUrl('/api/v1/files'), {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Upload failed');
        }
        
        const data = await response.json();
        showResult(file.name, data, true);
    } catch (error) {
        showResult(file.name, { error: error.message }, false);
    }
}

function showResult(fileName, data, success) {
    const resultItem = document.createElement('div');
    resultItem.className = `result-item ${success ? 'success' : 'error'}`;
    
    if (success) {
        const isImage = typeof data.mimeType === 'string' && data.mimeType.startsWith('image/');
        const thumbnailUrl = isImage ? buildThumbnailUrl(data.id, { width: 320, height: 320 }) : null;
        resultItem.innerHTML = `
            <span class="result-icon">✓</span>
            <div class="result-message">
                <strong>${fileName}</strong> uploaded successfully
                <div class="result-url">
                    ID: ${data.id} | 
                    <a href="${data.url}" target="_blank">View file</a>
                </div>
                ${
                    isImage
                        ? `
                    <div class="result-preview">
                        <div class="result-preview-label">Thumbnail preview</div>
                        <img class="result-preview-image" src="${thumbnailUrl}" alt="Thumbnail preview" loading="lazy">
                    </div>
                `
                        : ''
                }
            </div>
        `;

        if (isImage) {
            const img = resultItem.querySelector('.result-preview-image');
            const label = resultItem.querySelector('.result-preview-label');
            if (img && label) {
                img.addEventListener('error', () => {
                    label.textContent = 'Thumbnail preview (failed to load)';
                });
            }
        }
    } else {
        resultItem.innerHTML = `
            <span class="result-icon">✗</span>
            <div class="result-message">
                <strong>${fileName}</strong> failed to upload
                <div class="result-url">${data.error}</div>
            </div>
        `;
    }
    
    results.appendChild(resultItem);
}

function getFileExtension(filename) {
    const ext = filename.split('.').pop().toUpperCase();
    return ext.length > 4 ? 'FILE' : ext;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

window.removeFile = removeFile;
