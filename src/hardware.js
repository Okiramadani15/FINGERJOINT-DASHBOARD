// 

const ModbusRTU = require("modbus-serial");
require("dotenv").config();

// ================== MODBUS CLIENT ==================
const client = new ModbusRTU();

// ================== GLOBAL STATE ==================
let isSimulation = true;
let isConnecting = false;

// Simulation state
let simStatus = false;
let nextActionTime = Date.now();

// Debounce state
let lastStableValue = false;
let lastRawValue = false;
let lastChangeTime = Date.now();

// Debounce config (ms)
const DEBOUNCE_TIME = 50;

// ================== INIT HARDWARE ==================
async function initHardware() {
    if (isConnecting) return;
    isConnecting = true;

    try {
        if (!process.env.MODBUS_PORT || process.env.MODBUS_PORT === "SIM") {
            isSimulation = true;
            console.log("⚠️ Hardware Mode: SIMULATION");
            isConnecting = false;
            return;
        }

        console.log(`🔄 Connecting Modbus RTU → ${process.env.MODBUS_PORT}`);
        await client.connectRTUBuffered(process.env.MODBUS_PORT, {
            baudRate: 9600
        });

        client.setID(1);
        client.setTimeout(1000);

        isSimulation = false;
        console.log("✅ Modbus Connected (R4DIF08)");
    } catch (err) {
        isSimulation = true;
        console.log("❌ Modbus Connection Failed, retry in 10s");
        setTimeout(initHardware, 10000);
    } finally {
        isConnecting = false;
    }
}

// ================== SIMULATION ==================
function readSimulationInputs() {
    const now = Date.now();

    if (now > nextActionTime) {
        simStatus = !simStatus;
        nextActionTime = now + (simStatus ? 800 : 2500);
    }

    // [0] joint sensor, [7] power ON
    return [simStatus, false, false, false, false, false, false, true];
}

// ================== DEBOUNCE LOGIC ==================
function debounceSignal(rawValue) {
    const now = Date.now();

    if (rawValue !== lastRawValue) {
        lastChangeTime = now;
        lastRawValue = rawValue;
    }

    if ((now - lastChangeTime) >= DEBOUNCE_TIME) {
        lastStableValue = rawValue;
    }

    return lastStableValue;
}

// ================== READ INPUTS ==================
async function readInputs() {
    // ---- SIMULATION ----
    if (isSimulation) {
        const simInputs = readSimulationInputs();
        simInputs[0] = debounceSignal(simInputs[0]);
        return simInputs;
    }

    // ---- REAL HARDWARE ----
    try {
        if (!client.isOpen) {
            await initHardware();
            return null;
        }

        const res = await client.readDiscreteInputs(0, 8);
        const data = res.data;

        // Apply debounce ONLY to joint sensor
        data[0] = debounceSignal(data[0]);

        return data;
    } catch (err) {
        console.log("❌ Modbus Read Error → reconnecting...");
        return null;
    }
}

// ================== EXPORT ==================
module.exports = {
    initHardware,
    readInputs,
    client
};
