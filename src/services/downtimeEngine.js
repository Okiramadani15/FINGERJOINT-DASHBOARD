const pool = require('../../config/db');
const { getShiftInfo } = require('../utils/shiftManager');

const MIN_DOWNTIME_SEC = 60;

let activeDowntime = null;
let powerOffSince = null;

async function handlePowerState({ machineId, shiftNumber, isPowerOn }) {
    const shiftInfo = getShiftInfo();

    // ❌ DI LUAR SHIFT → ABAIKAN
    if (!shiftInfo.shift || shiftInfo.shift === '-') {
        powerOffSince = null;
        return;
    }

    const now = new Date();

    // ================= POWER OFF =================
    if (!isPowerOn) {
        if (!powerOffSince) {
            powerOffSince = now;
        }

        const diffSec = Math.floor((now - powerOffSince) / 1000);

        if (!activeDowntime && diffSec >= MIN_DOWNTIME_SEC) {
            const res = await pool.query(`
                INSERT INTO machine_downtime_logs
                (machine_id, shift_number, start_time)
                VALUES ($1, $2, $3)
                RETURNING id
            `, [machineId, shiftNumber, powerOffSince]);

            activeDowntime = res.rows[0].id;
            console.log("🛑 Downtime START");
        }

        return;
    }

    // ================= POWER ON =================
    powerOffSince = null;

    if (activeDowntime) {
        await pool.query(`
            UPDATE machine_downtime_logs
            SET end_time = $1,
                duration_sec = EXTRACT(EPOCH FROM ($1 - start_time))
            WHERE id = $2
        `, [now, activeDowntime]);

        console.log("✅ Downtime END");
        activeDowntime = null;
    }
}

module.exports = { handlePowerState };
