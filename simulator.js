const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'hmi_fingerjoint',
    password: process.env.DB_PASSWORD || 'postgres',
    port: process.env.DB_PORT || 5432,
});

const MACHINE_ID = 1;
const SHIFT_NUMBER = 1;
const OPERATOR_NAME = 'Operator Simulasi';

// Fungsi untuk generate data acak
function generateRandomData() {
    const meter_lari = Math.random() * 5 + 1; // 1-6 meter
    const joint_count = Math.floor(Math.random() * 10) + 1; // 1-10 joint
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
        const data = generateRandomData();
        
        const query = `
            INSERT INTO production_logs 
            (machine_id, shift_number, operator_name, meter_lari, joint_count, lebar_kayu, tebal_kayu, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
            RETURNING *;
        `;
        
        const values = [
            MACHINE_ID,
            SHIFT_NUMBER,
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
            return;
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
            const gapPercentage = targetPerShiftMeter > 0 ? ((actualMeter / targetPerShiftMeter) * 100) : 0;
            
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

// Fungsi utama simulasi
async function runSimulation() {
    console.log('🔄 Memulai simulasi produksi...');
    
    // Insert data awal
    await insertProductionData();
    await insertTallyData();
    await insertTargetGapData(); // Tambahkan target gap
    
    // Jalankan setiap 30 detik
    setInterval(async () => {
        await insertProductionData();
        await insertTallyData();
        await insertTargetGapData(); // Update target gap setiap 30 detik
    }, 30000); // 30 detik
    
    console.log('✅ Simulasi berjalan, data akan ditambahkan setiap 30 detik');
}

// Jalankan simulasi
runSimulation().catch(console.error);

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Simulasi dihentikan');
    await pool.end();
    process.exit(0);
});