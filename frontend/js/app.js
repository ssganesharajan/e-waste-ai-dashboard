/**
 * EcoSort IoT Cloud Dashboard - Industrial AI Telemetry & E-Waste Classification Client
 */

// Global State
const STATE = {
    isAuthenticated: false,
    currentUser: null,
    currentTab: 'tab-telemetry',
    sourceMode: 'esp32', // 'esp32' | 'webcam' | 'upload'
    esp32Url: 'http://10.92.50.153',
    isAutoPolling: false,
    pollInterval: null,
    webcamStream: null,
    uploadedFile: null,
    selectedModelFile: null,
    activeModelInfo: {},
    classesDb: [],
    history: [],
    stats: {}
};

const API_BASE = ''; // Same-origin when served from FastAPI

// =========================================================================
// Initialization
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initNavigation();
    initDeviceSelector();
    initUploadDropzone();
    initModelManager();
    initHardwareSettings();
    initActionButtons();
    initFullscreen();

    // Start HUD Clock
    setInterval(updateHudClock, 1000);

    // Initial Data Fetch
    checkAuthSession();
});

function updateHudClock() {
    const el = document.getElementById('hud-timestamp');
    if (el) {
        el.textContent = `SYNC: ${new Date().toISOString().slice(11, 19)} UTC`;
    }
}

// =========================================================================
// Authentication (Admin / 12345678)
// =========================================================================

function initAuth() {
    const loginForm = document.getElementById('login-form');
    const btnLogin = document.getElementById('btn-login-submit');
    const btnFillDemo = document.getElementById('btn-fill-demo');
    const btnLogout = document.getElementById('btn-logout');

    if (btnLogin) {
        btnLogin.addEventListener('click', handleLoginSubmit);
    }

    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleLoginSubmit();
        });
    }

    if (btnFillDemo) {
        btnFillDemo.addEventListener('click', () => {
            document.getElementById('login-username').value = 'Admin';
            document.getElementById('login-password').value = '12345678';
            document.getElementById('login-error-alert').style.display = 'none';
        });
    }

    if (btnLogout) {
        btnLogout.addEventListener('click', handleLogout);
    }
}

function checkAuthSession() {
    const token = localStorage.getItem('ecosort_token');
    const userStr = localStorage.getItem('ecosort_user');

    if (token && userStr) {
        try {
            STATE.currentUser = JSON.parse(userStr);
            STATE.isAuthenticated = true;
            unlockDashboard(STATE.currentUser);
            loadInitialDashboardData();
            return;
        } catch (e) {
            console.error('Failed to parse user session:', e);
        }
    }

    // Default: Show login overlay
    showLoginOverlay();
}

async function handleLoginSubmit() {
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    const errorAlert = document.getElementById('login-error-alert');
    const errorText = document.getElementById('login-error-text');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
        errorText.textContent = 'Please enter both User ID and Password.';
        errorAlert.style.display = 'flex';
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (!resp.ok) {
            const errData = await resp.json();
            throw new Error(errData.detail || 'Authentication failed');
        }

        const data = await resp.json();
        localStorage.setItem('ecosort_token', data.token);
        localStorage.setItem('ecosort_user', JSON.stringify(data.user));

        STATE.isAuthenticated = true;
        STATE.currentUser = data.user;

        errorAlert.style.display = 'none';
        unlockDashboard(data.user);
        loadInitialDashboardData();

    } catch (err) {
        errorText.textContent = err.message || 'Invalid User ID or Password.';
        errorAlert.style.display = 'flex';
    }
}

function unlockDashboard(user) {
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    
    const userDisplay = document.getElementById('nav-user-display');
    if (userDisplay) {
        userDisplay.textContent = user.username || 'Admin';
    }
}

function showLoginOverlay() {
    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
}

function handleLogout() {
    if (!confirm('Are you sure you want to sign out?')) return;
    localStorage.removeItem('ecosort_token');
    localStorage.removeItem('ecosort_user');
    STATE.isAuthenticated = false;
    STATE.currentUser = null;

    // Stop streams
    if (STATE.webcamStream) stopWebcam();
    if (STATE.isAutoPolling) toggleAutoPolling();

    showLoginOverlay();
}

function loadInitialDashboardData() {
    checkSystemStatus();
    loadCatalogClasses();
    loadScanHistory();
    loadAnalytics();
    loadModelInfo();

    // Periodic health check
    setInterval(checkSystemStatus, 8000);
}

// =========================================================================
// Navigation & Tabs
// =========================================================================

