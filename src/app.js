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
app.use(express.json());

// --- FUNGSI SIMULASI (TAMBAHAN) ---
// Variable global untuk simulasi
let lastSimTime = 0;

// Fungsi ini akan dijalankan setiap kali broadcast, tapi hanya mengeksekusi logika setiap 15 detik
async function simulateProduction(shiftNo) {
    const now = Date.now();
    // Cek apakah sudah 15 detik sejak simulasi terakhir
    if (now - lastSimTime < 15000) return;
    
    lastSimTime = now;
    console.log('⏰ Running Simulation Cycle (15s interval)...');

    try {
        const jam_ke = new Date().getHours();
        
        // --- 1. SIMULASI PRODUKSI (Machine & Tally) ---
        // Generate Joints & Meter
        const joints = Math.floor(Math.random() * 3) + 1; // 1 to 3 joints
        const lengthPerJoint = 4.0; 
        const meter = (joints * lengthPerJoint).toFixed(2); 

        // Insert ke production_logs
        await pool.query(
            "INSERT INTO production_logs (machine_id, shift_number, operator_name, meter_lari, joint_count, lebar_kayu, tebal_kayu, timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())",
            [MACHINE_ID, shiftNo, 'SIMULATOR', meter, joints, 20, 5]
        );

        // Insert ke tally_logs (Sekarang sinkron setiap 20 detik)
        const jam_tally = jam_ke - 6; 
        if (jam_tally >= 1 && jam_tally <= 17) {
            await pool.query(
                "INSERT INTO tally_logs (jam_ke, meter_lari, tanggal) VALUES ($1,$2,CURRENT_DATE) ON CONFLICT (jam_ke, tanggal) DO UPDATE SET meter_lari = tally_logs.meter_lari + EXCLUDED.meter_lari",
                [jam_tally, meter]
            );
        }
        
        console.log(`🎲 Production: +${meter}m | +${joints}j`);

        // --- 2. SIMULASI DOWNTIME (Random) ---
        // 30% chance terjadi downtime kecil setiap siklus 20 detik
        if (Math.random() < 0.3) {
            const duration = Math.floor(Math.random() * 120) + 10; // 10s - 130s downtime
            const startTime = new Date(now - (duration * 1000));
            const endTime = new Date(now);
            
            // Pilih random reason
            const reasons = ['Jamming', 'Sensor Error', 'Cleaning', 'Restocking', 'Maintenance'];
            const reason = reasons[Math.floor(Math.random() * reasons.length)];

            await pool.query(
                "INSERT INTO machine_downtime_logs (machine_id, shift_number, start_time, end_time, duration_sec, reason) VALUES ($1, $2, $3, $4, $5, $6)",
                [MACHINE_ID, shiftNo, startTime, endTime, duration, reason]
            );
            console.log(`⚠️ Downtime Generated: ${reason} (${duration}s)`);
        }

        // --- 3. UPDATE TARGET & GAP ---
        const tRes = await pool.query("SELECT target_meter_lari, target_jumlah_joint FROM production_targets WHERE effective_date = CURRENT_DATE LIMIT 1");
        if (tRes.rowCount > 0) {
            const targetM = parseFloat(tRes.rows[0].target_meter_lari) / 2;
            const targetJ = parseFloat(tRes.rows[0].target_jumlah_joint) / 2;

            const aggRes = await pool.query(
                "SELECT SUM(meter_lari) as am, SUM(joint_count) as aj FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE AND shift_number = $1", 
                [shiftNo]
            );
            
            const actualM = parseFloat(aggRes.rows[0].am || 0);
            const actualJ = parseFloat(aggRes.rows[0].aj || 0);
            
            const gapM = Math.max(0, targetM - actualM);
            const gapJ = Math.max(0, targetJ - actualJ);
            
            const achievePct = targetM > 0 ? (actualM / targetM) * 100 : 0;
            
            await pool.query(
                `UPDATE target_gap_per_shift 
                 SET actual_meter = $1, gap_meter = $2, achievement_percentage = $3,
                     actual_joints = $4, gap_joints = $5, updated_at = NOW() 
                 WHERE shift_number = $6 AND date = CURRENT_DATE`,
                [actualM, gapM, achievePct, actualJ, gapJ, shiftNo]
            );
        }

    } catch (err) {
        console.error("❌ Simulation Error:", err.message);
    }
}

// --- ENDPOINT RESET ---
app.post('/reset-data', async (req, res) => {
    const { password } = req.body;
    if (password !== (process.env.RESET_PASSWORD || '1234')) {
        return res.status(401).json({ message: 'Kata sandi salah.' });
    }
    try {
        console.log('🔥 Mereset data produksi...');
        await pool.query("DELETE FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE");
        await pool.query("DELETE FROM tally_logs WHERE tanggal = CURRENT_DATE");
        await pool.query("DELETE FROM target_gap_per_shift WHERE date = CURRENT_DATE");
        
        // Buat record awal target_gap agar tidak error saat select
        const s = getShiftInfo();
        const shiftNo = s.shift === '-' ? 1 : s.shift;
        await pool.query(
            "INSERT INTO target_gap_per_shift (shift_number, date, target_meter, actual_meter) VALUES ($1, CURRENT_DATE, 50, 0) ON CONFLICT DO NOTHING", 
            [shiftNo]
        );

        broadcast();
        res.status(200).json({ message: 'Data berhasil direset.' });
    } catch (error) {
        console.error('❌ Reset Error:', error);
        res.status(500).send('Server Error');
    }
});

