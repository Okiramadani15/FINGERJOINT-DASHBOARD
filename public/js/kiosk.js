// let barChart;
// const socket = io();
// let clickCount = 0;
// let clickTimer;

// function initChart() {
//     const ctx = document.getElementById('barChart').getContext('2d');
//     barChart = new Chart(ctx, {
//         type: 'bar',
//         data: {
//             labels: ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'],
//             datasets: [
//                 { 
//                     label: 'MESIN (Gross)', 
//                     data: Array(16).fill(0), 
//                     backgroundColor: '#124170', 
//                     borderRadius: 0, 
//                     barPercentage: 1.0,      // Batang memenuhi seluruh lebar kategori
//                     categoryPercentage: 1.0, // Menghilangkan jarak antar grup jam
//                     borderWidth: 0.5,        // Garis tipis untuk pemisah antar batang
//                     borderColor: '#ffffff'   // Warna putih agar terlihat rapi saat berdempetan
//                 },
//                 { 
//                     label: 'TALLY (Nett)', 
//                     data: Array(16).fill(0), 
//                     backgroundColor: '#10b981', 
//                     borderRadius: 0, 
//                     barPercentage: 1.0,
//                     categoryPercentage: 1.0,
//                     borderWidth: 0.5,
//                     borderColor: '#ffffff'
//                 }
//             ]
//         },
//         options: {
//             responsive: true,
//             maintainAspectRatio: false,
//             plugins: { 
//                 legend: { display: false } 
//             },
//             scales: {
//                 y: { 
//                     beginAtZero: true, 
//                     grid: { color: '#f1f5f9' }, 
//                     ticks: { color: '#94a3b8', font: { size: 10 } } 
//                 },
//                 x: { 
//                     grid: { display: false }, 
//                     offset: true, // Menjaga label jam tetap di tengah batang
//                     ticks: { 
//                         color: '#94a3b8', 
//                         font: { size: 11, weight: 'bold' },
//                         maxRotation: 0,
//                         autoSkip: false
//                     } 
//                 }
//             }
//         }
//     });
// }

// function updateTime() {
//     const now = new Date();
//     document.getElementById('jam').innerText = now.toLocaleTimeString('id-ID', { hour12: false }).replace(/:/g, '.');
//     const options = { weekday: 'long', year: 'numeric', month: 'short', day: '2-digit' };
//     if(document.getElementById('tanggal-hari-ini')) {
//         document.getElementById('tanggal-hari-ini').innerText = now.toLocaleDateString('id-ID', options);
//     }
// }

// socket.on('productionUpdate', (data) => {
//     const hasil = parseFloat(data.current) || 0;
//     const target = data.target || 1500;
//     const persen = Math.min((hasil / target) * 100, 100);

//     document.getElementById('meter-lari').innerText = hasil.toFixed(1);
//     document.getElementById('persen-teks').innerText = Math.round(persen) + '%';
//     document.getElementById('target-val').innerText = target;
//     document.getElementById('sisa-target').innerText = Math.max(target - hasil, 0).toFixed(0);
//     document.getElementById('joints').innerText = data.joints;

//     if (barChart && data.trendMesin) {
//         barChart.data.datasets[0].data = data.trendMesin;
//         barChart.data.datasets[1].data = data.trendTally;
//         barChart.update();
//     }

//     const em = document.getElementById('emoji'); 
//     const lb = document.getElementById('label-mood');
//     if (persen < 40) { em.innerText = '😐'; lb.innerText = 'Need Focus'; }
//     else if (persen < 90) { em.innerText = '😊'; lb.innerText = 'Good Progress'; }
//     else { em.innerText = '🤩'; lb.innerText = 'Outstanding'; }

//     const lifePisau = Math.max(0, ((5000 - data.joints) / 5000) * 100);
//     document.getElementById('bar-pisau').style.width = lifePisau + '%';
//     document.getElementById('label-pisau').innerText = Math.round(lifePisau) + '%';

//     if (data.shift) {
//         if(document.getElementById('shift-num')) document.getElementById('shift-num').innerText = data.shift.shift;
//         if(document.getElementById('shift-name')) document.getElementById('shift-name').innerText = `(${data.shift.name})`;

//         const stMesin = document.getElementById('status-mesin');
//         const stLight = document.getElementById('status-light');
        
//         if (data.shift.isOperational) {
//             stMesin.innerText = "RUNNING"; 
//             stMesin.className = "text-4xl font-black text-emerald-400 uppercase tracking-tighter";
//             stLight.className = "w-3 h-3 bg-emerald-500 rounded-full mb-4 animate-pulse shadow-[0_0_10px_#10b981]";
//         } else {
//             stMesin.innerText = "STANDBY"; 
//             stMesin.className = "text-4xl font-black text-slate-600 uppercase tracking-tighter";
//             stLight.className = "w-3 h-3 bg-slate-700 rounded-full mb-4";
//         }
//     }
// });

// socket.on('sensorStatus', (status) => {
//     if (status === 'disconnected') {
//         document.getElementById('status-mesin').innerText = "OFFLINE";
//         document.getElementById('status-mesin').className = "text-4xl font-black text-red-500 animate-pulse";
//         document.getElementById('status-light').className = "w-3 h-3 bg-red-600 rounded-full mb-4 animate-ping";
//     }
// });

// function handleSecretReset(event) {
//     event.stopPropagation();
//     clickCount++;
//     clearTimeout(clickTimer);
//     if (clickCount >= 5) {
//         const pin = prompt("Enter Supervisor PIN to RESET:");
//         if (pin === "1234") {
//             if (confirm("Reset SEMUA data produksi hari ini?")) socket.emit('requestReset');
//         }
//         clickCount = 0;
//     }
//     clickTimer = setTimeout(() => { clickCount = 0; }, 2000);
// }

