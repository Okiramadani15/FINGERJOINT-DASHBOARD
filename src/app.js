require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pool = require('../config/db');
const { initHardware, readInputs } = require('./hardware');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));


// State untuk kalkulasi (bisa disimpan di memori atau DB)
let sessionData = {
    meter_lari: 0,
    joint_count: 0,
    lastSensorStatus: false
};

// --- LOGIKA UTAMA: POLLING DATA HARDWARE ---
async function startProductionMonitoring() {
    console.log("🚀 Monitoring produksi dimulai...");
    
    setInterval(async () => {
        const inputs = await readInputs(); // Baca 8 channel dari R4DIF08
        
        if (inputs && inputs.length > 0) {
            const currentSensor = inputs[0]; // Kita gunakan I01 sebagai detektor kayu

            // Deteksi Rising Edge (Sinyal OFF ke ON)
            if (currentSensor === true && sessionData.lastSensorStatus === false) {
                sessionData.joint_count++;
                sessionData.meter_lari += 1.2; // Contoh: Asumsi 1.2 meter per sambungan

                // 1. Simpan ke Database
                try {
                    await pool.query(
                        `INSERT INTO public.production_logs 
                        (machine_id, meter_lari, joint_count, lebar_kayu, tebal_kayu, shift_number) 
                        VALUES ($1, $2, $3, $4, $5, $6)`,
                        [1, 1.2, 1, 100, 50, 1] // Nilai dimensi bisa dinamis dari UI nanti
                    );
                } catch (err) {
                    console.error("❌ Gagal simpan ke DB:", err.message);
                }

                // 2. Ambil Target untuk Hitung Progres & Kirim ke Socket.io
                broadcastUpdate();
            }
            sessionData.lastSensorStatus = currentSensor;
        }
    }, 100); // Scan setiap 100ms untuk akurasi tinggi
}

// Fungsi untuk kirim data ke Frontend secara real-time
async function broadcastUpdate() {
    try {
        // Ambil total meter hari ini & targetnya
        const result = await pool.query(`
            SELECT 
                SUM(meter_lari) as total_meter,
                (SELECT target_meter_lari FROM production_targets WHERE effective_date = CURRENT_DATE LIMIT 1) as target
            FROM production_logs 
            WHERE DATE(timestamp) = CURRENT_DATE
        `);

        const data = {
            current: result.rows[0].total_meter || 0,
            target: result.rows[0].target || 1000, // Default target 1000 jika belum diatur
            joints: sessionData.joint_count
        };

        io.emit('productionUpdate', data);
    } catch (err) {
        console.error("❌ Error broadcasting:", err.message);
    }
}

// Inisialisasi Koneksi
server.listen(PORT, async () => {
    console.log(`📡 Server berjalan di http://localhost:${PORT}`);
    await initHardware(); // Konek ke RS485
    startProductionMonitoring();
});