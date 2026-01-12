const socket = io();
let barChart;

function initBarChart() {
    const ctx = document.getElementById('barChart');
    barChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23'],
            datasets: [
                { label: 'Machine', data: Array(17).fill(0), backgroundColor: '#124170' },
                { label: 'Tally', data: Array(17).fill(0), backgroundColor: '#10b981' }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } }
        }
    });
}

socket.on('productionUpdate', d => {
    if (typeof d.current === 'number') {
        document.getElementById('meter-lari').innerText = d.current.toFixed(1);
    }
    if (d.targetGap && typeof d.targetGap.actual_joints === 'number') {
        document.getElementById('joints').innerText = d.targetGap.actual_joints;
        document.getElementById('joints-target').innerText = d.targetGap.target_joints || 0;
    } else {
        document.getElementById('joints').innerText = d.joints;
    }

    // Update tanggal dan shift
    if (d.tanggal) {
        document.getElementById('tanggal-hari-ini').innerText = d.tanggal;
    }
    if (d.shift && d.shiftName) {
        document.getElementById('shift-num').innerText = d.shift;
        document.getElementById('shift-name').innerText = '(' + d.shiftName + ')';
    }

    // Update Target Gap
    if (d.targetGap) {
        document.getElementById('target-val').innerText = d.targetGap.target_meter.toFixed(1);
        document.getElementById('actual-val').innerText = d.targetGap.actual_meter.toFixed(1);
        document.getElementById('sisa-target').innerText = d.targetGap.gap_meter.toFixed(1);
        document.getElementById('persen-teks').innerText = d.targetGap.achievement_percentage.toFixed(0) + '%';

        const efficiency = d.targetGap.achievement_percentage;
        const persenTeks = document.getElementById('persen-teks');

        if (efficiency >= 100) {
            document.getElementById('emoji').innerText = '🤩';
            document.getElementById('label-mood').innerText = 'EXCELLENT';
            persenTeks.className = 'font-black text-emerald-500 tracking-tighter';
        } else if (efficiency >= 85) {
            document.getElementById('emoji').innerText = '😊';
            document.getElementById('label-mood').innerText = 'GOOD';
            persenTeks.className = 'font-black text-yellow-500 tracking-tighter';
        } else {
            document.getElementById('emoji').innerText = '😟';
            document.getElementById('label-mood').innerText = 'BELOW TARGET';
            persenTeks.className = 'font-black text-red-500 tracking-tighter';
        }
    }

    let knife = Math.max(0, 100 - d.joints / 50);
    if (d.targetGap && d.targetGap.target_joints > 0) {
        knife = Math.max(0, 100 - (d.targetGap.actual_joints / d.targetGap.target_joints) * 100);
    }
    document.getElementById('label-pisau').innerText = knife.toFixed(0) + '%';
    document.getElementById('bar-pisau').style.width = knife + '%';

    barChart.data.datasets[0].data = d.trendMachine;
    barChart.data.datasets[1].data = d.trendTally;
    barChart.update('none');
});

socket.on('statusUpdate', (status) => {
    if (!status.isOperational) {
        document.getElementById('meter-lari').innerText = '0.0';
        document.getElementById('joints').innerText = '0';
        document.getElementById('persen-teks').innerText = '0%';
        document.getElementById('label-pisau').innerText = '100%';
        document.getElementById('bar-pisau').style.width = '100%';
        document.getElementById('emoji').innerText = '😴';
        document.getElementById('label-mood').innerText = 'STANDBY';
        
        document.getElementById('oee-total').innerText = '0%';
        document.getElementById('oee-a').innerText = '0%';
        document.getElementById('oee-p').innerText = '0%';
        document.getElementById('oee-q').innerText = '0%';

        barChart.data.datasets[0].data = Array(17).fill(0);
        barChart.data.datasets[1].data = Array(17).fill(0);
        barChart.update('none');
    }
});

socket.on('oeeUpdate', o => {
    document.getElementById('oee-total').innerText = o.OEE + '%';
    document.getElementById('oee-a').innerText = o.A + '%';
    document.getElementById('oee-p').innerText = o.P + '%';
    document.getElementById('oee-q').innerText = o.Q + '%';
});

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        if (document.exitFullscreen) {
            document.exitFullscreen();
        }
    }
}

async function handleSecretReset(event) {
    event.stopPropagation(); // Mencegah bubble event ke listener fullscreen
    const password = prompt("Masukkan kata sandi untuk mereset data produksi hari ini:", "");

    if (password) {
        try {
            const response = await fetch('/reset-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password })
            });

            const result = await response.json();

            if (response.ok) {
                alert('Sukses! ' + result.message);
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            alert('Gagal mereset data: ' + error.message);
        }
    }
}

window.onload = () => {
    initBarChart();
    setInterval(() => {
        document.getElementById('jam').innerText =
            new Date().toLocaleTimeString('id-ID',{hour12:false}).replace(/:/g,'.');
    }, 1000);
};