function initNavigation() {
    const navButtons = document.querySelectorAll('.tb-nav-item');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });

    const btnNavUpload = document.getElementById('btn-nav-upload');
    if (btnNavUpload) {
        btnNavUpload.addEventListener('click', () => {
            switchTab('tab-telemetry');
            setSourceMode('upload');
            const fileInput = document.getElementById('file-input');
            if (fileInput && !STATE.uploadedFile) {
                fileInput.click();
            }
        });
    }

    const btnNavModel = document.getElementById('btn-nav-model');
    if (btnNavModel) {
        btnNavModel.addEventListener('click', () => {
            switchTab('tab-device-config');
        });
    }
}

function switchTab(tabId) {
    STATE.currentTab = tabId;

    // Update active nav button
    document.querySelectorAll('.tb-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    // Update active tab pane
    document.querySelectorAll('.tb-tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === tabId);
    });

    // Refresh context data
    if (tabId === 'tab-events') {
        loadScanHistory();
    } else if (tabId === 'tab-analytics') {
        loadAnalytics();
    } else if (tabId === 'tab-device-config') {
        loadModelInfo();
    }
}

// =========================================================================
// Device & Mode Selector
// =========================================================================

function initDeviceSelector() {
    const deviceSelect = document.getElementById('device-select');
    if (deviceSelect) {
        deviceSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'esp32-cam-01') {
                setSourceMode('esp32');
            } else if (val === 'webcam-local') {
                setSourceMode('webcam');
            } else if (val === 'manual-ingest') {
                setSourceMode('upload');
            }
        });
    }
}

window.setSourceMode = function(mode) {
    STATE.sourceMode = mode;

    // Update Dropdown
    const deviceSelect = document.getElementById('device-select');
    if (deviceSelect) {
        if (mode === 'esp32') deviceSelect.value = 'esp32-cam-01';
        else if (mode === 'webcam') deviceSelect.value = 'webcam-local';
        else if (mode === 'upload') deviceSelect.value = 'manual-ingest';
    }

    // Update Mode Buttons
    const btnEsp32 = document.getElementById('mode-btn-esp32');
    const btnWebcam = document.getElementById('mode-btn-webcam');
    const btnUpload = document.getElementById('mode-btn-upload');

    if (btnEsp32) btnEsp32.classList.toggle('active', mode === 'esp32');
    if (btnWebcam) btnWebcam.classList.toggle('active', mode === 'webcam');
    if (btnUpload) btnUpload.classList.toggle('active', mode === 'upload');

    // Update Viewports
    document.getElementById('viewport-esp32').style.display = mode === 'esp32' ? 'flex' : 'none';
    document.getElementById('viewport-webcam').style.display = mode === 'webcam' ? 'flex' : 'none';
    document.getElementById('viewport-upload').style.display = mode === 'upload' ? 'flex' : 'none';

    // Update Title
    const titleEl = document.getElementById('viewport-header-title');
    if (titleEl) {
        if (mode === 'esp32') titleEl.textContent = 'ESP32-CAM Optical Sensor Feed';
        else if (mode === 'webcam') titleEl.textContent = 'Local Web Camera Ingestion';
        else titleEl.textContent = 'Manual Image Ingestion & AI Classifier';
    }

    // Shutdown webcam if leaving
    if (mode !== 'webcam' && STATE.webcamStream) {
        stopWebcam();
    }

    // Update Action Button Text
    const analyzeBtnText = document.getElementById('analyze-btn-text');
    if (analyzeBtnText) {
        if (mode === 'esp32') {
            analyzeBtnText.textContent = 'Acquire Frame from ESP32 & Classify';
        } else if (mode === 'webcam') {
            analyzeBtnText.textContent = 'Capture Web Camera Frame & Classify';
        } else {
            analyzeBtnText.textContent = 'Classify Uploaded Image';
        }
    }
};

// =========================================================================
// Fullscreen Control
// =========================================================================

function initFullscreen() {
    const btn = document.getElementById('btn-fullscreen');
    if (btn) {
        btn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        });
    }
}

// =========================================================================
// Webcam Stream Handler
// =========================================================================

const btnStartWebcam = document.getElementById('btn-start-webcam');
if (btnStartWebcam) {
    btnStartWebcam.addEventListener('click', startWebcam);
}

async function startWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        STATE.webcamStream = stream;
        const video = document.getElementById('webcam-video');
        video.srcObject = stream;
        video.style.display = 'block';
        document.getElementById('webcam-placeholder').style.display = 'none';
    } catch (err) {
        alert('Could not access webcam: ' + err.message);
    }
}

