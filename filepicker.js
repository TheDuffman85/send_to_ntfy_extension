document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('drop-zone');
    const status = document.getElementById('status');

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
            processFile(files[0]);
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
        const file = e.target.files[0];
        if (file) {
            processFile(file);
        }
    });

    async function processFile(file) {
        dropZone.style.pointerEvents = 'none';
        dropZone.style.opacity = '0.6';

        try {
            const reader = new FileReader();

            reader.onload = async (event) => {
                try {
                    const base64Data = event.target.result;

                    // Use chrome.storage.local for larger files
                    await new Promise((resolve, reject) => {
                        chrome.storage.local.set({
                            storedFile: {
                                name: file.name,
                                type: file.type,
                                size: file.size,
                                data: base64Data
                            }
                        }, () => {
                            if (chrome.runtime.lastError) {
                                reject(chrome.runtime.lastError);
                            } else {
                                resolve();
                            }
                        });
                    });

                    status.textContent = `✓ "${file.name}" attached!`;
                    status.className = 'status visible success';

                    // Close window after short delay
                    setTimeout(() => {
                        window.close();
                    }, 800);

                } catch (err) {
                    showError('Error: ' + err.message);
                }
            };

            reader.onerror = () => {
                showError('Failed to read file');
            };

            reader.readAsDataURL(file);

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
