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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

let sessionData = { ...loadState(), lastSensorStatus: false, machinePower: false };

// API untuk Tally (Hanya untuk grafik, tidak mempengaruhi target %)
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
    } catch (err) { res.status(500).json({ error: err.message }); }
});

async function broadcastUpdate() {
    try {
        const shiftInfo = getShiftInfo();
        const currentShift = (!shiftInfo.shift || shiftInfo.shift === "-") ? 0 : parseInt(shiftInfo.shift);
        
        // Target diambil dari DB (default 1500 jika tidak ada)
        const targetQuery = await pool.query(`SELECT target_meter_lari FROM production_targets WHERE effective_date = CURRENT_DATE LIMIT 1`);
        const targetVal = targetQuery.rows[0]?.target_meter_lari || 1500;

        // Capaian MESIN (Gross)
        const mainQuery = await pool.query(`
            SELECT COALESCE(SUM(meter_lari), 0) as total_meter FROM production_logs 
            WHERE DATE(timestamp) = CURRENT_DATE AND shift_number = $1`, [currentShift]);
        
        const trendMesinQuery = await pool.query(`
            SELECT EXTRACT(HOUR FROM timestamp) as jam_ke, SUM(meter_lari) as total 
            FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE AND shift_number = $1
            GROUP BY jam_ke`, [currentShift]);

        const trendTallyQuery = await pool.query(`SELECT jam_ke, meter_lari FROM tally_logs WHERE tanggal = CURRENT_DATE`);

        let dataMesin = Array(24).fill(0);
        let dataTally = Array(24).fill(0);
        trendMesinQuery.rows.forEach(r => dataMesin[parseInt(r.jam_ke)] = parseFloat(r.total));
        trendTallyQuery.rows.forEach(r => dataTally[parseInt(r.jam_ke)] = parseFloat(r.meter_lari));

        const labels = [], finalMesin = [], finalTally = [];
        for (let i = 7; i <= 22; i++) {
            labels.push(`${i.toString().padStart(2, '0')}:00`);
            finalMesin.push(dataMesin[i] || 0);
            finalTally.push(dataTally[i] || 0);
        }

        io.emit('productionUpdate', {
            current: parseFloat(mainQuery.rows[0].total_meter), // Berdasarkan Mesin
            target: targetVal,
            joints: sessionData.joint_count,
            shift: {
                shift: shiftInfo.shift || "1",
                name: shiftInfo.name || "PAGI",
                isOperational: sessionData.machinePower
            },
            trendMesin: finalMesin,
            trendTally: finalTally,
            labels: labels 
        });
    } catch (err) { console.error("❌ Broadcast Error:", err.message); }
}

io.on('connection', (socket) => {
    socket.on('requestReset', async () => {
        await pool.query("DELETE FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE");
        await pool.query("DELETE FROM tally_logs WHERE tanggal = CURRENT_DATE");
        sessionData.meter_lari = 0; sessionData.joint_count = 0;
        saveState({ meter_lari: 0, joint_count: 0 });
        io.emit('resetDone');
    });
});

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`📡 KIOSK ON: http://localhost:${PORT}`);
    await initHardware();
    setInterval(async () => {
        try {
            const inputs = await readInputs();
            if (!inputs) { io.emit('sensorStatus', 'disconnected'); return; }
            io.emit('sensorStatus', 'connected');
            
            sessionData.machinePower = inputs[7];
            if (inputs[7] && inputs[0] === true && sessionData.lastSensorStatus === false) {
                const sNum = parseInt(getShiftInfo().shift) || 1;
                sessionData.joint_count++;
                await pool.query(`INSERT INTO production_logs (machine_id, meter_lari, joint_count, shift_number) VALUES (1, 1.2, 1, $1)`, [sNum]);
                broadcastUpdate();
            }
            sessionData.lastSensorStatus = inputs[0];
        } catch (e) { io.emit('sensorStatus', 'disconnected'); }
    }, 100);
    setInterval(broadcastUpdate, 5000);
});