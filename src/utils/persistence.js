const fs = require('fs');
const path = require('path');

const backupPath = path.resolve(__dirname, '../../backup_state.json');

const saveState = (data) => {
    try { fs.writeFileSync(backupPath, JSON.stringify(data, null, 2)); }
    catch (err) { console.error("❌ Gagal menyimpan backup:", err.message); }
};

const loadState = () => {
    try {
        if (fs.existsSync(backupPath)) {
            const data = fs.readFileSync(backupPath);
            return JSON.parse(data);
        }
    } catch (err) { console.error("❌ Gagal membaca backup:", err.message); }
    return { meter_lari: 0, joint_count: 0 };
};

module.exports = { saveState, loadState };
