const { Pool } = require('pg');
require('dotenv').config();
const { getShiftInfo } = require('./src/utils/shiftManager');

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'hmi_fingerjoint',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

const MACHINE_ID = 1;
const OPERATOR_NAME = 'Operator Simulasi';
const INTERVAL_MS = parseInt(process.env.SIM_INTERVAL_MS || '10000', 10);
let lastDateStr = new Date().toLocaleDateString('en-CA');
let lastShift = (() => {
    const s = getShiftInfo();
    return s.shift === '-' ? (new Date().getHours() < 15 ? 1 : 2) : s.shift;
})();

// Fungsi untuk generate data acak
function generateRandomData() {
    const meter_lari = Math.random() * 0.9 + 0.3; // 0.3-1.2 meter per 10 detik
    const joint_count = Math.floor(Math.random() * 3) + 1; // 1-3 joint
    const lebar_kayu = Math.random() * 20 + 10; // 10-30 cm
    const tebal_kayu = Math.random() * 5 + 2; // 2-7 cm
    
    return {
        meter_lari: parseFloat(meter_lari.toFixed(2)),
        joint_count,
        lebar_kayu: parseFloat(lebar_kayu.toFixed(2)),
        tebal_kayu: parseFloat(tebal_kayu.toFixed(2))
    };
}

// Fungsi untuk insert data ke production_logs
async function insertProductionData() {
    try {
        const s = getShiftInfo();
        const shiftNo = s.shift === '-' ? (new Date().getHours() < 15 ? 1 : 2) : s.shift;
        const data = generateRandomData();
        
        const query = `
            INSERT INTO production_logs 
            (machine_id, shift_number, operator_name, meter_lari, joint_count, lebar_kayu, tebal_kayu, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING *;
        `;
        
        const values = [
            MACHINE_ID,
            shiftNo,
            OPERATOR_NAME,
            data.meter_lari,
            data.joint_count,
            data.lebar_kayu,
            data.tebal_kayu
        ];
        
        const result = await pool.query(query, values);
        console.log(`✅ Data produksi berhasil ditambahkan:`, {
            meter_lari: result.rows[0].meter_lari,
            joint_count: result.rows[0].joint_count,
            volume_m3: result.rows[0].volume_m3,
            timestamp: result.rows[0].timestamp
        });
        
    } catch (error) {
        console.error('❌ Error saat insert data:', error.message);
    }
}

async function ensureTargetsForToday() {
    const targetQuery = `
        SELECT target_meter_lari, target_jumlah_joint 
        FROM production_targets 
        WHERE effective_date = CURRENT_DATE 
        ORDER BY created_at DESC 
        LIMIT 1
    `;
    const res = await pool.query(targetQuery);
    if (res.rows.length === 0) {
        await pool.query(
            "INSERT INTO production_targets (target_name, target_value, unit, target_meter_lari, target_jumlah_joint, effective_date) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE)",
            ['Target Harian', 100, 'meter', 100, 200]
        );
    }
}

async function initTargetGapForShift(shiftNo) {
    const tRes = await pool.query("SELECT target_meter_lari, target_jumlah_joint FROM production_targets WHERE effective_date = CURRENT_DATE ORDER BY created_at DESC LIMIT 1");
    const targetMeter = parseFloat(tRes.rows[0]?.target_meter_lari || 0);
    const targetJoints = parseFloat(tRes.rows[0]?.target_jumlah_joint || 0);
    const totalShifts = 2;
    const targetPerShiftMeter = targetMeter / totalShifts;
    const targetPerShiftJoints = targetJoints / totalShifts;
    await pool.query(
        "INSERT INTO target_gap_per_shift (shift_number, target_meter, actual_meter, gap_meter, target_joints, actual_joints, gap_joints, achievement_percentage, date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_DATE) ON CONFLICT (shift_number, date) DO UPDATE SET target_meter=$2, actual_meter=$3, gap_meter=$4, target_joints=$5, actual_joints=$6, gap_joints=$7, achievement_percentage=$8, updated_at=CURRENT_TIMESTAMP",
        [shiftNo, targetPerShiftMeter, 0, targetPerShiftMeter, targetPerShiftJoints, 0, targetPerShiftJoints, 0]
    );
}

