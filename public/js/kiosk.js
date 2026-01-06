// 


let barChart;
const socket = io();
let clickCount = 0;
let clickTimer;

/**
 * 1. Inisialisasi Chart Produksi
 * Desain batang dibuat rapat (industrial look) agar tren per jam terlihat solid.
 */
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
                    barPercentage: 1.0,      
                    categoryPercentage: 1.0, 
                    borderWidth: 0.5,        
                    borderColor: '#ffffff'   
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
                    ticks: { color: '#94a3b8', font: { size: 10, weight: 'bold' } } 
                },
                x: { 
                    grid: { display: false }, 
                    offset: true,
                    ticks: { 
                        color: '#334155', 
                        font: { size: 11, weight: 'bold' },
                        maxRotation: 0,
                        autoSkip: false
                    } 
                }
            }
        }
    });
}

/**
 * 2. Update Jam & Tanggal Kiosk
 */
function updateTime() {
    const now = new Date();
    // Format jam dengan titik sesuai permintaan tampilan (HH.mm.ss)
    document.getElementById('jam').innerText = now.toLocaleTimeString('id-ID', { hour12: false }).replace(/:/g, '.');
    
    const options = { weekday: 'long', year: 'numeric', month: 'short', day: '2-digit' };
    const dateEl = document.getElementById('tanggal-hari-ini');
    if (dateEl) {
        dateEl.innerText = now.toLocaleDateString('id-ID', options).toUpperCase();
    }
}

/**
 * 3. Receive Data Update dari Server
 */
socket.on('productionUpdate', (data) => {
    const actual = parseFloat(data.current) || 0;
    const target = data.target || 1500;
    const efficiency = data.efficiency || Math.round((actual / target) * 100);

    // Update Angka Produksi & Satuan m³
    document.getElementById('meter-lari').innerText = actual.toFixed(1);
    document.getElementById('persen-teks').innerText = efficiency + '%';
    document.getElementById('target-val').innerText = target; // Target harian
    
    // Perbaikan sisa target agar tidak desimal terlalu panjang jika ribuan
    const sisa = Math.max(target - actual, 0);
    document.getElementById('sisa-target').innerText = sisa > 999 ? Math.round(sisa) : sisa.toFixed(0);
    
    document.getElementById('joints').innerText = data.joints;

    // Update Chart
    if (barChart && data.trendMesin) {
        barChart.data.datasets[0].data = data.trendMesin;
        barChart.data.datasets[1].data = data.trendTally;
        barChart.update();
    }

    // Smart Logic: Emoji & Mood Warna (ClassName disesuaikan agar font-size dikontrol CSS clamp)
    const em = document.getElementById('emoji'); 
    const lb = document.getElementById('label-mood');
    const pct = document.getElementById('persen-teks');

    if (efficiency < 40) { 
        em.innerText = '😐'; lb.innerText = 'NEED FOCUS'; 
        pct.className = "font-black text-red-500 tracking-tighter leading-none";
    } else if (efficiency < 90) { 
        em.innerText = '😊'; lb.innerText = 'GOOD PROGRESS'; 
        pct.className = "font-black text-emerald-500 tracking-tighter leading-none";
    } else { 
        em.innerText = '🤩'; lb.innerText = 'OUTSTANDING'; 
        pct.className = "font-black text-blue-600 tracking-tighter leading-none";
    }

    // Knife Sharpness Logic (Reset per 5000 joints)
    const lifePisau = Math.max(0, ((5000 - data.joints) / 5000) * 100);
    const barPisau = document.getElementById('bar-pisau');
    if (barPisau) {
        barPisau.style.width = lifePisau + '%';
        // Berubah merah jika pisau tumpul (< 20%)
        barPisau.className = lifePisau < 20 ? "bg-red-500 h-full transition-all duration-700" : "bg-emerald-500 h-full transition-all duration-700";
    }
    document.getElementById('label-pisau').innerText = Math.round(lifePisau) + '%';

    // Status Shift & Mesin
    if (data.shift) {
        document.getElementById('shift-num').innerText = data.shift.shift || "-";
        document.getElementById('shift-name').innerText = `(${data.shift.name || "OFF"})`;

        const stMesin = document.getElementById('status-mesin');
        const stLight = document.getElementById('status-light');
        const stCard = document.getElementById('status-card');
        
        if (data.shift.isOperational) {
            stMesin.innerText = "RUNNING"; 
            stMesin.className = "text-5xl font-black text-emerald-400 uppercase tracking-tighter italic running-glow";
            stLight.className = "absolute top-4 right-4 w-3 h-3 bg-emerald-400 rounded-full shadow-[0_0_15px_#10b981] animate-pulse";
            stCard.classList.add('status-running'); 
            stCard.style.backgroundColor = "#0f172a";
            document.body.style.border = "none";
        } else {
            stMesin.innerText = "STANDBY"; 
            stMesin.className = "text-5xl font-black text-slate-500 uppercase tracking-tighter italic";
            stLight.className = "absolute top-4 right-4 w-3 h-3 bg-slate-700 rounded-full";
            stCard.classList.remove('status-running');
            stCard.style.backgroundColor = "#1e293b";
        }
    }
});

/**
 * 4. Koneksi Hardware Status
 */
socket.on('sensorStatus', (status) => {
    const stMesin = document.getElementById('status-mesin');
    const stLight = document.getElementById('status-light');
    
    if (status === 'disconnected') {
        stMesin.innerText = "OFFLINE";
        stMesin.className = "text-5xl font-black text-red-500 animate-pulse";
        stLight.className = "absolute top-4 right-4 w-3 h-3 bg-red-600 rounded-full animate-ping";
        document.body.style.border = "10px solid #ef4444"; // Flash Alert
    }
});

/**
 * 5. Secret Reset Handler (5x Clicks pada Logo)
 */
function handleSecretReset(event) {
    event.stopPropagation();
    clickCount++;
    clearTimeout(clickTimer);
    
    if (clickCount >= 5) {
        const pin = prompt("ENTER SUPERVISOR PIN TO RESET ALL DATA:");
        if (pin === "1234") { 
            if (confirm("⚠️ PERINGATAN: Hapus semua data produksi hari ini?")) {
                socket.emit('requestReset');
            }
        } else if (pin !== null) {
            alert("WRONG PIN!");
        }
        clickCount = 0;
    }
    clickTimer = setTimeout(() => { clickCount = 0; }, 2000);
}

/**
 * 6. Kiosk Optimization
 */
function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(err => {
            console.warn("Fullscreen blocked or not supported.");
        });
    }
}

socket.on('resetDone', () => {
    location.reload();
});

// Jalankan saat startup
window.onload = () => {
    initChart();
    updateTime();
    setInterval(updateTime, 1000);
};