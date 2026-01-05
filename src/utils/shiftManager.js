const getShiftInfo = () => {
    const now = new Date();
    const hour = now.getHours();

    if (hour >= 7 && hour < 15) {
        return { shift: "1", name: "Pagi", color: "text-emerald-600", status: "Running", isOperational: true };
    } 
    else if (hour >= 15 && hour < 23) {
        return { shift: "2", name: "Sore", color: "text-orange-600", status: "Running", isOperational: true };
    } 
    else {
        return { shift: "-", name: "Standby", color: "text-gray-500", status: "Off", isOperational: false };
    }
};

module.exports = { getShiftInfo };