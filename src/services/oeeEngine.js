const pool = require('../../config/db');

async function calculateOEE({ machineId, shiftNumber, date }) {
    try {
        const query = `
            WITH TargetData AS (
                SELECT
                    target_meter_lari,
                    target_jumlah_joint
                FROM production_targets
                WHERE effective_date = $1
                ORDER BY created_at DESC
                LIMIT 1
            ),
            DowntimeData AS (
                SELECT COALESCE(SUM(duration_sec) / 60.0, 0) AS total_downtime_minutes
                FROM machine_downtime_logs
                WHERE machine_id = $2 AND shift_number = $3 AND DATE(start_time) = $1
            ),
            ProductionData AS (
                SELECT
                    COALESCE(SUM(meter_lari), 0) AS actual_production,
                    COALESCE(SUM(joint_count), 0) AS total_joints
                FROM production_logs
                WHERE machine_id = $2 AND shift_number = $3 AND DATE(timestamp) = $1
            )
            SELECT
                t.target_meter_lari,
                t.target_jumlah_joint,
                d.total_downtime_minutes,
                p.actual_production,
                p.total_joints
            FROM TargetData t, DowntimeData d, ProductionData p;
        `;

        const result = await pool.query(query, [date, machineId, shiftNumber]);

        if (result.rowCount === 0 || result.rows.length === 0) {
            console.warn(`⚠️ No production data found for Machine ${machineId}, Shift ${shiftNumber} on ${date}`);
            return emptyOEE();
        }

        const {
            target_meter_lari,
            target_jumlah_joint,
            total_downtime_minutes,
            actual_production,
            total_joints
        } = result.rows[0];

        // Asumsi total waktu shift adalah 8 jam (480 menit)
        const totalShiftMinutes = 480;
        const actualRuntime = Math.max(0, totalShiftMinutes - total_downtime_minutes);

        // OEE Calculations
        const availability = totalShiftMinutes > 0 ? (actualRuntime / totalShiftMinutes) : 0;
        const performance = target_meter_lari > 0 ? (actual_production / target_meter_lari) : 0;
        const quality = 1; // Asumsi 100% quality untuk sekarang

        const oee = availability * performance * quality;

        return {
            A: toPercent(availability),
            P: toPercent(performance),
            Q: toPercent(quality),
            OEE: toPercent(oee),
            actual: actual_production || 0,
            joints: total_joints || 0,
        };

    } catch (err) {
        console.error('❌ OEE calculation error:', err.message);
        return emptyOEE();
    }
}

function toPercent(value) {
    return parseFloat((value * 100).toFixed(1));
}

function emptyOEE() {
    return { A: 0, P: 0, Q: 0, OEE: 0, actual: 0, joints: 0 };
}

module.exports = {
    calculateOEE
};
