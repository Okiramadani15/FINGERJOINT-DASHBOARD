const pool = require('../../config/db');

const MIN_DOWNTIME_SEC = 60;

let activeDowntimeId = null;
let powerOffSince = null;

async function handlePowerState({ machineId, shiftNumber, isPowerOn }) {
    const now = new Date();

    if (!isPowerOn) {
        if (!powerOffSince) powerOffSince = now;

        const diffSec = Math.floor((now - powerOffSince) / 1000);

        if (!activeDowntimeId && diffSec >= MIN_DOWNTIME_SEC) {
            const res = await pool.query(`
                INSERT INTO machine_downtime_logs
                (machine_id, shift_number, start_time)
                VALUES ($1, $2, $3)
                RETURNING id
            `, [machineId, shiftNumber, powerOffSince]);

            activeDowntimeId = res.rows[0].id;
            console.log('🛑 Downtime START');
        }
        return;
    }

    powerOffSince = null;

    if (activeDowntimeId) {
        await pool.query(`
            UPDATE machine_downtime_logs
            SET end_time = $1,
                duration_sec = EXTRACT(EPOCH FROM ($1 - start_time))
            WHERE id = $2
        `, [now, activeDowntimeId]);

        console.log('✅ Downtime END');
        activeDowntimeId = null;
    }
}

module.exports = { handlePowerState };