// function toggleFullScreen() {
//     if (!document.fullscreenElement) {
//         document.documentElement.requestFullscreen().catch(err => console.log(err.message));
//     }
// }

// socket.on('resetDone', () => { location.reload(); });
// setInterval(updateTime, 1000);
// window.onload = initChart;


let barChart;
const socket = io();
let clickCount = 0;
let clickTimer;

function initChart() {
    const ctx = document.getElementById('barChart').getContext('2d');
    barChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'],
            datasets: [
                { 
                    label: 'MESIN (Gross)', 
                    data: Array(16).fill(0), 
                    backgroundColor: '#124170', 
                    borderRadius: 0, 
                    barPercentage: 1.0,      // Batang memenuhi seluruh lebar kategori
                    categoryPercentage: 1.0, // Menghilangkan jarak antar grup jam
                    borderWidth: 0.5,        // Garis tipis untuk pemisah antar batang
                    borderColor: '#ffffff'   // Warna putih agar terlihat rapi saat berdempetan
                },
                { 
                    label: 'TALLY (Nett)', 
                    data: Array(16).fill(0), 
                    backgroundColor: '#10b981', 
                    borderRadius: 0, 
                    barPercentage: 1.0,
                    categoryPercentage: 1.0,
                    borderWidth: 0.5,
                    borderColor: '#ffffff'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false } 
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    grid: { color: '#f1f5f9' }, 
                    ticks: { color: '#94a3b8', font: { size: 10 } } 
                },
                x: { 
                    grid: { display: false }, 
                    offset: true, // Menjaga label jam tetap di tengah batang
                    ticks: { 
                        color: '#94a3b8', 
                        font: { size: 11, weight: 'bold' },
                        maxRotation: 0,
                        autoSkip: false
                    } 
                }
            }
        }
    });
}

function updateTime() {
    const now = new Date();
    document.getElementById('jam').innerText = now.toLocaleTimeString('id-ID', { hour12: false }).replace(/:/g, '.');
    const options = { weekday: 'long', year: 'numeric', month: 'short', day: '2-digit' };
    if(document.getElementById('tanggal-hari-ini')) {
        document.getElementById('tanggal-hari-ini').innerText = now.toLocaleDateString('id-ID', options);
    }
}

socket.on('productionUpdate', (data) => {
    const hasil = parseFloat(data.current) || 0;
    const target = data.target || 1500;
    const persen = Math.min((hasil / target) * 100, 100);

    document.getElementById('meter-lari').innerText = hasil.toFixed(1);
    document.getElementById('persen-teks').innerText = Math.round(persen) + '%';
    document.getElementById('target-val').innerText = target;
    document.getElementById('sisa-target').innerText = Math.max(target - hasil, 0).toFixed(0);
    document.getElementById('joints').innerText = data.joints;

    if (barChart && data.trendMesin) {
        barChart.data.datasets[0].data = data.trendMesin;
        barChart.data.datasets[1].data = data.trendTally;
        barChart.update();
    }

    const em = document.getElementById('emoji'); 
    const lb = document.getElementById('label-mood');
    if (persen < 40) { em.innerText = '😐'; lb.innerText = 'Need Focus'; }
    else if (persen < 90) { em.innerText = '😊'; lb.innerText = 'Good Progress'; }
    else { em.innerText = '🤩'; lb.innerText = 'Outstanding'; }

    const lifePisau = Math.max(0, ((5000 - data.joints) / 5000) * 100);
    document.getElementById('bar-pisau').style.width = lifePisau + '%';
    document.getElementById('label-pisau').innerText = Math.round(lifePisau) + '%';

    if (data.shift) {
        if(document.getElementById('shift-num')) document.getElementById('shift-num').innerText = data.shift.shift;
        if(document.getElementById('shift-name')) document.getElementById('shift-name').innerText = `(${data.shift.name})`;

        const stMesin = document.getElementById('status-mesin');
        const stLight = document.getElementById('status-light');
        
        if (data.shift.isOperational) {
            stMesin.innerText = "RUNNING"; 
            stMesin.className = "text-4xl font-black text-emerald-400 uppercase tracking-tighter";
            stLight.className = "w-3 h-3 bg-emerald-500 rounded-full mb-4 animate-pulse shadow-[0_0_10px_#10b981]";
        } else {
            stMesin.innerText = "STANDBY"; 
            stMesin.className = "text-4xl font-black text-slate-600 uppercase tracking-tighter";
            stLight.className = "w-3 h-3 bg-slate-700 rounded-full mb-4";
        }
    }
});

socket.on('sensorStatus', (status) => {
    if (status === 'disconnected') {
        document.getElementById('status-mesin').innerText = "OFFLINE";
        document.getElementById('status-mesin').className = "text-4xl font-black text-red-500 animate-pulse";
        document.getElementById('status-light').className = "w-3 h-3 bg-red-600 rounded-full mb-4 animate-ping";
    }
});

function handleSecretReset(event) {
    event.stopPropagation();
    clickCount++;
    clearTimeout(clickTimer);
    if (clickCount >= 5) {
        const pin = prompt("Enter Supervisor PIN to RESET:");
        if (pin === "1234") {
            if (confirm("Reset SEMUA data produksi hari ini?")) socket.emit('requestReset');
        }
        clickCount = 0;
    }
    clickTimer = setTimeout(() => { clickCount = 0; }, 2000);
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => console.log(err.message));
    }
}

socket.on('resetDone', () => { location.reload(); });
setInterval(updateTime, 1000);
window.onload = initChart;