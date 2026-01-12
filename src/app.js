require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const pool = require('../config/db');
const { getShiftInfo } = require('./utils/shiftManager');
const { calculateOEE } = require('./services/oeeEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3002;
const MACHINE_ID = '1';

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json()); // Middleware untuk parsing JSON

// Endpoint untuk reset data
app.post('/reset-data', async (req, res) => {
    const { password } = req.body;

    // Kata sandi sederhana, bisa diganti di .env
    if (password !== (process.env.RESET_PASSWORD || '1234')) {
        return res.status(401).json({ message: 'Kata sandi salah.' });
    }

    try {
        console.log('🔥 Mereset data produksi untuk hari ini...');
        
        // Hapus data dari tabel-tabel terkait
        await pool.query("DELETE FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE");
        await pool.query("DELETE FROM tally_logs WHERE tanggal = CURRENT_DATE");
        await pool.query("DELETE FROM target_gap_per_shift WHERE date = CURRENT_DATE");

        const cekTarget = await pool.query("SELECT 1 FROM production_targets WHERE effective_date = CURRENT_DATE LIMIT 1");
        if (cekTarget.rowCount === 0) {
            await pool.query(
                "INSERT INTO production_targets (target_name, target_value, unit, target_meter_lari, target_jumlah_joint, effective_date) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE)",
                ['Target Harian', 100, 'meter', 100, 200]
            );
        }

        const s = getShiftInfo();
        const shiftNo = s.shift === '-' ? 1 : s.shift;
        await pool.query(
            "INSERT INTO production_logs (machine_id, shift_number, operator_name, meter_lari, joint_count, lebar_kayu, tebal_kayu, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())",
            [1, shiftNo, 'Operator Reset', 3.5, 5, 20, 5]
        );
        const jam_ke = new Date().getHours() - 6;
        if (jam_ke >= 1 && jam_ke <= 17) {
            await pool.query(
                "INSERT INTO tally_logs (jam_ke, meter_lari, tanggal) VALUES ($1,$2,CURRENT_DATE) ON CONFLICT (jam_ke, tanggal) DO UPDATE SET meter_lari = tally_logs.meter_lari + EXCLUDED.meter_lari",
                [jam_ke, 1.2]
            );
        }

        const tRes = await pool.query("SELECT target_meter_lari, target_jumlah_joint FROM production_targets WHERE effective_date = CURRENT_DATE ORDER BY created_at DESC LIMIT 1");
        const targetMeter = parseFloat(tRes.rows[0].target_meter_lari || 0);
        const targetJoints = parseFloat(tRes.rows[0].target_jumlah_joint || 0);
        const totalShifts = 2;
        const targetPerShiftMeter = targetMeter / totalShifts;
        const targetPerShiftJoints = targetJoints / totalShifts;
        const aRes = await pool.query("SELECT COALESCE(SUM(meter_lari),0) AS am, COALESCE(SUM(joint_count),0) AS aj FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE AND shift_number = $1", [shiftNo]);
        const actualMeter = parseFloat(aRes.rows[0].am || 0);
        const actualJoints = parseFloat(aRes.rows[0].aj || 0);
        const gapMeter = targetPerShiftMeter - actualMeter;
        const gapJoints = targetPerShiftJoints - actualJoints;
        const achievePct = targetPerShiftMeter > 0 ? (actualMeter / targetPerShiftMeter) * 100 : 0;
        await pool.query(
            "INSERT INTO target_gap_per_shift (shift_number, target_meter, actual_meter, gap_meter, target_joints, actual_joints, gap_joints, achievement_percentage, date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE) ON CONFLICT (shift_number, date) DO UPDATE SET target_meter=$2, actual_meter=$3, gap_meter=$4, target_joints=$5, actual_joints=$6, gap_joints=$7, achievement_percentage=$8, updated_at=CURRENT_TIMESTAMP",
            [shiftNo, targetPerShiftMeter, actualMeter, gapMeter, targetPerShiftJoints, actualJoints, gapJoints, achievePct]
        );

        console.log('✅ Data berhasil direset.');

        // Broadcast update setelah reset
        broadcast();

        res.status(200).json({ message: 'Data produksi hari ini telah berhasil direset.' });
    } catch (error) {
        console.error('❌ Gagal mereset data:', error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
    }
});

async function broadcast() {
    const shift = getShiftInfo();
    
    if (!shift.isOperational) {
        io.emit('statusUpdate', {
            shift: shift.name,
            isOperational: false,
            message: 'Mesin dalam mode standby di luar jam kerja.'
        });
        return;
    }

    const date = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD (local)

    const oee = await calculateOEE({
        machineId: MACHINE_ID,
        shiftNumber: shift.shift,
        date
    });

    const trendRes = await pool.query(`
        SELECT 
            hour,
            SUM(machine_data) AS machine,
            SUM(tally_data) AS tally
        FROM (
            SELECT 
                EXTRACT(HOUR FROM timestamp) AS hour,
                meter_lari AS machine_data,
                0 AS tally_data
            FROM production_logs
            WHERE DATE(timestamp) = CURRENT_DATE
            
            UNION ALL
            
            SELECT 
                jam_ke AS hour,
                0 AS machine_data,
                meter_lari AS tally_data
            FROM tally_logs
            WHERE tanggal = CURRENT_DATE
        ) combined_data
        GROUP BY hour
        ORDER BY hour
    `);

    const machineArr = Array(17).fill(0);
    const tallyArr = Array(17).fill(0);

    trendRes.rows.forEach(r => {
        const idx = r.hour - 7;
        if (idx >= 0 && idx < 17) {
            machineArr[idx] = Number(r.machine || 0);
            tallyArr[idx] = Number(r.tally || 0);
        }
    });

    console.log('📊 Data OEE:', {
        current: oee.actual,
        efficiency: oee.P,
        joints: oee.joints,
        trendMachine: machineArr,
        trendTally: tallyArr
    });

    const today = new Date();
    const tanggalFormatted = today.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });

    const targetGapRes = await pool.query(`
        SELECT * 
        FROM target_gap_per_shift 
        WHERE date = CURRENT_DATE AND shift_number = $1
    `, [shift.shift]);
 
    const targetGap = targetGapRes.rows[0] || {};
 
    io.emit('productionUpdate', {
        current: oee.actual,
        efficiency: oee.P,
        joints: oee.joints,
        trendMachine: machineArr,
        trendTally: tallyArr,
        shift: shift.shift,
        shiftName: shift.name,
        tanggal: tanggalFormatted,
        targetGap: {
            target_meter: parseFloat(targetGap.target_meter || 0),
            actual_meter: parseFloat(targetGap.actual_meter || 0),
            gap_meter: parseFloat(targetGap.gap_meter || 0),
            achievement_percentage: parseFloat(targetGap.achievement_percentage || 0),
            target_joints: parseFloat(targetGap.target_joints || 0),
            actual_joints: parseFloat(targetGap.actual_joints || 0),
            gap_joints: parseFloat(targetGap.gap_joints || 0)
        }
    });

    io.emit('oeeUpdate', oee);
}

setInterval(broadcast, 5000);

io.on('connection', () => broadcast());

server.listen(PORT, () =>
    console.log(`🚀 Dashboard running on port ${PORT}`)
);
