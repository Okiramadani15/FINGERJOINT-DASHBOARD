const socket = io();
let barChart;
let clickCount = 0;
let clickTimer;

/* =========================
   CLOCK
========================= */
function updateTime() {
    const now = new Date();
    document.getElementById('jam').innerText =
        now.toLocaleTimeString('id-ID', { hour12:false }).replace(/:/g,'.');

    document.getElementById('tanggal-hari-ini').innerText =
        now.toLocaleDateString('id-ID',{
            weekday:'long', day:'2-digit', month:'short', year:'numeric'
        }).toUpperCase();
}

/* =========================
   CHART
========================= */
function initChart() {
    const ctx = document.getElementById('barChart').getContext('2d');
    
    // Light Theme Colors
    const gridColor = 'rgba(0, 0, 0, 0.05)';
    const textColor = '#64748b';

    barChart = new Chart(ctx,{
        type:'bar',
        data:{
            labels:['07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23'],
            datasets:[
                { 
                    data:Array(17).fill(0), 
                    backgroundColor:'#1e3a8a', // Deep Blue
                    borderRadius: 4,
                    barPercentage: 0.6
                },
                { 
                    data:Array(17).fill(0), 
                    backgroundColor:'#10b981', // Emerald
                    borderRadius: 4,
                    barPercentage: 0.6
                }
            ]
        },
        options:{
            responsive:true,
            maintainAspectRatio:false,
            plugins:{ legend:{ display:false } },
            scales:{ 
                y:{ 
                    beginAtZero:true,
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Roboto Mono' } },
                    border: { display: false }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', weight: 'bold' } },
                    border: { display: false }
                }
            }
        }
    });
}

/* =========================
   SECRET RESET
========================= */
window.handleSecretReset = function(e){
    e.stopPropagation();
    clickCount++;
    clearTimeout(clickTimer);

    if(clickCount>=5){
        const pin = prompt('ENTER SUPERVISOR PIN');
        if(pin && confirm('RESET PRODUKSI HARI INI?')){
            socket.emit('requestReset', pin);
        }
        clickCount=0;
    }
    clickTimer=setTimeout(()=>clickCount=0,2000);
};

// Handle Reset Error
socket.on('resetError', (msg) => {
    alert(`GAGAL: ${msg}`);
});

/* =========================
   PRODUCTION UPDATE
========================= */
socket.on('productionUpdate', d=>{
    if(!d) return;

    document.getElementById('meter-lari').innerText = d.current.toFixed(1);
    document.getElementById('joints').innerText = d.joints;
    document.getElementById('target-val').innerText = d.target;
    document.getElementById('sisa-target').innerText = Math.max(0,d.target-d.current).toFixed(0);

    const eff = Math.min(100,d.efficiency||0);
    document.getElementById('persen-teks').innerText = eff+'%';

    // Emoji & Mood
    const emoji = document.getElementById('emoji');
    const mood = document.getElementById('label-mood');
    if(d.isDowntime){ emoji.innerText='😴'; mood.innerText='STOPPED'; }
    else if(eff>=100){ emoji.innerText='🤩'; mood.innerText='TARGET ACHIEVED'; }
    else if(eff>=70){ emoji.innerText='😊'; mood.innerText='ON TRACK'; }
    else { emoji.innerText='😐'; mood.innerText='NEED ATTENTION'; }

    // Knife Sharpness
    const life = Math.max(0,((5000-d.joints)/5000)*100);
    const barPisau = document.getElementById('bar-pisau');
    barPisau.style.width = life+'%';
    barPisau.className = life<20?"bg-red-500 h-full transition-all duration-700":"bg-emerald-500 h-full transition-all duration-700";
    document.getElementById('label-pisau').innerText = Math.round(life)+'%';

    // Shift
    if(d.shift){
        document.getElementById('shift-num').innerText=d.shift.shift||'-';
        document.getElementById('shift-name').innerText=`(${d.shift.name||'-'})`;
    }

    // Update Chart
    if(barChart){
        barChart.data.datasets[0].data=d.trendMesin;
        barChart.data.datasets[1].data=d.trendTally;
        barChart.update();
    }
});

/* =========================
   OEE UPDATE (A/P/Q & Total)
========================= */
socket.on('oeeUpdate', oee=>{
    const safeOee = {
        A: oee?.A || 0,
        P: oee?.P || 0,
        Q: oee?.Q || 0,
        OEE: oee?.OEE || 0
    };
    document.getElementById('oee-a').innerText = safeOee.A.toFixed(1)+'%';
    document.getElementById('oee-p').innerText = safeOee.P.toFixed(1)+'%';
    document.getElementById('oee-q').innerText = safeOee.Q.toFixed(1)+'%';
    document.getElementById('oee-total').innerText = safeOee.OEE.toFixed(1)+'%';
});

/* =========================
   MACHINE STATUS
========================= */
function updateMachineStatus(online) {
    const statusEl = document.getElementById('status-mesin');
    const lightEl = document.getElementById('status-light');

    // Reset base classes
    statusEl.className = 'status-text text-5xl font-black tracking-tighter uppercase italic z-10 transition-colors duration-300';
    lightEl.className = 'absolute top-4 right-4 w-3 h-3 rounded-full transition-all duration-500';
    
    if (online) {
        statusEl.textContent = 'RUNNING';
        statusEl.classList.add('text-emerald-400', 'glow-text-green');
        
        lightEl.classList.add('bg-emerald-500', 'shadow-[0_0_15px_#10b981]');
    } else {
        statusEl.textContent = 'STOPPED'; 
        statusEl.classList.add('text-slate-600');
        
        lightEl.classList.add('bg-slate-600');
    }
}

/* Sensor connection update */
socket.on('sensorStatus', status => {
    updateMachineStatus(status === 'connected');
});

/* =========================
   RESET DONE
========================= */
socket.on('resetDone',()=>location.reload());

/* =========================
   BOOT
========================= */
window.onload=()=>{
    initChart();
    updateTime();
    setInterval(updateTime,1000);

    // Fullscreen auto (kiosk mode)
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
};
