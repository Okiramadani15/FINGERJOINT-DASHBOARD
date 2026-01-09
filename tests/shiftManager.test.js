const { getShiftInfo } = require('../src/utils/shiftManager');

describe('Shift Manager Logic', () => {
    
    // Helper to mock time
    const setTime = (hour) => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2024, 0, 1, hour, 0, 0)); // Jan 1 2024, HH:00:00
    };

    afterEach(() => {
        jest.useRealTimers();
    });

    test('Should return Shift 1 (Morning) between 07:00 and 15:00', () => {
        setTime(8); // 08:00
        const result = getShiftInfo();
        expect(result.shift).toBe('1');
        expect(result.name).toBe('Pagi');
        expect(result.isOperational).toBe(true);
    });

    test('Should return Shift 2 (Afternoon) between 15:00 and 23:00', () => {
        setTime(16); // 16:00
        const result = getShiftInfo();
        expect(result.shift).toBe('2');
        expect(result.name).toBe('Sore');
        expect(result.isOperational).toBe(true);
    });

    test('Should return Standby (Night) between 23:00 and 07:00', () => {
        setTime(23); // 23:00
        let result = getShiftInfo();
        expect(result.shift).toBe('-');
        expect(result.name).toBe('Standby');
        expect(result.isOperational).toBe(false);

        setTime(2); // 02:00
        result = getShiftInfo();
        expect(result.shift).toBe('-');
        expect(result.isOperational).toBe(false);
    });
});
