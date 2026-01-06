const ModbusRTU = require("modbus-serial");
require('dotenv').config();

const client = new ModbusRTU();
let isSimulation = true;
let simStatus = false;
let nextActionTime = Date.now();
let isConnecting = false;

async function initHardware() {
    if (isConnecting) return; // Mencegah multiple attempts sekaligus
    isConnecting = true;

    try {
        if (!process.env.MODBUS_PORT || process.env.MODBUS_PORT === "SIM") {
            isSimulation = true;
            console.log("⚠️ Mode Simulasi Aktif (Tanpa Hardware)");
            isConnecting = false;
            return;
        }

        console.log(`🔄 Mencoba menghubungkan ke ${process.env.MODBUS_PORT}...`);
        await client.connectRTUBuffered(process.env.MODBUS_PORT, { baudRate: 9600 });
        client.setID(1);
        client.setTimeout(1000);
        
        isSimulation = false;
        isConnecting = false;
        console.log("✅ Terhubung ke Perangkat R4DIF08");
    } catch (err) {
        isSimulation = true;
        isConnecting = false;
        console.log("⚠️ Hardware tidak ditemukan, mencoba lagi dalam 10 detik...");
        setTimeout(initHardware, 10000); // Auto-retry
    }
}

async function readInputs() {
    if (isSimulation) {
        const now = Date.now();
        if (now > nextActionTime) {
            simStatus = !simStatus;
            nextActionTime = now + (simStatus ? 1000 : 3000);
        }
        return [simStatus, false, false, false, false, false, false, true]; 
    }
    
    try {
        if (!client.isOpen) {
            await initHardware(); // Coba hubungkan kembali jika tertutup
            return null;
        }
        const res = await client.readDiscreteInputs(0, 8);
        return res.data;
    } catch (err) { 
        console.log("❌ Modbus Read Error, beralih ke pengecekan koneksi...");
        return null; 
    }
}

module.exports = { initHardware, readInputs, client };