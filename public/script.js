const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('webpFile');
const fileInputWrapper = document.getElementById('fileInputWrapper');
const fileSelectedDiv = document.getElementById('fileSelected');
const fileNameDisplay = document.getElementById('fileName');
const fileSizeDisplay = document.getElementById('fileSize');
const removeFileBtn = document.getElementById('removeFile');
const convertButton = document.getElementById('convertButton');
const progressSection = document.getElementById('progressSection');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const successSection = document.getElementById('successSection');

// Drag and drop handlers
fileInputWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileInputWrapper.classList.add('drag-over');
});

fileInputWrapper.addEventListener('dragleave', () => {
    fileInputWrapper.classList.remove('drag-over');
});

fileInputWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    fileInputWrapper.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        fileInput.files = files;
        displaySelectedFile(files[0]);
    }
});

// File input change handler
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        displaySelectedFile(e.target.files[0]);
    }
});

// Remove file handler
removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.value = '';
    hideSelectedFile();
});

// Display selected file info
function displaySelectedFile(file) {
    const fileName = file.name;
    const fileSize = formatFileSize(file.size);

    fileNameDisplay.textContent = fileName;
    fileSizeDisplay.textContent = fileSize;

    document.querySelector('.file-input-overlay').style.display = 'none';
    fileSelectedDiv.style.display = 'flex';
    // Disable pointer events on file input when file is selected
    fileInput.style.pointerEvents = 'none';
}

// Hide selected file info
function hideSelectedFile() {
    document.querySelector('.file-input-overlay').style.display = 'block';
    fileSelectedDiv.style.display = 'none';
    // Re-enable pointer events on file input
    fileInput.style.pointerEvents = 'auto';
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Form submission handler
uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!fileInput.files || fileInput.files.length === 0) {
        alert('請選擇一個 WebP 檔案');
        return;
    }

    const file = fileInput.files[0];

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.webp')) {
        alert('請選擇 .webp 檔案');
        return;
    }

    // Prepare form data
    const formData = new FormData();
    formData.append('webpFile', file);

    // Show progress
    uploadForm.style.display = 'none';
    progressSection.style.display = 'block';
    convertButton.disabled = true;

    // Simulate progress (since fetch doesn't provide upload progress easily)
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += 5;
        if (progress <= 90) {
            progressBar.style.width = progress + '%';
        }
    }, 200);

    try {
        const response = await fetch('/convert', {
            method: 'POST',
            body: formData
        });

        clearInterval(progressInterval);

        if (!response.ok) {
            throw new Error('轉換失敗');
        }

        // Complete progress
        progressBar.style.width = '100%';

        // Get the blob from response
        const blob = await response.blob();

        // Create download link
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = file.name.replace('.webp', '') + '.mp4';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        // Show success
        setTimeout(() => {
            progressSection.style.display = 'none';
            successSection.style.display = 'block';

            // Reset after 3 seconds
            setTimeout(() => {
                resetForm();
            }, 3000);
        }, 500);

    } catch (error) {
        clearInterval(progressInterval);
        console.error('Error:', error);
        alert('轉換過程中發生錯誤：' + error.message);
        resetForm();
    }
});

// Reset form
function resetForm() {
    uploadForm.reset();
    uploadForm.style.display = 'flex';
    progressSection.style.display = 'none';
    successSection.style.display = 'none';
    convertButton.disabled = false;
    hideSelectedFile();
    progressBar.style.width = '0%';
}
