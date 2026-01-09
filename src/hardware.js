// 

/**
 * ======================================================
 * HARDWARE SERVICE – MODBUS / SIMULATION
 * ======================================================
 * - Auto reconnect
 * - Simulation & Real hardware share same interface
 * - NEVER throw error to app.js
 * - Safe for production & field installation
 */

const ModbusRTU = require("modbus-serial");
require("dotenv").config();

// ================== CONFIG ==================
const MODBUS_PORT = process.env.MODBUS_PORT;
const MODBUS_BAUD = parseInt(process.env.MODBUS_BAUD || "9600");
const MODBUS_ID = parseInt(process.env.MODBUS_ID || "1");

const RECONNECT_INTERVAL = 8000; // ms
const SIM_PULSE_ON = 800;        // ms
const SIM_PULSE_OFF = 2500;      // ms

// ================== INTERNAL STATE ==================
const client = new ModbusRTU();

const state = {
    mode: "SIM", // SIM | REAL
    status: "INIT", // INIT | CONNECTING | CONNECTED | DISCONNECTED
    lastError: null,
    lastSuccessRead: null,
};

// ================== SIMULATION STATE ==================
let simPulse = false;
let nextSimToggle = Date.now();

// ================== INIT ==================
function initHardware() {
    if (!MODBUS_PORT || MODBUS_PORT === "SIM") {
        state.mode = "SIM";
        state.status = "CONNECTED";
        console.log("🧪 Hardware Mode: SIMULATION");
        return;
    }

    state.mode = "REAL";
    console.log("🔌 Hardware Mode: REAL");
    startReconnectLoop();
}

// ================== RECONNECT LOOP ==================
function startReconnectLoop() {
    setInterval(async () => {
        if (state.status === "CONNECTED") return;

        try {
            state.status = "CONNECTING";
            console.log(`🔄 Connecting to Modbus (${MODBUS_PORT})...`);

            await client.connectRTUBuffered(MODBUS_PORT, {
                baudRate: MODBUS_BAUD,
            });

            client.setID(MODBUS_ID);
            client.setTimeout(1000);

            state.status = "CONNECTED";
            state.lastError = null;

            console.log("✅ Modbus CONNECTED");

        } catch (err) {
            state.status = "DISCONNECTED";
            state.lastError = err.message;
            console.warn("⚠️ Modbus connect failed, retrying...");
        }
    }, RECONNECT_INTERVAL);
}

// ================== READ INPUTS ==================
async function readInputs() {
    // ---------- SIMULATION ----------
    if (state.mode === "SIM") {
        const now = Date.now();
        if (now >= nextSimToggle) {
            simPulse = !simPulse;
            nextSimToggle = now + (simPulse ? SIM_PULSE_ON : SIM_PULSE_OFF);
        }

        // INPUT MAP (8 bit)
        // [0] Joint sensor (pulse)
        // [7] Machine power (always ON in SIM)
        return [
            simPulse, // 0
            false,    // 1
            false,    // 2
            false,    // 3
            false,    // 4
            false,    // 5
            false,    // 6
            true      // 7 (power ON)
        ];
    }

    // ---------- REAL HARDWARE ----------
    try {
        if (!client.isOpen || state.status !== "CONNECTED") {
            state.status = "DISCONNECTED";
            return null;
        }

        const res = await client.readDiscreteInputs(0, 8);
        state.lastSuccessRead = Date.now();
        return res.data;

    } catch (err) {
        state.status = "DISCONNECTED";
        state.lastError = err.message;
        console.error("❌ Modbus read error");
        return null;
    }
}

// ================== EXPORT ==================
module.exports = {
    initHardware,
    readInputs,
    hardwareState: state,
};
