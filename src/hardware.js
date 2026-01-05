const ModbusRTU = require("modbus-serial");
require('dotenv').config();

const client = new ModbusRTU();
let isSimulation = false;
let simStatus = false;
let nextActionTime = Date.now();

async function initHardware() {
    try {
        if (!process.env.MODBUS_PORT || process.env.MODBUS_PORT === "SIM") {
            throw new Error("Mode Simulasi");
        }
        await client.connectRTUBuffered(process.env.MODBUS_PORT, { baudRate: 9600 });
        client.setID(1);
        isSimulation = false;
        console.log("✅ Terhubung ke PLC");
    } catch (err) {
        isSimulation = true;
        console.log("⚠️ Mode Simulasi Aktif");
    }
}

async function readInputs() {
    if (isSimulation) {
        const now = Date.now();
        if (now > nextActionTime) {
            simStatus = !simStatus;
            nextActionTime = now + (simStatus ? 1500 : 4000);
        }
        return [simStatus, false, false, false, false, false, false, false];
    }
    try {
        if (!client.isOpen) return null;
        const res = await client.readDiscreteInputs(0, 8);
        return res.data;
    } catch (err) { return null; }
}

module.exports = { initHardware, readInputs };