// Fungsi untuk menghitung dan insert target gap per shift
async function insertTargetGapData() {
    try {
        // Ambil target per shift dari production_targets
        const targetQuery = `
            SELECT target_meter_lari, target_jumlah_joint 
            FROM production_targets 
            WHERE effective_date = CURRENT_DATE 
            ORDER BY created_at DESC 
            LIMIT 1
        `;
        const targetResult = await pool.query(targetQuery);
        
        if (targetResult.rows.length === 0) {
            console.log('⚠️  Tidak ada target untuk hari ini');
            try {
                await pool.query(
                    `
                    INSERT INTO production_targets 
                    (target_name, target_value, unit, target_meter_lari, target_jumlah_joint, effective_date)
                    VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
                    `,
                    ['Target Harian', 100, 'meter', 100, 200]
                );
                console.log('🧪 Target default ditambahkan untuk hari ini (100m, 200 joints)');
            } catch (e) {
                console.error('❌ Gagal menambahkan target default:', e.message);
                return;
            }
            // Ambil ulang target setelah insert
            const reTarget = await pool.query(targetQuery);
            if (reTarget.rows.length === 0) return;
            targetResult.rows[0] = reTarget.rows[0];
        }
        
        const targetMeter = parseFloat(targetResult.rows[0].target_meter_lari);
        const targetJoints = parseInt(targetResult.rows[0].target_jumlah_joint);
        
        // Hitung actual per shift
        const actualQuery = `
            SELECT 
                shift_number,
                SUM(meter_lari) as actual_meter,
                COUNT(*) as actual_joints
            FROM production_logs 
            WHERE DATE(timestamp) = CURRENT_DATE 
            GROUP BY shift_number
            ORDER BY shift_number
        `;
        const actualResult = await pool.query(actualQuery);
        
        // Hitung target per shift (asumsi target dibagi rata antara shift)
        const totalShifts = 2; // Shift 1 dan 2
        const targetPerShiftMeter = targetMeter / totalShifts;
        const targetPerShiftJoints = targetJoints / totalShifts;
        
        console.log(`📊 Target per shift: ${targetPerShiftMeter.toFixed(2)} meter, ${targetPerShiftJoints} joints`);
        
        // Hitung gap untuk setiap shift
        for (let shiftNum = 1; shiftNum <= totalShifts; shiftNum++) {
            const actualData = actualResult.rows.find(row => row.shift_number === shiftNum);
            const actualMeter = actualData ? parseFloat(actualData.actual_meter) : 0;
            const actualJoints = actualData ? parseInt(actualData.actual_joints) : 0;
            
            const gapMeter = targetPerShiftMeter - actualMeter;
            const gapJoints = targetPerShiftJoints - actualJoints;
            const gapPercentageRaw = targetPerShiftMeter > 0 ? ((actualMeter / targetPerShiftMeter) * 100) : 0;
            const gapPercentage = Math.max(0, Math.min(100, gapPercentageRaw));
            
            console.log(`🎯 Shift ${shiftNum}:`);
            console.log(`   Target: ${targetPerShiftMeter.toFixed(2)}m / ${targetPerShiftJoints} joints`);
            console.log(`   Actual: ${actualMeter.toFixed(2)}m / ${actualJoints} joints`);
            console.log(`   Gap: ${gapMeter.toFixed(2)}m / ${gapJoints} joints (${gapPercentage.toFixed(1)}%)`);
            
            // Simpan ke tabel target_gap_per_shift (buat jika belum ada)
            const insertQuery = `
                INSERT INTO target_gap_per_shift 
                (shift_number, target_meter, actual_meter, gap_meter, target_joints, actual_joints, gap_joints, achievement_percentage, date)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE)
                ON CONFLICT (shift_number, date) 
                DO UPDATE SET 
                    target_meter = $2,
                    actual_meter = $3,
                    gap_meter = $4,
                    target_joints = $5,
                    actual_joints = $6,
                    gap_joints = $7,
                    achievement_percentage = $8,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *;
            `;
            
            const values = [
                shiftNum,
                targetPerShiftMeter,
                actualMeter,
                gapMeter,
                targetPerShiftJoints,
                actualJoints,
                gapJoints,
                gapPercentage
            ];
            
            try {
                const result = await pool.query(insertQuery, values);
                console.log(`✅ Target gap shift ${shiftNum} berhasil disimpan`);
            } catch (error) {
                // Jika tabel belum ada, buat tabelnya
                if (error.code === '42P01') { // Table doesn't exist
                    console.log(`📝 Membuat tabel target_gap_per_shift...`);
                    
                    const createTableQuery = `
                        CREATE TABLE target_gap_per_shift (
                            id SERIAL PRIMARY KEY,
                            shift_number INTEGER NOT NULL,
                            target_meter NUMERIC NOT NULL,
                            actual_meter NUMERIC NOT NULL,
                            gap_meter NUMERIC NOT NULL,
                            target_joints INTEGER NOT NULL,
                            actual_joints INTEGER NOT NULL,
                            gap_joints INTEGER NOT NULL,
                            achievement_percentage NUMERIC NOT NULL,
                            date DATE NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            UNIQUE(shift_number, date)
                        );
                    `;
                    
                    await pool.query(createTableQuery);
                    console.log(`✅ Tabel target_gap_per_shift berhasil dibuat`);
                    
                    // Coba insert lagi
                    const retryResult = await pool.query(insertQuery, values);
                    console.log(`✅ Target gap shift ${shiftNum} berhasil disimpan`);
                } else {
                    throw error;
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Error saat menghitung target gap:', error.message);
    }
}

// Fungsi untuk insert data ke tally_logs
async function insertTallyData() {
    try {
        const currentTime = new Date();
        const hour = currentTime.getHours();
        const jam_ke = hour - 6; // Jam ke 1 dimulai dari jam 7 (7-6=1)
        
        if (jam_ke >= 1 && jam_ke <= 17) { // Hanya insert untuk jam kerja (7-23)
            const meter_lari = Math.random() * 3 + 0.5; // 0.5-3.5 meter
            
            const query = `
                INSERT INTO tally_logs (jam_ke, meter_lari, tanggal)
                VALUES ($1, $2, CURRENT_DATE)
                ON CONFLICT (jam_ke, tanggal) 
                DO UPDATE SET meter_lari = tally_logs.meter_lari + $2
                RETURNING *;
            `;
            
            const result = await pool.query(query, [jam_ke, parseFloat(meter_lari.toFixed(2))]);
            console.log(`✅ Data tally berhasil ditambahkan:`, {
                jam_ke: result.rows[0].jam_ke,
                meter_lari: result.rows[0].meter_lari,
                tanggal: result.rows[0].tanggal
            });
        }
        
    } catch (error) {
        console.error('❌ Error saat insert tally data:', error.message);
    }
}

async function insertDummyDowntimeLog() {
    try {
        const s = getShiftInfo();
        const shiftNo = s.shift === '-' ? (new Date().getHours() < 15 ? 1 : 2) : s.shift;
        const durationMin = Math.floor(Math.random() * 6) + 2;
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - durationMin * 60000);
        const durationSec = Math.floor((endTime - startTime) / 1000);
        const q = `
            INSERT INTO machine_downtime_logs (machine_id, shift_number, start_time, end_time, duration_sec)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `;
        await pool.query(q, [MACHINE_ID, shiftNo, startTime, endTime, durationSec]);
        console.log(`🛑 Dummy downtime ${durationMin}m ditambahkan`);
    } catch (error) {
        if (error.code === '42P01') {
            const cq = `
                CREATE TABLE machine_downtime_logs (
                    id SERIAL PRIMARY KEY,
                    machine_id INTEGER NOT NULL,
                    shift_number INTEGER NOT NULL,
                    start_time TIMESTAMP NOT NULL,
                    end_time TIMESTAMP NULL,
                    duration_sec INTEGER DEFAULT 0
                )
            `;
            await pool.query(cq);
            console.log('✅ Tabel machine_downtime_logs dibuat');
            await insertDummyDowntimeLog();
            return;
        }
        console.error('❌ Error dummy downtime:', error.message);
    }
}

// Fungsi utama simulasi
async function runSimulation() {
    console.log('🔄 Memulai simulasi produksi...');
    await ensureTargetsForToday();
    await initTargetGapForShift(lastShift);
    
    // Insert data awal
    await insertProductionData();
    await insertTallyData();
    await insertTargetGapData(); // Tambahkan target gap
    
    // Jalankan setiap interval
    setInterval(async () => {
        const now = new Date();
        const s = getShiftInfo();
        const op = s.isOperational;
        const curDate = now.toLocaleDateString('en-CA');
        const curShift = s.shift === '-' ? (now.getHours() < 15 ? 1 : 2) : s.shift;

        if (curDate !== lastDateStr) {
            lastDateStr = curDate;
            await ensureTargetsForToday();
            await initTargetGapForShift(curShift);
        }
        if (curShift !== lastShift) {
            lastShift = curShift;
            await initTargetGapForShift(curShift);
        }

        await insertProductionData();
        await insertTallyData();
        await insertTargetGapData();
    }, INTERVAL_MS); // default 10 detik
    setInterval(async () => {
        await insertDummyDowntimeLog();
    }, Math.max(60000, INTERVAL_MS * 6));
    
    console.log(`✅ Simulasi berjalan, data akan ditambahkan setiap ${INTERVAL_MS/1000} detik`);
}

// Jalankan simulasi
runSimulation().catch(console.error);

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Simulasi dihentikan');
    await pool.end();
    process.exit(0);
});
