const ModbusRTU = require("modbus-serial");
require('dotenv').config();

const client = new ModbusRTU();
let isSimulation = false;

// Variabel internal untuk logika simulasi realistik
let simStatus = false;
let nextActionTime = Date.now();

async function initHardware() {
    try {
        // Jika di .env tidak ada port atau diisi "SIM", otomatis masuk mode simulasi
        if (!process.env.MODBUS_PORT || process.env.MODBUS_PORT === "SIM") {
            throw new Error("Port disetel ke Mode Simulasi");
        }

        await client.connectRTUBuffered(process.env.MODBUS_PORT, { 
            baudRate: parseInt(process.env.MODBUS_BAUD) || 9600 
        });
        client.setID(parseInt(process.env.MODBUS_ID) || 1);
        isSimulation = false;
        console.log("✅ HARDWARE MODE: Terhubung ke " + process.env.MODBUS_PORT);
    } catch (err) {
        isSimulation = true;
        console.log("⚠️  SIMULATION MODE ACTIVE: " + err.message);
    }
}

async function readInputs() {
    if (isSimulation) {
        const now = Date.now();

        // Logika Simulasi Realistik:
        // Mensimulasikan kayu lewat setiap 3-7 detik, dengan durasi sensor aktif 1-2 detik
        if (now > nextActionTime) {
            simStatus = !simStatus; // Toggle status sensor (ON/OFF)
            
            if (simStatus) {
                // Berapa lama sensor akan menyala (durasi kayu lewat sensor)
                const durationOn = Math.floor(Math.random() * 1000) + 1000; // 1-2 detik
                nextActionTime = now + durationOn;
            } else {
                // Berapa lama jeda sampai kayu berikutnya datang
                const durationOff = Math.floor(Math.random() * 4000) + 3000; // 3-7 detik
                nextActionTime = now + durationOff;
            }
        }
        
        // Mengembalikan array 8 channel, I01 (indeks 0) adalah sensor utama
        return [simStatus, false, false, false, false, false, false, false];
    }

    // Pembacaan Asli jika Hardware Terkoneksi
    try {
        if (!client.isOpen) return null;
        const res = await client.readDiscreteInputs(0, 8);
        return res.data;
    } catch (err) {
        return null;
    }
}

module.exports = { initHardware, readInputs };