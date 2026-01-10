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
app.use(express.json()); // Middleware untuk parsing JSON

// Endpoint untuk reset data
app.post('/reset-data', async (req, res) => {
    const { password } = req.body;

    // Kata sandi sederhana, bisa diganti di .env
    if (password !== (process.env.RESET_PASSWORD || 'kbmjaya')) {
        return res.status(401).json({ message: 'Kata sandi salah.' });
    }

    try {
        console.log('🔥 Mereset data produksi untuk hari ini...');
        
        // Hapus data dari tabel-tabel terkait
        await pool.query("DELETE FROM production_logs WHERE DATE(timestamp) = CURRENT_DATE");
        await pool.query("DELETE FROM tally_logs WHERE tanggal = CURRENT_DATE");
        await pool.query("DELETE FROM target_gap_per_shift WHERE date = CURRENT_DATE");

        console.log('✅ Data berhasil direset.');

        // Broadcast update setelah reset
        broadcast();

        res.status(200).json({ message: 'Data produksi hari ini telah berhasil direset.' });
    } catch (error) {
        console.error('❌ Gagal mereset data:', error);
        res.status(500).json({ message: 'Terjadi kesalahan pada server.' });
    }
});

async function broadcast() {
    const shift = getShiftInfo();
    
    if (!shift.isOperational) {
        io.emit('statusUpdate', {
            shift: shift.name,
            isOperational: false,
            message: 'Mesin dalam mode standby di luar jam kerja.'
        });
        return;
    }

    const date = new Date().toISOString().slice(0,10);

    const oee = await calculateOEE({
        machineId: MACHINE_ID,
        shiftNumber: shift.shift,
        date
    });

    const trendRes = await pool.query(`
        SELECT 
            hour,
            SUM(machine_data) AS machine,
            SUM(tally_data) AS tally
        FROM (
            SELECT 
                EXTRACT(HOUR FROM timestamp) AS hour,
                meter_lari AS machine_data,
                0 AS tally_data
            FROM production_logs
            WHERE DATE(timestamp) = CURRENT_DATE
            
            UNION ALL
            
            SELECT 
                jam_ke AS hour,
                0 AS machine_data,
                meter_lari AS tally_data
            FROM tally_logs
            WHERE tanggal = CURRENT_DATE
        ) combined_data
        GROUP BY hour
        ORDER BY hour
    `);

    const machineArr = Array(17).fill(0);
    const tallyArr = Array(17).fill(0);

    trendRes.rows.forEach(r => {
        const idx = r.hour - 7;
        if (idx >= 0 && idx < 17) {
            machineArr[idx] = Number(r.machine || 0);
            tallyArr[idx] = Number(r.tally || 0);
        }
    });

    console.log('📊 Data OEE:', {
        current: oee.actual,
        efficiency: oee.P,
        joints: oee.joints,
        trendMachine: machineArr,
        trendTally: tallyArr
    });

    const today = new Date();
    const tanggalFormatted = today.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });

    const targetGapRes = await pool.query(`
        SELECT * 
        FROM target_gap_per_shift 
        WHERE date = CURRENT_DATE AND shift_number = $1
    `, [shift.shift]);

    const targetGap = targetGapRes.rows[0] || {};

    io.emit('productionUpdate', {
        current: oee.actual,
        efficiency: oee.P,
        joints: oee.joints,
        trendMachine: machineArr,
        trendTally: tallyArr,
        shift: shift.shift,
        shiftName: shift.name,
        tanggal: tanggalFormatted,
        targetGap: {
            target_meter: parseFloat(targetGap.target_meter || 0),
            actual_meter: parseFloat(targetGap.actual_meter || 0),
            gap_meter: parseFloat(targetGap.gap_meter || 0),
            achievement_percentage: parseFloat(targetGap.achievement_percentage || 0)
        }
    });

    io.emit('oeeUpdate', oee);
}

setInterval(broadcast, 5000);

io.on('connection', () => broadcast());

server.listen(PORT, () =>
    console.log(`🚀 Dashboard running on port ${PORT}`)
);
