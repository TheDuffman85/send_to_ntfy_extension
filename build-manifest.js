const fs = require('fs');
const path = require('path');

const target = process.argv[2];
const manifestPath = path.join(__dirname, 'manifest.json');

try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (target === 'firefox') {
        // Firefox requires background.scripts instead of background.service_worker
        if (manifest.background && manifest.background.service_worker) {
            manifest.background.scripts = ['ntfy.js', manifest.background.service_worker];
            delete manifest.background.service_worker;
        }
    } else if (target === 'chrome') {
        // Chrome doesn't support browser_specific_settings
        if (manifest.browser_specific_settings) {
            delete manifest.browser_specific_settings;
        }
    }

    console.log(JSON.stringify(manifest, null, 2));
} catch (error) {
    console.error('Error processing manifest:', error);
    process.exit(1);
}