function stopWebcam() {
    if (STATE.webcamStream) {
        STATE.webcamStream.getTracks().forEach(track => track.stop());
        STATE.webcamStream = null;
        document.getElementById('webcam-video').style.display = 'none';
        document.getElementById('webcam-placeholder').style.display = 'flex';
    }
}

function captureWebcamFrame() {
    const video = document.getElementById('webcam-video');
    const canvas = document.getElementById('webcam-canvas');
    if (!video || !video.videoWidth) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
}

// =========================================================================
// Upload & Drag-and-Drop Handler (Manual Image Ingest)
// =========================================================================

function initUploadDropzone() {
    const dropzone = document.getElementById('dropzone-area');
    const fileInput = document.getElementById('file-input');
    const btnBrowse = document.getElementById('btn-browse-file');
    const btnClear = document.getElementById('btn-clear-upload');
    const btnSample = document.getElementById('btn-load-sample');

    if (btnBrowse) {
        btnBrowse.addEventListener('click', (e) => {
            e.stopPropagation();
            fileInput.click();
        });
    }

    if (dropzone) {
        dropzone.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleSelectedImageFile(e.target.files[0]);
            }
        });
    }

    if (btnClear) {
        btnClear.addEventListener('click', (e) => {
            e.stopPropagation();
            clearUploadPreview();
        });
    }

    if (btnSample) {
        btnSample.addEventListener('click', (e) => {
            e.stopPropagation();
            loadDemoSampleImage();
        });
    }

    const viewportUpload = document.getElementById('viewport-upload');
    if (viewportUpload) {
        viewportUpload.addEventListener('dragover', (e) => {
            e.preventDefault();
            viewportUpload.classList.add('drag-active');
        });

        viewportUpload.addEventListener('dragleave', () => {
            viewportUpload.classList.remove('drag-active');
        });

        viewportUpload.addEventListener('drop', (e) => {
            e.preventDefault();
            viewportUpload.classList.remove('drag-active');
            if (e.dataTransfer.files.length > 0) {
                handleSelectedImageFile(e.dataTransfer.files[0]);
            }
        });
    }
}

function handleSelectedImageFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please upload a valid image file (JPEG, PNG, WebP, BMP).');
        return;
    }
    STATE.uploadedFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        const previewBox = document.getElementById('upload-preview-box');
        const previewImg = document.getElementById('upload-preview-img');
        const fileNameEl = document.getElementById('upload-file-name');
        const fileSizeEl = document.getElementById('upload-file-size');

        previewImg.src = e.target.result;
        fileNameEl.textContent = file.name;
        fileSizeEl.textContent = formatBytes(file.size);

        previewBox.style.display = 'flex';
        document.getElementById('dropzone-area').style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function clearUploadPreview() {
    STATE.uploadedFile = null;
    document.getElementById('file-input').value = '';
    document.getElementById('upload-preview-box').style.display = 'none';
    document.getElementById('dropzone-area').style.display = 'flex';
}

function loadDemoSampleImage() {
    // Generate synthetic circuit board canvas image for demo testing
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');

    // Background PCB green
    ctx.fillStyle = '#0f381e';
    ctx.fillRect(0, 0, 400, 300);

    // Traces
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo(20, 30 + i * 35);
        ctx.lineTo(150, 30 + i * 35);
        ctx.lineTo(220, 60 + i * 30);
        ctx.lineTo(380, 60 + i * 30);
        ctx.stroke();
    }

    // Microchip
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(140, 100, 120, 100);
    ctx.strokeStyle = '#94a3b8';
    ctx.strokeRect(140, 100, 120, 100);

    // Chip text
    ctx.fillStyle = '#00f5d4';
    ctx.font = 'bold 12px monospace';
    ctx.fillText('ECO-SORT AI', 155, 145);
    ctx.fillText('ARM CORTEX', 158, 165);

    // Convert to blob and load as file
    canvas.toBlob((blob) => {
        const file = new File([blob], 'demo_circuit_board.jpg', { type: 'image/jpeg' });
        handleSelectedImageFile(file);
    }, 'image/jpeg', 0.9);
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else return (bytes / 1048576).toFixed(2) + ' MB';
}

// =========================================================================
// AI Neural Model Manager & Hot-Reload Hub
// =========================================================================

