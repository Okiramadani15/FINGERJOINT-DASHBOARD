const pool = require('../../config/db');

/**
 * FINAL OEE ENGINE
 * Industrial-safe & upgrade-ready
 */
async function calculateOEE({ machineId, shiftNumber, date }) {
    // ========================
    // 1. Planned Production Time
    // ========================
    const plannedMinutes = 8 * 60; // 1 shift = 8 jam (FINAL FIXED)

    // ========================
    // 2. Downtime
    // ========================
    const downtimeRes = await pool.query(`
        SELECT COALESCE(SUM(duration_sec) / 60, 0) AS downtime
        FROM machine_downtime_logs
        WHERE machine_id = $1
        AND DATE(start_time) = $2
        AND shift_number = $3
    `, [machineId, date, shiftNumber]);

    const downtimeMinutes = parseFloat(downtimeRes.rows[0].downtime);
    const operatingTime = Math.max(plannedMinutes - downtimeMinutes, 1);

    const availability = operatingTime / plannedMinutes;

    // ========================
    // 3. Performance
    // ========================
    const actualRes = await pool.query(`
        SELECT COALESCE(SUM(meter_lari),0) AS actual
        FROM production_logs
        WHERE machine_id = $1
        AND DATE(timestamp) = $2
        AND shift_number = $3
    `, [machineId, date, shiftNumber]);

    const targetRes = await pool.query(`
        SELECT target_meter_lari
        FROM production_targets
        WHERE effective_date = $1
        LIMIT 1
    `, [date]);

    const actual = parseFloat(actualRes.rows[0].actual);
    const target = targetRes.rows[0]?.target_meter_lari || 1;

    const performance = actual / target;

    // ========================
    // 4. Quality
    // ========================
    const quality = 1.0; // FINAL (no reject yet)

    // ========================
    // 5. OEE
    // ========================
    const oee = availability * performance * quality;

    return {
        availability: +(availability * 100).toFixed(2),
        performance: +(performance * 100).toFixed(2),
        quality: +(quality * 100).toFixed(2),
        oee: +(oee * 100).toFixed(2),
        actual,
        target,
        downtimeMinutes
    };
}

module.exports = { calculateOEE };
