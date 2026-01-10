function getShiftInfo(date = new Date()) {
    const hour = date.getHours();

    if (hour >= 7 && hour < 15) {
        return { shift: 1, name: 'Pagi', isOperational: true };
    }
    if (hour >= 15 && hour < 23) {
        return { shift: 2, name: 'Sore', isOperational: true };
    }

    return { shift: '-', name: 'Standby', isOperational: false };
}

module.exports = { getShiftInfo };
