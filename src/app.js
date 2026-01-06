require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// Modular Imports
const pool = require('../config/db'); 
const { initHardware, readInputs } = require('./hardware'); 
const { getShiftInfo } = require('./utils/shiftManager'); 
const { saveState, loadState } = require('./utils/persistence');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../public')));

// State Management
let sessionData = { 
    ...loadState(), 
    lastSensorStatus: false, 
    machinePower: false,
    isDowntime: false,
    lastActiveTime: Date.now()
};

// --- ROUTES ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// API untuk Tally (Input Manual/Nett)
app.post('/api/tally-upload', async (req, res) => {
    const { jam, meter_lari_tally } = req.body; 
    try {
        await pool.query(`
            INSERT INTO tally_logs (jam_ke, meter_lari, tanggal) 
            VALUES ($1, $2, CURRENT_DATE)
            ON CONFLICT (jam_ke, tanggal) DO UPDATE SET meter_lari = EXCLUDED.meter_lari`, 
            [parseInt(jam), parseFloat(meter_lari_tally)]);
        
        broadcastUpdate(); 
        res.json({ status: 'success' });
    } catch (err) { 
        console.error("❌ Tally Error:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

// --- CORE LOGIC ---

/**
 * Fungsi utama untuk mengirim data ke Dashboard Kiosk
 */
async function broadcastUpdate() {
    try {
        const shiftInfo = getShiftInfo();
        const currentShift = (!shiftInfo.shift || shiftInfo.shift === "-") ? 0 : parseInt(shiftInfo.shift);
        
        // 1. Ambil Target Produksi
        const targetQuery = await pool.query(`SELECT target_meter_lari FROM production_targets WHERE effective_date = CURRENT_DATE LIMIT 1`);
        const targetVal = targetQuery.rows[0]?.target_meter_lari || 1500;

        // 2. Ambil Total Capaian Mesin (Gross)
        const mainQuery = await pool.query(`
            SELECT COALESCE(SUM(meter_lari), 0) as total_meter, COALESCE(SUM(joint_count), 0) as total_joints 
            FROM production_logs 
            WHERE DATE(timestamp) = CURRENT_DATE AND shift_number = $1`, [currentShift]);
        
        const actualMeter = parseFloat(mainQuery.rows[0].total_meter);
        const efficiency = targetVal > 0 ? Math.round((actualMeter / targetVal) * 100) : 0;

        // 3. Ambil Data Trend (Mesin vs Tally)
        const trendMesinQuery = await pool.query(`
            SELECT EXTRACT(HOUR FROM timestamp) as jam_ke, SUM(meter_lari) as total 
            FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE AND shift_number = $1
            GROUP BY jam_ke`, [currentShift]);

        const trendTallyQuery = await pool.query(`SELECT jam_ke, meter_lari FROM tally_logs WHERE tanggal = CURRENT_DATE`);

        // Mapping Data Trend untuk Chart.js
        let dataMesin = Array(24).fill(0);
        let dataTally = Array(24).fill(0);
        trendMesinQuery.rows.forEach(r => dataMesin[parseInt(r.jam_ke)] = parseFloat(r.total));
        trendTallyQuery.rows.forEach(r => dataTally[parseInt(r.jam_ke)] = parseFloat(r.meter_lari));

        const labels = [], finalMesin = [], finalTally = [];
        // Loop jam kerja (07:00 pagi sampai 22:00 malam)
        for (let i = 7; i <= 22; i++) {
            labels.push(`${i.toString().padStart(2, '0')}:00`);
            finalMesin.push(dataMesin[i] || 0);
            finalTally.push(dataTally[i] || 0);
        }

        // 4. Emit ke Socket.io
        io.emit('productionUpdate', {
            current: actualMeter,
            target: targetVal,
            efficiency: efficiency, // Penambahan baru untuk mood emoji
            joints: parseInt(mainQuery.rows[0].total_joints),
            shift: {
                shift: shiftInfo.shift || "-",
                name: shiftInfo.name || "OFF",
                isOperational: sessionData.machinePower
            },
            trendMesin: finalMesin,
            trendTally: finalTally,
            labels: labels,
            isDowntime: sessionData.isDowntime // Status untuk Alert Kiosk
        });

    } catch (err) { 
        console.error("❌ Broadcast Error:", err.message); 
    }
}

// --- SOCKET EVENTS ---
io.on('connection', (socket) => {
    console.log(`💻 Dashboard Connected: ${socket.id}`);
    
    // Handler Reset (Hidden Admin)
    socket.on('requestReset', async () => {
        try {
            await pool.query("DELETE FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE");
            await pool.query("DELETE FROM tally_logs WHERE tanggal = CURRENT_DATE");
            sessionData.meter_lari = 0; 
            sessionData.joint_count = 0;
            saveState({ meter_lari: 0, joint_count: 0 });
            console.log("⚠️ Data Reset by Admin");
            broadcastUpdate();
            io.emit('resetDone');
        } catch (err) {
            console.error("Reset Failed:", err.message);
        }
    });
});

// --- SERVER START & SENSOR POLLING ---
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`
    ███████╗      ██████╗ ██████╗ ███╗   ██╗████████╗██████╗  ██████╗ ██╗     
    ██╔════╝      ██╔════╝██╔═══██╗████╗  ██║╚══██╔══╝██╔══██╗██╔═══██╗██║     
    █████╗  █████╗██║     ██║   ██║██╔██╗ ██║   ██║   ██████╔╝██║   ██║██║     
    ██╔══╝  ╚════╝██║     ██║   ██║██║╚██╗██║   ██║   ██╔══██╗██║   ██║██║     
    ██║           ╚██████╗╚██████╔╝██║ ╚████║   ██║   ██║  ██║╚██████╔╝███████╗
    ╚═╝            ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚══════╝
    📡 MILL 2 KIOSK SYSTEM ACTIVE: http://localhost:${PORT}
    `);

    await initHardware();

    // Polling Sensor (100ms) - Low Latency
    setInterval(async () => {
        try {
            const inputs = await readInputs();
            if (!inputs) { 
                io.emit('sensorStatus', 'disconnected'); 
                return; 
            }
            
            io.emit('sensorStatus', 'connected');
            
            // Input[7] = Power Mesin
            // Input[0] = Sensor Fingerjoint (Count)
            sessionData.machinePower = inputs[7];

            // Deteksi Downtime (Jika power mati)
            if (!inputs[7]) {
                if (!sessionData.isDowntime) {
                    sessionData.isDowntime = true;
                    broadcastUpdate();
                }
            } else {
                sessionData.isDowntime = false;
            }

            // Logic Counter (Rising Edge Detection)
            if (inputs[7] && inputs[0] === true && sessionData.lastSensorStatus === false) {
                const sNum = parseInt(getShiftInfo().shift) || 1;
                
                // Simpan Log ke DB (1.2 meter per joint - Sesuaikan dengan aktual)
                await pool.query(`
                    INSERT INTO production_logs (machine_id, meter_lari, joint_count, shift_number) 
                    VALUES (1, 1.2, 1, $1)`, [sNum]);
                
                broadcastUpdate();
            }
            
            sessionData.lastSensorStatus = inputs[0];

        } catch (e) { 
            io.emit('sensorStatus', 'disconnected'); 
        }
    }, 100);

    // Auto Refresh Dashboard tiap 5 detik (Sync data massal)
    setInterval(broadcastUpdate, 5000);
});