function initModelManager() {
    const modelDropzone = document.getElementById('model-dropzone');
    const modelFileInput = document.getElementById('model-file-input');
    const btnBrowseModel = document.getElementById('btn-browse-model');
    const btnClearModel = document.getElementById('btn-clear-selected-model');
    const btnUploadSubmit = document.getElementById('btn-upload-model-submit');
    const btnResetModel = document.getElementById('btn-reset-default-model');

    if (btnBrowseModel) {
        btnBrowseModel.addEventListener('click', (e) => {
            e.stopPropagation();
            modelFileInput.click();
        });
    }

    if (modelDropzone) {
        modelDropzone.addEventListener('click', () => modelFileInput.click());

        modelDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            modelDropzone.classList.add('drag-active');
        });

        modelDropzone.addEventListener('dragleave', () => {
            modelDropzone.classList.remove('drag-active');
        });

        modelDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            modelDropzone.classList.remove('drag-active');
            if (e.dataTransfer.files.length > 0) {
                handleSelectedModelFile(e.dataTransfer.files[0]);
            }
        });
    }

    if (modelFileInput) {
        modelFileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleSelectedModelFile(e.target.files[0]);
            }
        });
    }

    if (btnClearModel) {
        btnClearModel.addEventListener('click', clearSelectedModel);
    }

    if (btnUploadSubmit) {
        btnUploadSubmit.addEventListener('click', handleModelUploadSubmit);
    }

    if (btnResetModel) {
        btnResetModel.addEventListener('click', handleModelReset);
    }
}

function handleSelectedModelFile(file) {
    if (!file.name.toLowerCase().endsWith('.tflite')) {
        alert('Please select a TensorFlow Lite model file with .tflite extension.');
        return;
    }
    STATE.selectedModelFile = file;

    const banner = document.getElementById('selected-model-banner');
    const nameEl = document.getElementById('selected-model-filename');
    const sizeEl = document.getElementById('selected-model-filesize');

    nameEl.textContent = file.name;
    sizeEl.textContent = `(${formatBytes(file.size)})`;
    banner.style.display = 'flex';
}

function clearSelectedModel() {
    STATE.selectedModelFile = null;
    document.getElementById('model-file-input').value = '';
    document.getElementById('selected-model-banner').style.display = 'none';
}

async function loadModelInfo() {
    try {
        const resp = await fetch(`${API_BASE}/api/model/info`);
        if (resp.ok) {
            const data = await resp.json();
            STATE.activeModelInfo = data;

            // Update DOM
            const nameEl = document.getElementById('model-info-name');
            const archEl = document.getElementById('model-info-arch');
            const sizeEl = document.getElementById('model-info-size');
            const resEl = document.getElementById('model-info-res');
            const navModel = document.getElementById('active-model-name-nav');
            const sidebarModel = document.getElementById('sidebar-model-name');

            if (nameEl) nameEl.textContent = data.model_name;
            if (archEl) archEl.textContent = data.architecture || 'MobileNetV2';
            if (sizeEl) sizeEl.textContent = data.size_formatted;
            if (resEl && data.input_shape) resEl.textContent = `${data.input_shape[1]}x${data.input_shape[2]}x${data.input_shape[3] || 3}`;
            if (navModel) navModel.textContent = data.model_name;
            if (sidebarModel) sidebarModel.textContent = data.model_name;
        }
    } catch (e) {
        console.error('Failed to load model info:', e);
    }
}

async function handleModelUploadSubmit() {
    const alertBox = document.getElementById('model-feedback-alert');
    if (!STATE.selectedModelFile) {
        alertBox.className = 'tb-feedback-alert tb-feedback-error';
        alertBox.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Please select or drop a .tflite model file first.';
        alertBox.style.display = 'flex';
        return;
    }

    alertBox.className = 'tb-feedback-alert tb-feedback-success';
    alertBox.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Validating model tensors and hot-reloading into runtime interpreter...';
    alertBox.style.display = 'flex';

    try {
        const formData = new FormData();
        formData.append('model_file', STATE.selectedModelFile);

        const resp = await fetch(`${API_BASE}/api/model/upload`, {
            method: 'POST',
            body: formData
        });

        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err.detail || 'Model hot-reload failed');
        }

        const data = await resp.json();
        alertBox.className = 'tb-feedback-alert tb-feedback-success';
        alertBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> <strong>Success!</strong> ${data.message}`;

        clearSelectedModel();
        loadModelInfo();
        checkSystemStatus();

    } catch (err) {
        alertBox.className = 'tb-feedback-alert tb-feedback-error';
        alertBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>Upload Failed:</strong> ${err.message}`;
    }
}

