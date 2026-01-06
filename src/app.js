require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const pool = require('../config/db'); 
const { initHardware, readInputs } = require('./hardware'); 
const { getShiftInfo } = require('./utils/shiftManager'); 
const { saveState, loadState } = require('./utils/persistence');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../public')));

// Load state awal dari file backup
let sessionData = { 
    ...loadState(), 
    lastSensorStatus: false,
    machinePower: false 
};

// Fungsi kirim data ke UI
async function broadcastUpdate() {
    try {
        const shiftInfo = getShiftInfo();
        const currentShift = (shiftInfo.shift === "-" || !shiftInfo.shift) ? 0 : parseInt(shiftInfo.shift);
        
        // Ambil data MURNI dari database
        const queryResult = await pool.query(`
            SELECT COALESCE(SUM(meter_lari), 0) as total_meter, 
            (SELECT target_meter_lari FROM production_targets WHERE effective_date = CURRENT_DATE LIMIT 1) as target_val 
            FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE AND shift_number = $1`, [currentShift]);
        
        const currentTotal = parseFloat(queryResult.rows[0].total_meter);

        io.emit('productionUpdate', {
            current: currentTotal,
            target: queryResult.rows[0].target_val || 1500,
            joints: sessionData.joint_count,
            shift: { ...shiftInfo, isOperational: sessionData.machinePower },
            trend: [0,0,0,0,0,0,0,0,0],
            labels: [] 
        });
    } catch (err) { console.error("❌ Broadcast Error:", err.message); }
}

// Socket Handler untuk Reset
io.on('connection', (socket) => {
    socket.on('requestReset', async () => {
        try {
            console.log("⚠️ RESET TRIGGERED: Clearing all production data...");

            // 1. Hapus database hari ini
            await pool.query("DELETE FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE");

            // 2. Reset memori aplikasi
            sessionData.meter_lari = 0;
            sessionData.joint_count = 0;

            // 3. Reset file backup persistence.json
            saveState({ meter_lari: 0, joint_count: 0 });

            // 4. Kirim data 0 secara manual agar UI langsung berubah sebelum refresh
            io.emit('productionUpdate', {
                current: 0,
                target: 1500,
                joints: 0,
                shift: { ...getShiftInfo(), isOperational: sessionData.machinePower },
                trend: [0,0,0,0,0,0,0,0,0],
                labels: []
            });

            // 5. Beri sinyal ke kiosk.js untuk location.reload()
            setTimeout(() => {
                io.emit('resetDone');
                console.log("✅ Reset Complete.");
            }, 500);

        } catch (err) {
            console.error("❌ Reset Failed:", err.message);
        }
    });
});

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`📡 Dashboard KIOSK ON: http://localhost:${PORT}`);
    await initHardware();
    
    // Monitoring Loop
    setInterval(async () => {
        try {
            const inputs = await readInputs();
            if (!inputs) { io.emit('sensorStatus', 'disconnected'); return; }

            io.emit('sensorStatus', 'connected');
            const sensorKayu = inputs[0]; 
            const powerMesin = inputs[7]; 
            sessionData.machinePower = powerMesin;

            if (powerMesin && sensorKayu === true && sessionData.lastSensorStatus === false) {
                const shiftInfo = getShiftInfo();
                const sNum = (shiftInfo.shift === "-" || !shiftInfo.shift) ? 0 : parseInt(shiftInfo.shift);

                sessionData.joint_count++;
                sessionData.meter_lari += 1.2;
                
                await pool.query(`INSERT INTO production_logs (machine_id, meter_lari, joint_count, shift_number) VALUES (1, 1.2, 1, $1)`, [sNum]);
                saveState({ meter_lari: sessionData.meter_lari, joint_count: sessionData.joint_count });
                broadcastUpdate();
            }
            sessionData.lastSensorStatus = sensorKayu;
        } catch (e) {}
    }, 100);

    // Sync rutin
    setInterval(broadcastUpdate, 5000);
});