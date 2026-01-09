const pool = require('../../config/db');

/**
 * =========================================================
 * FINAL OEE ENGINE (INDUSTRIAL STANDARD)
 * A = Availability (Time Based)
 * P = Performance (Speed Based)
 * Q = Quality (Good vs Gross Output)
 * =========================================================
 */

const IDEAL_RATE_M3_PER_MINUTE = 1.5; // ⚙️ CONFIG: kalibrasi mesin (bisa pindah ke DB)

/**
 * Calculate OEE for 1 machine, 1 shift, 1 date
 * @param {Object} param0
 * @returns OEE Result Object
 */
async function calculateOEE({
    machineId = 1,
    shiftNumber = 1,
    date // YYYY-MM-DD
}) {
    if (!date) throw new Error("DATE REQUIRED");

    /* =====================================================
       1. PLANNED PRODUCTION TIME (SHIFT)
    ===================================================== */
    const shiftRes = await pool.query(`
        SELECT start_time, end_time
        FROM shifts
        WHERE shift_number = $1
        LIMIT 1
    `, [shiftNumber]);

    if (shiftRes.rowCount === 0) {
        throw new Error("SHIFT NOT FOUND");
    }

    const { start_time, end_time } = shiftRes.rows[0];

    const shiftStart = new Date(`${date} ${start_time}`);
    const shiftEnd = new Date(`${date} ${end_time}`);

    const plannedMinutes =
        (shiftEnd.getTime() - shiftStart.getTime()) / 60000;

    if (plannedMinutes <= 0) {
        throw new Error("INVALID SHIFT TIME");
    }

    /* =====================================================
       2. DOWNTIME (Availability Loss)
    ===================================================== */
    const downtimeRes = await pool.query(`
        SELECT COALESCE(SUM(duration_minutes), 0) AS downtime
        FROM downtime_logs
        WHERE machine_id = $1
        AND shift_number = $2
        AND DATE(start_time) = $3
    `, [machineId, shiftNumber, date]);

    const downtimeMinutes = Number(downtimeRes.rows[0].downtime);
    const operatingMinutes = Math.max(
        plannedMinutes - downtimeMinutes,
        0
    );

    const availability =
        plannedMinutes > 0
            ? operatingMinutes / plannedMinutes
            : 0;

    /* =====================================================
       3. ACTUAL OUTPUT (Gross & Good)
    ===================================================== */
    const outputRes = await pool.query(`
        SELECT
            COALESCE(SUM(meter_lari), 0) AS gross_output,
            COALESCE(SUM(joint_count), 0) AS joints
        FROM production_logs
        WHERE machine_id = $1
        AND shift_number = $2
        AND DATE(timestamp) = $3
    `, [machineId, shiftNumber, date]);

    const grossOutput = Number(outputRes.rows[0].gross_output);
    const totalJoints = Number(outputRes.rows[0].joints);

    /* =====================================================
       4. QUALITY (Good Output from Tally / QC)
    ===================================================== */
    const tallyRes = await pool.query(`
        SELECT COALESCE(SUM(meter_lari), 0) AS good_output
        FROM tally_logs
        WHERE tanggal = $1
    `, [date]);

    const goodOutput = Number(tallyRes.rows[0].good_output);

    const quality =
        grossOutput > 0
            ? Math.min(goodOutput / grossOutput, 1)
            : 1;

    /* =====================================================
       5. PERFORMANCE (Speed Loss)
    ===================================================== */
    const idealOutput =
        operatingMinutes * IDEAL_RATE_M3_PER_MINUTE;

    const performance =
        idealOutput > 0
            ? Math.min(grossOutput / idealOutput, 1)
            : 0;

    /* =====================================================
       6. FINAL OEE
    ===================================================== */
    const oee =
        availability * performance * quality;

    /* =====================================================
       7. RETURN FINAL STRUCTURE
    ===================================================== */
    return {
        machineId,
        date,
        shiftNumber,

        time: {
            plannedMinutes,
            operatingMinutes,
            downtimeMinutes
        },

        output: {
            grossOutput,
            goodOutput,
            totalJoints
        },

        rate: {
            idealRate_m3_per_minute: IDEAL_RATE_M3_PER_MINUTE,
            idealOutput
        },

        A: Number((availability * 100).toFixed(2)),
        P: Number((performance * 100).toFixed(2)),
        Q: Number((quality * 100).toFixed(2)),
        OEE: Number((oee * 100).toFixed(2))
    };
}

module.exports = {
    calculateOEE
};