async function handleModelReset() {
    if (!confirm('Restore default factory MobileNetV2 e-waste classification model?')) return;
    const alertBox = document.getElementById('model-feedback-alert');

    try {
        const resp = await fetch(`${API_BASE}/api/model/reset`, { method: 'POST' });
        if (!resp.ok) throw new Error('Reset failed');
        const data = await resp.json();

        alertBox.className = 'tb-feedback-alert tb-feedback-success';
        alertBox.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${data.message}`;
        alertBox.style.display = 'flex';

        loadModelInfo();
        checkSystemStatus();
    } catch (err) {
        alertBox.className = 'tb-feedback-alert tb-feedback-error';
        alertBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${err.message}`;
        alertBox.style.display = 'flex';
    }
}

// =========================================================================
// Action Buttons & Classification Triggers
// =========================================================================

function initActionButtons() {
    const btnTrigger = document.getElementById('btn-trigger-analyze');
    if (btnTrigger) btnTrigger.addEventListener('click', handleTriggerAnalyze);

    const btnRefresh = document.getElementById('btn-refresh-feed');
    if (btnRefresh) btnRefresh.addEventListener('click', refreshEsp32Snapshot);

    const btnToggleStream = document.getElementById('btn-toggle-auto-stream');
    if (btnToggleStream) btnToggleStream.addEventListener('click', toggleAutoPolling);

    const btnExport = document.getElementById('btn-export-csv');
    if (btnExport) btnExport.addEventListener('click', exportHistoryCSV);

    const btnClearHistory = document.getElementById('btn-clear-history');
    if (btnClearHistory) btnClearHistory.addEventListener('click', clearHistory);
}

async function handleTriggerAnalyze() {
    setLoadingState(true);

    try {
        let result;
        if (STATE.sourceMode === 'esp32') {
            const resp = await fetch(`${API_BASE}/api/analyze-esp32`, { method: 'POST' });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'ESP32 capture failed.');
            }
            result = await resp.json();
        } else if (STATE.sourceMode === 'webcam') {
            const frameBase64 = captureWebcamFrame();
            if (!frameBase64) {
                throw new Error('Please activate the webcam first.');
            }
            const resp = await fetch(`${API_BASE}/api/analyze-base64`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: frameBase64, source: 'Web Camera' })
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Webcam classification failed.');
            }
            result = await resp.json();
        } else if (STATE.sourceMode === 'upload') {
            if (!STATE.uploadedFile) {
                throw new Error('Please browse or drop an e-waste image file first.');
            }
            const formData = new FormData();
            formData.append('file', STATE.uploadedFile);
            const resp = await fetch(`${API_BASE}/api/analyze-upload`, {
                method: 'POST',
                body: formData
            });
            if (!resp.ok) {
                const err = await resp.json();
                throw new Error(err.detail || 'Image upload classification failed.');
            }
            result = await resp.json();
        }

        renderClassificationResult(result);
        loadScanHistory();
        loadAnalytics();

    } catch (err) {
        alert(`Telemetry Ingestion Error: ${err.message}`);
        setLoadingState(false);
    }
}

function setLoadingState(isLoading) {
    document.getElementById('results-empty').style.display = 'none';
    document.getElementById('results-content').style.display = isLoading ? 'none' : 'block';
    document.getElementById('results-loading').style.display = isLoading ? 'flex' : 'none';
}

function renderClassificationResult(data) {
    setLoadingState(false);

    const pred = data.prediction;

    // Badges & Latency
    document.getElementById('inference-time-badge').textContent = `${data.inference_time_ms} ms (${data.source})`;
    document.getElementById('kpi-ai-latency').textContent = `${data.inference_time_ms} ms`;
    document.getElementById('sidebar-latency').textContent = `${data.inference_time_ms} ms`;

    // Panel Details
    document.getElementById('res-icon').textContent = pred.icon || '📦';
    document.getElementById('res-category').textContent = pred.category;
    document.getElementById('res-name').textContent = pred.name;
    document.getElementById('res-confidence').textContent = pred.confidence_percent;

    // Hazard Badge
    const hazardTag = document.getElementById('res-hazard');
    hazardTag.textContent = `Hazard: ${pred.hazard_level}`;
    hazardTag.style.backgroundColor = pred.hazard_color + '22';
    hazardTag.style.color = pred.hazard_color;
    hazardTag.style.border = `1px solid ${pred.hazard_color}55`;

    // Description
    document.getElementById('res-description').textContent = pred.description;

    // Top-3 Probability Distribution Bars
    const topContainer = document.getElementById('top-predictions-list');
    topContainer.innerHTML = '';
    (data.top_predictions || []).forEach(item => {
        const row = document.createElement('div');
        row.className = 'tb-prob-row';
        row.innerHTML = `
            <span class="tb-prob-title">${item.icon || '📦'} ${item.name}</span>
            <div class="tb-bar-track">
                <div class="tb-bar-fill" style="width: ${Math.round(item.confidence * 100)}%;"></div>
            </div>
            <span class="tb-prob-num">${item.confidence_percent}</span>
        `;
        topContainer.appendChild(row);
    });

    // Recyclable Badges
    const recContainer = document.getElementById('res-recyclable-list');
    recContainer.innerHTML = '';
    (pred.recyclable_materials || []).forEach(mat => {
        const li = document.createElement('li');
        li.textContent = mat;
        recContainer.appendChild(li);
    });

    // Hazardous Badges
    const hazContainer = document.getElementById('res-hazardous-list');
    hazContainer.innerHTML = '';
    (pred.hazardous_substances || []).forEach(sub => {
        const li = document.createElement('li');
        li.textContent = sub;
        hazContainer.appendChild(li);
    });

    // Recycling Steps
    const stepsContainer = document.getElementById('res-steps-list');
    stepsContainer.innerHTML = '';
    (pred.recycling_steps || []).forEach(step => {
        const li = document.createElement('li');
        li.textContent = step;
        stepsContainer.appendChild(li);
    });

    // Impact Footer
    document.getElementById('res-co2').textContent = `${pred.co2_savings_kg} kg`;
    document.getElementById('res-recovery').textContent = pred.material_recovery_rate || '90%';
    document.getElementById('res-reuse').textContent = pred.reuse_potential ? pred.reuse_potential.split(';')[0] : 'Recycling';
}

