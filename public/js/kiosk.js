let barChart;
const socket = io();
let clickCount = 0;
let clickTimer;

// 1. Inisialisasi Chart
function initChart() {
    const ctx = document.getElementById('barChart').getContext('2d');
    barChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00'],
            datasets: [{
                data: [0, 0, 0, 0, 0, 0, 0, 0, 0],
                backgroundColor: '#124170',
                borderRadius: 2,
                barPercentage: 0.7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { color: '#94a3b8', font: { size: 9 } } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10, weight: 'bold' } } }
            }
        }
    });
}

// 2. Fullscreen Toggle
function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => console.log(err.message));
    }
}

// 3. Hidden Reset Logic (Klik Logo 5x)
function handleSecretReset(event) {
    event.stopPropagation(); // Agar tidak mentrigger fullscreen toggle
    clickCount++;
    clearTimeout(clickTimer);
    
    if (clickCount >= 5) {
        const pin = prompt("Enter Supervisor PIN to RESET:");
        if (pin === "1234") {
            if (confirm("Reset SEMUA data produksi hari ini menjadi 0?")) {
                socket.emit('requestReset');
            }
        }
        clickCount = 0;
    }
    clickTimer = setTimeout(() => { clickCount = 0; }, 2000);
}

// 4. Socket Listeners
socket.on('productionUpdate', (data) => {
    const hasil = parseFloat(data.current) || 0;
    const target = data.target || 1500;
    const joints = parseInt(data.joints) || 0;
    const persen = Math.min((hasil / target) * 100, 100);

    document.getElementById('meter-lari').innerText = hasil.toFixed(1);
    document.getElementById('persen-teks').innerText = Math.round(persen) + '%';
    document.getElementById('sisa-target').innerText = Math.max(target - hasil, 0).toFixed(0);
    document.getElementById('target-val').innerText = target;
    document.getElementById('joints').innerText = joints;

    if (barChart && data.trend) {
        barChart.data.labels = data.labels || barChart.data.labels;
        barChart.data.datasets[0].data = data.trend;
        barChart.update();
    }

    if (data.shift) {
        document.getElementById('shift-num').innerText = data.shift.shift;
        document.getElementById('shift-name').innerText = `(${data.shift.name})`;
        const stMesin = document.getElementById('status-mesin');
        const stLight = document.getElementById('status-light');
        if (data.shift.isOperational) {
            stMesin.innerText = "RUNNING"; stMesin.className = "text-4xl font-black text-emerald-400 tracking-tighter";
            stLight.className = "w-2 h-2 bg-emerald-500 rounded-full mb-4 animate-pulse";
        } else {
            stMesin.innerText = "STANDBY"; stMesin.className = "text-4xl font-black text-slate-600 tracking-tighter";
            stLight.className = "w-2 h-2 bg-slate-600 rounded-full mb-4";
        }
    }

    const lifePisau = Math.max(0, ((5000 - joints) / 5000) * 100);
    document.getElementById('bar-pisau').style.width = lifePisau + '%';
    document.getElementById('label-pisau').innerText = Math.round(lifePisau) + '%';
    const em = document.getElementById('emoji'); const lb = document.getElementById('label-mood');
    if (persen < 40) { em.innerText = '😐'; lb.innerText = 'Need Focus'; }
    else if (persen < 90) { em.innerText = '😊'; lb.innerText = 'Good Progress'; }
    else { em.innerText = '🤩'; lb.innerText = 'Outstanding'; }
});

socket.on('sensorStatus', (status) => {
    const stMesin = document.getElementById('status-mesin');
    const stLight = document.getElementById('status-light');
    const stCard = document.getElementById('status-card');

    if (status === 'disconnected') {
        stMesin.innerText = "OFFLINE";
        stMesin.className = "text-4xl font-black text-red-500 tracking-tighter";
        stLight.className = "w-2 h-2 bg-red-600 rounded-full mb-4 animate-ping";
        stCard.className = "bg-slate-900 p-6 flex flex-col items-center justify-center rounded-lg border-2 border-red-500/50";
    } else {
        stCard.className = "bg-slate-900 p-6 flex flex-col items-center justify-center rounded-lg border-none";
    }
});

socket.on('resetDone', () => {
    alert("Database & Counter berhasil di-reset ke 0.");
    location.reload();
});

setInterval(() => {
    document.getElementById('jam').innerText = new Date().toLocaleTimeString('id-ID', { hour12: false }).replace(/:/g, '.');
}, 1000);

window.onload = initChart;