// --- HELPER UNTUK MEMASTIKAN DATA HARIAN ADA ---
async function ensureDailyData(shiftNumber) {
    const date = new Date().toISOString().split('T')[0];
    
    // 1. Ensure production_targets
    const tCheck = await pool.query("SELECT 1 FROM production_targets WHERE effective_date = $1", [date]);
    if (tCheck.rowCount === 0) {
        // Default target: 8000m (4000/shift), 2000 joints (1000/shift) -> Ratio 4m/joint
        await pool.query("INSERT INTO production_targets (effective_date, target_meter_lari, target_jumlah_joint) VALUES ($1, 8000, 2000)", [date]);
        console.log(`✅ Created default targets for ${date}`);
    }

    // 2. Ensure target_gap_per_shift
    const gCheck = await pool.query("SELECT 1 FROM target_gap_per_shift WHERE date = $1 AND shift_number = $2", [date, shiftNumber]);
    if (gCheck.rowCount === 0) {
        // Get target per shift
        const tRes = await pool.query("SELECT target_meter_lari, target_jumlah_joint FROM production_targets WHERE effective_date = $1", [date]);
        const targetM = parseFloat(tRes.rows[0].target_meter_lari) / 2;
        const targetJ = parseFloat(tRes.rows[0].target_jumlah_joint) / 2;
        
        await pool.query(
            "INSERT INTO target_gap_per_shift (shift_number, date, target_meter, actual_meter, gap_meter, achievement_percentage, target_joints, actual_joints, gap_joints) VALUES ($1, $2, $3, 0, $3, 0, $4, 0, $4)",
            [shiftNumber, date, targetM, targetJ]
        );
        console.log(`✅ Created target gap for Shift ${shiftNumber} on ${date}`);
    }
}

// --- CORE BROADCAST ---
async function broadcast() {
    try {
        const shift = getShiftInfo();
        
        // Pastikan data harian tersedia jika operational
        if (shift.isOperational) {
            await ensureDailyData(shift.shift);
        }

        // Jalankan simulasi jika operasional
        if (shift.isOperational) {
            await simulateProduction(shift.shift);
        } else {
            io.emit('statusUpdate', { shift: shift.name, isOperational: false, message: 'Standby' });
            return;
        }

        const date = new Date().toISOString().split('T')[0];
        const oee = await calculateOEE({ machineId: MACHINE_ID, shiftNumber: shift.shift, date });

        // Query Data Trend & Gap
        const [dtRes, trendRes, targetGapRes] = await Promise.all([
            pool.query("SELECT start_time, end_time, duration_sec FROM machine_downtime_logs WHERE DATE(start_time) = CURRENT_DATE AND shift_number = $1 ORDER BY start_time DESC LIMIT 6", [shift.shift]),
            pool.query(`
                SELECT hour, SUM(m) as machine, SUM(t) as tally FROM (
                    SELECT EXTRACT(HOUR FROM timestamp) as hour, meter_lari as m, 0 as t FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE
                    UNION ALL
                    SELECT (jam_ke + 6) as hour, 0 as m, meter_lari as t FROM tally_logs WHERE tanggal = CURRENT_DATE
                ) c GROUP BY hour ORDER BY hour
            `),
            pool.query("SELECT * FROM target_gap_per_shift WHERE date = CURRENT_DATE AND shift_number = $1", [shift.shift])
        ]);

        const machineArr = Array(17).fill(0);
        const tallyArr = Array(17).fill(0);
        trendRes.rows.forEach(r => {
            const idx = parseInt(r.hour) - 7;
            if (idx >= 0 && idx < 17) {
                machineArr[idx] = Number(r.machine || 0);
                tallyArr[idx] = Number(r.tally || 0);
            }
        });

        const targetGap = targetGapRes.rows[0] || {};
        
        io.emit('productionUpdate', {
            current: oee.actual,
            efficiency: oee.P,
            joints: oee.joints,
            trendMachine: machineArr,
            trendTally: tallyArr,
            shift: shift.shift,
            shiftName: shift.name,
            tanggal: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
            downtimeLogs: dtRes.rows,
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

        console.log(`📊 OEE: ${oee.actual}m | Eff: ${oee.P}%`);

    } catch (err) {
        console.error("❌ Broadcast Error:", err.message);
    }
}

// Interval 5 detik
setInterval(broadcast, 5000);

io.on('connection', () => {
    console.log("🔌 KIOSK Connected");
    broadcast();
});

server.listen(PORT, () => console.log(`🚀 Simulasi aktif di port ${PORT}`));