// =========================================================================
// ESP32 Live Stream & Polling
// =========================================================================

function refreshEsp32Snapshot() {
    const streamImg = document.getElementById('esp32-stream-img');
    const placeholder = document.getElementById('esp32-placeholder');

    streamImg.src = `${API_BASE}/api/esp32/camera?t=${new Date().getTime()}`;
    streamImg.onload = () => {
        streamImg.style.display = 'block';
        placeholder.style.display = 'none';
        document.getElementById('hud-status').textContent = 'STATUS: STREAMING';
    };
    streamImg.onerror = () => {
        streamImg.style.display = 'none';
        placeholder.style.display = 'flex';
        document.getElementById('hud-status').textContent = 'STATUS: OFFLINE';
    };
}

function toggleAutoPolling() {
    STATE.isAutoPolling = !STATE.isAutoPolling;
    const btn = document.getElementById('btn-toggle-auto-stream');

    if (STATE.isAutoPolling) {
        btn.classList.add('tb-btn-primary');
        btn.innerHTML = '<i class="fa-solid fa-pause"></i> Stop Polling';
        refreshEsp32Snapshot();
        STATE.pollInterval = setInterval(refreshEsp32Snapshot, 1500);
    } else {
        btn.classList.remove('tb-btn-primary');
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Auto Poll Stream';
        clearInterval(STATE.pollInterval);
    }
}

// =========================================================================
// Hardware / IoT Settings & Ping
// =========================================================================

