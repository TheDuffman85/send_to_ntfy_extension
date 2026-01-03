document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const selectBtn = document.getElementById('select-btn');
    const status = document.getElementById('status');

    // Apply theme
    const urlParams = new URLSearchParams(window.location.search);
    const theme = urlParams.get('theme') || 'auto';
    document.body.setAttribute('data-theme', theme);

    selectBtn.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        selectBtn.disabled = true;
        selectBtn.textContent = 'Processing...';

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
                    status.textContent = 'Error: ' + err.message;
                    status.className = 'status visible error';
                    selectBtn.disabled = false;
                    selectBtn.textContent = '📁 Choose File';
                }
            };

            reader.onerror = () => {
                status.textContent = 'Failed to read file';
                status.className = 'status visible error';
                selectBtn.disabled = false;
                selectBtn.textContent = '📁 Choose File';
            };

            reader.readAsDataURL(file);

        } catch (error) {
            status.textContent = 'Error: ' + error.message;
            status.className = 'status visible error';
            selectBtn.disabled = false;
            selectBtn.textContent = '📁 Choose File';
        }
    });
});
