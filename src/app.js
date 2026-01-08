
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// ================== MODULAR IMPORTS ==================
const pool = require('../config/db');
const { initHardware, readInputs } = require('./hardware');
const { getShiftInfo } = require('./utils/shiftManager');
const { saveState, loadState } = require('./utils/persistence');

// ================== APP INIT ==================
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3001;

// ================== MIDDLEWARE ==================
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../public')));

// ================== STATE MANAGEMENT ==================
let sessionData = {
    ...loadState(),
    lastSensorStatus: false,
    machinePower: false,
    isDowntime: false,
    lastActiveTime: Date.now()
};

// ================== ROUTES ==================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Manual Tally Input (NETT)
app.post('/api/tally-upload', async (req, res) => {
    const { jam, meter_lari_tally } = req.body;
    try {
        await pool.query(`
            INSERT INTO tally_logs (jam_ke, meter_lari, tanggal)
            VALUES ($1, $2, CURRENT_DATE)
            ON CONFLICT (jam_ke, tanggal)
            DO UPDATE SET meter_lari = EXCLUDED.meter_lari
        `, [parseInt(jam), parseFloat(meter_lari_tally)]);

        await broadcastUpdate();
        res.json({ status: 'success' });
    } catch (err) {
        console.error("❌ Tally Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ================== CORE FUNCTIONS ==================

/**
 * 🔁 Rebuild Session State dari Database
 * Dipanggil saat server startup (anti data loss)
 */
async function rebuildSessionFromDB() {
    try {
        const shiftInfo = getShiftInfo();
        const shiftNum = parseInt(shiftInfo.shift) || 0;

        const res = await pool.query(`
            SELECT 
                COUNT(*) AS joints,
                COALESCE(SUM(meter_lari),0) AS meter
            FROM production_logs
            WHERE DATE(timestamp) = CURRENT_DATE
            AND shift_number = $1
        `, [shiftNum]);

        sessionData.joint_count = parseInt(res.rows[0].joints);
        sessionData.meter_lari = parseFloat(res.rows[0].meter);

        console.log("🔄 Session rebuilt from DB");
    } catch (err) {
        console.error("❌ Failed rebuilding session:", err.message);
    }
}

/**
 * 📡 Broadcast data ke semua Kiosk
 */
async function broadcastUpdate() {
    try {
        const shiftInfo = getShiftInfo();
        const currentShift = (!shiftInfo.shift || shiftInfo.shift === "-")
            ? 0
            : parseInt(shiftInfo.shift);

        // Target Produksi
        const targetRes = await pool.query(`
            SELECT target_meter_lari
            FROM production_targets
            WHERE effective_date = CURRENT_DATE
            LIMIT 1
        `);
        const targetVal = targetRes.rows[0]?.target_meter_lari || 1500;

        // Total Produksi Mesin (Gross)
        const prodRes = await pool.query(`
            SELECT 
                COALESCE(SUM(meter_lari),0) AS total_meter,
                COALESCE(SUM(joint_count),0) AS total_joints
            FROM production_logs
            WHERE DATE(timestamp) = CURRENT_DATE
            AND shift_number = $1
        `, [currentShift]);

        const actualMeter = parseFloat(prodRes.rows[0].total_meter);
        const efficiency = targetVal > 0
            ? Math.round((actualMeter / targetVal) * 100)
            : 0;

        // Trend Mesin
        const mesinTrend = await pool.query(`
            SELECT EXTRACT(HOUR FROM timestamp) AS jam_ke,
                   SUM(meter_lari) AS total
            FROM production_logs
            WHERE DATE(timestamp) = CURRENT_DATE
            AND shift_number = $1
            GROUP BY jam_ke
        `, [currentShift]);

        // Trend Tally
        const tallyTrend = await pool.query(`
            SELECT jam_ke, meter_lari
            FROM tally_logs
            WHERE tanggal = CURRENT_DATE
        `);

        const dataMesin = Array(24).fill(0);
        const dataTally = Array(24).fill(0);

        mesinTrend.rows.forEach(r => dataMesin[parseInt(r.jam_ke)] = parseFloat(r.total));
        tallyTrend.rows.forEach(r => dataTally[parseInt(r.jam_ke)] = parseFloat(r.meter_lari));

        const labels = [];
        const finalMesin = [];
        const finalTally = [];

        for (let i = 7; i <= 22; i++) {
            labels.push(`${i.toString().padStart(2, '0')}:00`);
            finalMesin.push(dataMesin[i] || 0);
            finalTally.push(dataTally[i] || 0);
        }

        io.emit('productionUpdate', {
            current: actualMeter,
            target: targetVal,
            efficiency,
            joints: parseInt(prodRes.rows[0].total_joints),
            shift: {
                shift: shiftInfo.shift || "-",
                name: shiftInfo.name || "OFF",
                isOperational: sessionData.machinePower
            },
            trendMesin: finalMesin,
            trendTally: finalTally,
            labels,
            isDowntime: sessionData.isDowntime
        });

    } catch (err) {
        console.error("❌ Broadcast Error:", err.message);
    }
}

// ================== SOCKET.IO ==================
io.on('connection', (socket) => {
    console.log(`💻 Dashboard Connected: ${socket.id}`);

    socket.on('requestReset', async () => {
        try {
            await pool.query(`DELETE FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE`);
            await pool.query(`DELETE FROM tally_logs WHERE tanggal = CURRENT_DATE`);

            sessionData.meter_lari = 0;
            sessionData.joint_count = 0;
            saveState({ meter_lari: 0, joint_count: 0 });

            console.log("⚠️ Production data reset by admin");
            await broadcastUpdate();
            io.emit('resetDone');
        } catch (err) {
            console.error("❌ Reset Failed:", err.message);
        }
    });
});

// ================== SERVER START ==================
server.listen(PORT, '0.0.0.0', async () => {
    console.log(`📡 MILL 2 KIOSK SYSTEM ACTIVE: http://localhost:${PORT}`);

    await initHardware();
    await rebuildSessionFromDB();

    // ================== SENSOR POLLING ==================
    setInterval(async () => {
        try {
            const inputs = await readInputs();
            if (!inputs) {
                io.emit('sensorStatus', 'disconnected');
                return;
            }

            io.emit('sensorStatus', 'connected');
            sessionData.lastActiveTime = Date.now();

            // INPUT MAP
            // [0] = Joint Sensor
            // [7] = Power Machine
            sessionData.machinePower = inputs[7];

            // Downtime detection
            if (!inputs[7] && !sessionData.isDowntime) {
                sessionData.isDowntime = true;
                await pool.query(
                    `INSERT INTO machine_events(event_type) VALUES ('POWER_LOSS')`
                );
                await broadcastUpdate();
            }

            if (inputs[7]) {
                sessionData.isDowntime = false;
            }

            // Rising edge counter
            if (inputs[7] && inputs[0] && !sessionData.lastSensorStatus) {
                const sNum = parseInt(getShiftInfo().shift) || 1;

                await pool.query(`
                    INSERT INTO production_logs
                    (machine_id, meter_lari, joint_count, shift_number)
                    VALUES (1, 1.2, 1, $1)
                `, [sNum]);

                await broadcastUpdate();
            }

            sessionData.lastSensorStatus = inputs[0];

        } catch (err) {
            io.emit('sensorStatus', 'disconnected');
        }
    }, 100);

    // ================== WATCHDOG ==================
    setInterval(() => {
        if (Date.now() - sessionData.lastActiveTime > 5000) {
            console.warn("⚠️ SENSOR STALLED / NO ACTIVITY");
        }
    }, 5000);

    // ================== PERIODIC SYNC ==================
    setInterval(broadcastUpdate, 5000);
});