function initHardwareSettings() {
    const btnSaveUrl = document.getElementById('btn-save-esp32-url');
    const inputUrl = document.getElementById('input-esp32-url');
    const btnPing = document.getElementById('btn-test-ping');
    const btnPingQuick = document.getElementById('btn-ping-esp32');
    const cloudIngestInput = document.getElementById('cloud-ingest-url');
    const btnCopyCloudUrl = document.getElementById('btn-copy-cloud-url');

    // Auto-detect and populate cloud ingestion URL based on current host
    if (cloudIngestInput) {
        const detectedUrl = `${window.location.origin}/upload`;
        cloudIngestInput.value = detectedUrl;
    }

    if (btnCopyCloudUrl && cloudIngestInput) {
        btnCopyCloudUrl.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(cloudIngestInput.value);
                const originalHtml = btnCopyCloudUrl.innerHTML;
                btnCopyCloudUrl.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                setTimeout(() => { btnCopyCloudUrl.innerHTML = originalHtml; }, 2000);
            } catch (err) {
                cloudIngestInput.select();
                document.execCommand('copy');
                alert('Copied Cloud Ingestion URL to clipboard!');
            }
        });
    }

    if (btnSaveUrl) {
        btnSaveUrl.addEventListener('click', async () => {
            const url = inputUrl.value.trim();
            if (!url) return;
            try {
                const resp = await fetch(`${API_BASE}/api/esp32/update-url`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });
                const data = await resp.json();
                STATE.esp32Url = data.current_url;
                document.getElementById('esp32-status-text').textContent = STATE.esp32Url.replace('http://', '');
                document.getElementById('hud-ip-display').textContent = STATE.esp32Url.replace('http://', '');
                document.getElementById('esp32-url-display').textContent = `Endpoint: ${STATE.esp32Url}/capture`;
                alert(data.message);
            } catch (e) {
                alert('Failed to update URL: ' + e.message);
            }
        });
    }

    const handlePing = async () => {
        const details = document.getElementById('ping-details-content');
        if (details) {
            details.innerHTML = '<p class="tb-text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Executing ICMP/HTTP ping to ESP32-CAM node...</p>';
        }
        try {
            const resp = await fetch(`${API_BASE}/api/esp32/ping`);
            const data = await resp.json();
            if (data.online) {
                if (details) {
                    details.innerHTML = `
                        <p class="text-green"><i class="fa-solid fa-circle-check"></i> <strong>Node Active & Responding!</strong></p>
                        <p>Endpoint: <code>${data.url}</code></p>
                        <p>Round-Trip Latency: <strong>${data.latency_ms} ms</strong></p>
                    `;
                }
                document.getElementById('esp32-dot').className = 'tb-dot tb-dot-success';
                refreshEsp32Snapshot();
            } else {
                if (details) {
                    details.innerHTML = `
                        <p class="text-red"><i class="fa-solid fa-triangle-exclamation"></i> <strong>Node Unreachable</strong></p>
                        <p>Target: <code>${data.url}</code></p>
                        <small class="tb-text-muted">Ensure ESP32-CAM is powered and on the same WiFi subnet.</small>
                    `;
                }
                document.getElementById('esp32-dot').className = 'tb-dot tb-dot-danger';
            }
        } catch (e) {
            if (details) details.innerHTML = `<p class="text-red">Ping failed: ${e.message}</p>`;
        }
    };

    if (btnPing) btnPing.addEventListener('click', handlePing);
    if (btnPingQuick) btnPingQuick.addEventListener('click', handlePing);
}

// =========================================================================
// Backend Status & Data Fetchers
// =========================================================================

async function checkSystemStatus() {
    try {
        const resp = await fetch(`${API_BASE}/api/status`);
        if (resp.ok) {
            const data = await resp.json();
            document.getElementById('backend-status-text').textContent = 'Online';
            document.getElementById('esp32-status-text').textContent = data.esp32_cam_url.replace('http://', '');
            document.getElementById('hud-ip-display').textContent = data.esp32_cam_url.replace('http://', '');
            document.getElementById('input-esp32-url').value = data.esp32_cam_url;
            STATE.esp32Url = data.esp32_cam_url;

            if (data.active_model) {
                const navModel = document.getElementById('active-model-name-nav');
                const sidebarModel = document.getElementById('sidebar-model-name');
                if (navModel) navModel.textContent = data.active_model;
                if (sidebarModel) sidebarModel.textContent = data.active_model;
            }
        }
    } catch (e) {
        document.getElementById('backend-status-text').textContent = 'Offline';
    }
}

