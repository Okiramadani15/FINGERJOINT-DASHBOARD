require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const pool = require('../config/db'); 
const { initHardware, readInputs } = require('./hardware'); 
const { getShiftInfo } = require('./utils/shiftManager'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3001;

app.use(express.json());
const publicPath = path.resolve(__dirname, '../public');
app.use(express.static(publicPath));

app.get('/', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
});

let sessionData = { meter_lari: 0, joint_count: 0, lastSensorStatus: false };

async function getHourlyTrend(shiftInfo) {
    try {
        const shiftNum = (shiftInfo.shift === "-" || !shiftInfo.shift) ? 0 : parseInt(shiftInfo.shift);
        let hourlyLabels = (shiftNum === 2) 
            ? ['15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00']
            : ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'];

        const query = `SELECT to_char(timestamp, 'HH24:00') as jam, SUM(meter_lari) as total FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE AND shift_number = $1 GROUP BY jam ORDER BY jam ASC`;
        const result = await pool.query(query, [shiftNum]);
        return {
            labels: hourlyLabels,
            values: hourlyLabels.map(label => {
                const dataPoint = result.rows.find(row => row.jam === label);
                return dataPoint ? parseFloat(dataPoint.total) : 0;
            })
        };
    } catch (err) { return { labels: [], values: [] }; }
}

async function broadcastUpdate() {
    try {
        const shiftInfo = getShiftInfo();
        const currentShift = (shiftInfo.shift === "-" || !shiftInfo.shift) ? 0 : parseInt(shiftInfo.shift);
        const queryResult = await pool.query(`SELECT COALESCE(SUM(meter_lari), 0) as total_meter, (SELECT target_meter_lari FROM production_targets WHERE effective_date = CURRENT_DATE LIMIT 1) as target_val FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE AND shift_number = $1`, [currentShift]);
        const trendData = await getHourlyTrend(shiftInfo);
        io.emit('productionUpdate', {
            current: queryResult.rows[0].total_meter,
            target: queryResult.rows[0].target_val || 1500,
            joints: sessionData.joint_count,
            shift: shiftInfo,
            trend: trendData.values,
            labels: trendData.labels
        });
    } catch (err) { console.error("❌ Broadcast Error"); }
}

server.listen(PORT, '0.0.0.0', async () => {
    console.log(`📡 Dashboard KIOSK berjalan di http://localhost:${PORT}`);
    await initHardware();
    setInterval(async () => {
        const inputs = await readInputs();
        if (inputs && inputs.length > 0) {
            const currentSensor = inputs[0]; 
            const shiftInfo = getShiftInfo();
            if (currentSensor === true && sessionData.lastSensorStatus === false) {
                if (shiftInfo.isOperational) {
                    sessionData.joint_count++;
                    sessionData.meter_lari += 1.2;
                    try { await pool.query(`INSERT INTO public.production_logs (machine_id, meter_lari, joint_count, lebar_kayu, tebal_kayu, shift_number) VALUES (1, 1.2, 1, 100, 50, $1)`, [parseInt(shiftInfo.shift)]); } catch (err) {}
                }
                broadcastUpdate();
            }
            sessionData.lastSensorStatus = currentSensor;
        }
    }, 100);
});