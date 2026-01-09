require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const pool = require('../config/db');
const { initHardware, readInputs } = require('./hardware');
const { getShiftInfo } = require('./utils/shiftManager');
const { saveState, loadState } = require('./utils/persistence');
const { handlePowerState } = require('./services/downtimeEngine');
const { calculateOEE } = require('./services/oeeEngine');
const logger = require('./utils/logger');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../public')));

/* =========================
   STATE
========================= */
let session = { ...loadState(), lastSensor: false, isDowntime: false };

/* =========================
   ROUTE
========================= */
app.get('/', (_, res) =>
    res.sendFile(path.join(__dirname, '../public/index.html'))
);

/* =========================
   BROADCAST PRODUKSI & OEE
========================= */
async function broadcast() {
    try {
        const shift = getShiftInfo();
        const shiftNum = parseInt(shift.shift) || 1;
        const today = new Date().toISOString().slice(0,10);

        // 1. Get OEE Data (Single Source of Truth)
        const oeeData = await calculateOEE({ machineId: 1, shiftNumber: shiftNum, date: today });
        
        // 2. Production Data (from OEE)
        const actual = oeeData.actual;
        const target = oeeData.target;
        const efficiency = oeeData.performance; // Use Performance from OEE as Efficiency
        const joints = await getJointCount(shiftNum); // Helper needed or query directly

        // 3. Trend Data
        // Handle shift crossing midnight for trend if needed, currently simplistic
        const trendRes = await pool.query(`
            SELECT EXTRACT(HOUR FROM timestamp) AS jam, SUM(meter_lari) AS meter
            FROM production_logs
            WHERE DATE(timestamp) = CURRENT_DATE
            AND shift_number = $1
            GROUP BY jam
        `, [shiftNum]);

        const trend = Array(24).fill(0); // Support 24 hours
        trendRes.rows.forEach(r => {
            const h = parseInt(r.jam);
            if (h >= 0 && h < 24) trend[h] = Number(r.meter);
        });
        
        // Slice trend based on shift to make it cleaner for frontend chart?
        // Frontend expects 17 data points (07-23). Let's keep it simple for now or adjust frontend.
        // For compatibility with current frontend hardcoded 07-23:
        const trendFrontend = Array(17).fill(0);
        for(let i=0; i<17; i++) {
            trendFrontend[i] = trend[i+7] || 0;
        }

        // Emit Production
        io.emit('productionUpdate', {
            current: actual,
            target,
            efficiency,
            joints,
            trendMesin: trendFrontend, // Keep compatibility
            trendTally: trendFrontend,
            shift,
            isDowntime: session.isDowntime
        });

        // Emit OEE
        io.emit('oeeUpdate', oeeData);

    } catch (err) {
        console.error('❌ Broadcast Error:', err.message);
    }
}

async function getJointCount(shiftNum) {
    const res = await pool.query(`
        SELECT COALESCE(SUM(joint_count),0) AS joints
        FROM production_logs
        WHERE DATE(timestamp) = CURRENT_DATE
        AND shift_number = $1
    `, [shiftNum]);
    return Number(res.rows[0].joints);
}

/* =========================
   DEBOUNCE STATE
========================= */
let lastProductionTime = 0;
const MIN_PRODUCTION_INTERVAL = 2000; // ms (Mencegah double count dalam 2 detik)

/* =========================
   SOCKET CONNECTION
========================= */
io.on('connection', socket => {
    socket.emit('sensorStatus', session.lastSensor ? 'connected' : 'disconnected');
    broadcast(); // Send initial data

    socket.on('requestReset', async (pin) => {
        // SECURITY: Validasi PIN di Backend
        const SUPERVISOR_PIN = process.env.SUPERVISOR_PIN || '1234';
        
        if (pin !== SUPERVISOR_PIN) {
            logger.warn(`Percobaan reset gagal: PIN salah (${pin})`);
            socket.emit('resetError', 'PIN Salah!');
            return;
        }

        try {
            await pool.query(`DELETE FROM production_logs WHERE DATE(timestamp)=CURRENT_DATE`);
            logger.info('Reset produksi berhasil dilakukan oleh Supervisor');
            io.emit('resetDone');
            broadcast();
        } catch (err) {
            logger.error(`Reset error: ${err.message}`);
        }
    });
});

/* =========================
   SENSOR LOOP
========================= */
server.listen(PORT, async () => {
    logger.info(`📡 RUNNING http://localhost:${PORT}`);
    await initHardware();

    // Loop Sensor: 500ms (Responsive enough)
    setInterval(async () => {
        try {
            const inputs = await readInputs();
            if(!inputs){
                io.emit('sensorStatus', 'disconnected');
                return;
            }

            // Only emit if status changes to reduce traffic
            // io.emit('sensorStatus', 'connected'); // Client assumes connected if receiving updates

            const power = inputs[7];
            const isDowntime = !power;
            
            // Update Session
            if (session.isDowntime !== isDowntime) {
                session.isDowntime = isDowntime;
                broadcast(); // Immediate update on state change
            }

            await handlePowerState({
                machineId: 1,
                shiftNumber: parseInt(getShiftInfo().shift) || 1,
                isPowerOn: power
            });

            // Production Trigger with Debounce (Time-based)
            const now = Date.now();
            if(power && inputs[0] && !session.lastSensor){
                if (now - lastProductionTime >= MIN_PRODUCTION_INTERVAL) {
                    await pool.query(`
                        INSERT INTO production_logs
                        (machine_id, meter_lari, joint_count, shift_number)
                        VALUES (1, 1.2, 1, $1)
                    `, [parseInt(getShiftInfo().shift)]);
                    
                    lastProductionTime = now;
                    broadcast(); // Immediate update on production
                } else {
                    logger.warn('Ignored rapid sensor pulse (Debounced)');
                }
            }

            session.lastSensor = inputs[0];
            // saveState(session); // REMOVED: Not needed for DB-based app

        } catch(e){
            logger.error(`SENSOR ERROR: ${e.message}`);
        }
    }, 500); // Faster polling for sensor accuracy

    // Periodic Broadcast (Keep UI fresh)
    setInterval(() => broadcast(), 5000); 
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        logger.error(`❌ Port ${PORT} is already in use! Please kill the process using this port.`);
        process.exit(1);
    } else {
        logger.error(`❌ Server error: ${err.message}`);
    }
});

/* =========================
   GRACEFUL SHUTDOWN
========================= */
const shutdown = (signal) => {
    logger.info(`${signal} received. Closing server...`);
    
    // Force exit after 3s if stuck
    setTimeout(() => {
        logger.error('Force shutting down due to timeout...');
        process.exit(1);
    }, 3000);

    // Close Socket.io first to disconnect clients
    io.close(() => {
        server.close(() => {
            logger.info('HTTP server closed.');
            pool.end(() => {
                logger.info('Database connection closed.');
                process.exit(0);
            });
        });
    });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle Nodemon Restart Signal
process.once('SIGUSR2', () => shutdown('SIGUSR2'));