async function loadCatalogClasses() {
    try {
        const resp = await fetch(`${API_BASE}/api/classes`);
        const data = await resp.json();
        STATE.classesDb = data.classes || [];

        const grid = document.getElementById('catalog-grid');
        if (!grid) return;
        grid.innerHTML = '';

        STATE.classesDb.forEach(c => {
            const card = document.createElement('div');
            card.className = 'tb-catalog-card';
            card.innerHTML = `
                <div class="tb-catalog-header">
                    <span class="tb-catalog-icon">${c.icon || '📦'}</span>
                    <span class="tb-hazard-badge" style="background:${c.hazard_color}22; color:${c.hazard_color}; border:1px solid ${c.hazard_color}55;">
                        ${c.hazard_level} Hazard
                    </span>
                </div>
                <h3 class="tb-catalog-title">${c.name}</h3>
                <div class="tb-category-tag" style="margin-bottom:8px;">${c.category}</div>
                <p class="tb-catalog-desc">${c.description}</p>
                <div style="font-size:10px; margin-bottom:4px; color:var(--tb-text-dim);">
                    <strong style="color:var(--tb-text-muted);">Key Materials:</strong> ${c.recyclable_materials.slice(0, 3).join(', ')}
                </div>
                <div style="font-size:10px; color:var(--tb-cyan);">
                    <strong>CO₂ Offset:</strong> ${c.co2_savings_kg} kg / unit
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (e) {
        console.error('Failed to load classes catalog:', e);
    }
}

async function loadScanHistory() {
    try {
        const resp = await fetch(`${API_BASE}/api/history?limit=50`);
        const data = await resp.json();
        STATE.history = data.history || [];

        const tbody = document.getElementById('history-table-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (STATE.history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="tb-text-center tb-text-muted" style="padding: 40px;">No telemetry events recorded yet.</td></tr>';
            return;
        }

        STATE.history.forEach(item => {
            const pred = item.prediction;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-family:var(--tb-font-mono); font-size:10px;">${item.timestamp}</td>
                <td><span class="tb-pill" style="font-size:10px;">${item.source}</span></td>
                <td><img src="${item.thumbnail || ''}" class="tb-thumb" alt="thumb"></td>
                <td><strong>${pred.icon || '📦'} ${pred.name}</strong></td>
                <td><span class="tb-category-tag">${pred.category}</span></td>
                <td style="font-family:var(--tb-font-mono); font-weight:700; color:var(--tb-cyan);">${pred.confidence_percent}</td>
                <td><span class="tb-hazard-badge" style="background:${pred.hazard_color}22; color:${pred.hazard_color};">${pred.hazard_level}</span></td>
                <td style="font-weight:700; color:var(--tb-emerald);">${pred.co2_savings_kg} kg</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        console.error('Failed to load scan history:', e);
    }
}

async function loadAnalytics() {
    try {
        const resp = await fetch(`${API_BASE}/api/stats`);
        const data = await resp.json();
        STATE.stats = data;

        // Sidebar & KPI Ribbon
        document.getElementById('sidebar-total-scans').textContent = `${data.total_scans} items`;
        document.getElementById('sidebar-co2-saved').textContent = `${data.total_co2_saved_kg} kg`;
        document.getElementById('kpi-total-scans').textContent = data.total_scans;
        document.getElementById('kpi-co2-saved').textContent = `${data.total_co2_saved_kg} kg`;
        document.getElementById('kpi-hazard-count').textContent = data.hazard_distribution.High || 0;

        // Analytics Tab
        document.getElementById('stats-total-co2').textContent = `${data.total_co2_saved_kg} kg`;
        document.getElementById('stats-total-items').textContent = data.total_scans;
        document.getElementById('stats-hazardous-items').textContent = data.hazard_distribution.High || 0;
        document.getElementById('stats-top-item').textContent = data.top_item || 'None';

        // Hazard Distribution Meters
        const total = data.total_scans || 1;
        const high = data.hazard_distribution.High || 0;
        const mod = data.hazard_distribution.Moderate || 0;
        const low = data.hazard_distribution.Low || 0;

        document.getElementById('cnt-high').textContent = high;
        document.getElementById('cnt-mod').textContent = mod;
        document.getElementById('cnt-low').textContent = low;

        document.getElementById('bar-high').style.width = `${(high / total) * 100}%`;
        document.getElementById('bar-mod').style.width = `${(mod / total) * 100}%`;
        document.getElementById('bar-low').style.width = `${(low / total) * 100}%`;

        // Category breakdown list
        const catContainer = document.getElementById('category-distribution-container');
        if (catContainer && data.total_scans > 0 && Object.keys(data.category_counts).length > 0) {
            catContainer.innerHTML = '';
            for (const [catName, count] of Object.entries(data.category_counts)) {
                const row = document.createElement('div');
                row.className = 'tb-prob-row';
                row.style.marginBottom = '8px';
                row.innerHTML = `
                    <span class="tb-prob-title">${catName}</span>
                    <div class="tb-bar-track">
                        <div class="tb-bar-fill" style="width: ${(count / total) * 100}%;"></div>
                    </div>
                    <span class="tb-prob-num">${count} events</span>
                `;
                catContainer.appendChild(row);
            }
        }
    } catch (e) {
        console.error('Failed to load analytics:', e);
    }
}

async function clearHistory() {
    if (!confirm('Clear all telemetry audit logs?')) return;
    try {
        await fetch(`${API_BASE}/api/history/clear`, { method: 'POST' });
        loadScanHistory();
        loadAnalytics();
    } catch (e) {
        alert('Failed to clear logs: ' + e.message);
    }
}

function exportHistoryCSV() {
    if (STATE.history.length === 0) {
        alert('No audit logs to export.');
        return;
    }

    const headers = ['ID', 'Timestamp', 'Source', 'Item Name', 'Category', 'Confidence', 'Hazard Level', 'CO2 Offset (kg)', 'Recyclable Materials'];
    const rows = STATE.history.map(item => [
        item.id,
        item.timestamp,
        item.source,
        `"${item.prediction.name}"`,
        `"${item.prediction.category}"`,
        item.prediction.confidence_percent,
        item.prediction.hazard_level,
        item.prediction.co2_savings_kg,
        `"${(item.prediction.recyclable_materials || []).join('; ')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `iot_ewaste_telemetry_log_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
