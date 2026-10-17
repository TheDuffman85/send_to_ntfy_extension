document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const status = document.getElementById('status');
    const storedFilesKey = 'storedFiles';
    const legacyStoredFileKey = 'storedFile';

    // Apply theme
    const urlParams = new URLSearchParams(window.location.search);
    const theme = urlParams.get('theme') || 'auto';
    document.body.setAttribute('data-theme', theme);

    // Click handler for drop zone

    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    // Drag and drop handlers
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processFiles(Array.from(files));
        }
    });

    // Prevent default drag behavior on window
    window.addEventListener('dragover', (e) => {
        e.preventDefault();
    });

    window.addEventListener('drop', (e) => {
        e.preventDefault();
    });

    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        processFiles(files);
    });

    function getStoredFiles() {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get([storedFilesKey, legacyStoredFileKey], (result) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                let storedFiles = Array.isArray(result[storedFilesKey])
                    ? result[storedFilesKey]
                    : [];

                if (storedFiles.length === 0 && result[legacyStoredFileKey]) {
                    storedFiles = [result[legacyStoredFileKey]];
                }

                resolve(storedFiles);
            });
        });
    }

    function readFileAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (event) => {
                resolve({
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: event.target.result
                });
            };

            reader.onerror = () => reject(new Error(`Failed to read "${file.name}"`));
            reader.onabort = () => reject(new Error(`Reading "${file.name}" was cancelled`));
            reader.readAsDataURL(file);
        });
    }

    function storeFiles(files) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set({ [storedFilesKey]: files }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }

                chrome.storage.local.remove([legacyStoredFileKey], () => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }

    async function processFiles(files) {
        if (files.length === 0) return;

        dropZone.style.pointerEvents = 'none';
        dropZone.style.opacity = '0.6';

        try {
            // Read the whole selection before writing so a read error does not append a partial batch.
            const newFiles = await Promise.all(files.map(readFileAsDataUrl));
            const existingFiles = await getStoredFiles();
            await storeFiles([...existingFiles, ...newFiles]);

            const fileCount = files.length;
            status.textContent = `✓ ${fileCount} file${fileCount === 1 ? '' : 's'} attached!`;
            status.className = 'status visible success';

            // Close window after short delay
            setTimeout(() => {
                window.close();
            }, 800);
        } catch (error) {
            showError('Error: ' + error.message);
        }
    }

    function showError(message) {
        status.textContent = message;
        status.className = 'status visible error';
        dropZone.style.pointerEvents = '';
        dropZone.style.opacity = '';
    }
});
