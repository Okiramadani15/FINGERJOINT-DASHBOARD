const socket = io();
let barChart;

function initBarChart() {
    const ctx = document.getElementById('barChart');
    barChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23'],
            datasets: [
                { label: 'Machine', data: Array(17).fill(0), backgroundColor: '#124170', borderRadius: 6, barPercentage: 0.9, categoryPercentage: 0.9 },
                { label: 'Tally', data: Array(17).fill(0), backgroundColor: '#10b981', borderRadius: 6, barPercentage: 0.9, categoryPercentage: 0.9 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: { display: true, text: 'Jam Operasional (07–23)', color: '#64748b', font: { weight: 'bold' } },
                    grid: { display: false },
                    ticks: { color: '#64748b' }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Produksi per Jam (m³)', color: '#64748b', font: { weight: 'bold' } },
                    grid: { color: '#eef2f7' },
                    ticks: { color: '#64748b' }
                }
            },
            plugins: { legend: { display: false } }
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

    if (Array.isArray(d.downtimeLogs)) {
        const totalMin = d.downtimeLogs.reduce((a, it) => a + Math.round((Number(it.duration_sec || 0)) / 60), 0);
        document.getElementById('dt-total').innerText = totalMin + 'm';
        document.getElementById('dt-count').innerText = d.downtimeLogs.length;
        const tbody = document.getElementById('downtime-body');
        if (d.downtimeLogs.length === 0) {
            tbody.innerHTML = '<tr><td class="py-1 text-[10px] font-black uppercase text-slate-900 italic">No Incident</td><td class="py-1 text-right text-[10px] font-black text-emerald-500">-</td></tr>';
        } else {
            const rows = d.downtimeLogs.map(item => {
                const st = new Date(item.start_time);
                const et = item.end_time ? new Date(item.end_time) : null;
                const startStr = st.toLocaleTimeString('id-ID', { hour12: false }).slice(0,5);
                const endStr = et ? et.toLocaleTimeString('id-ID', { hour12: false }).slice(0,5) : '--:--';
                const durMin = Math.round((Number(item.duration_sec || 0)) / 60);
                const ongoing = !et;
                const badgeClass = ongoing ? 'text-red-600 border-red-200 bg-red-50' : 'text-slate-900 border-slate-200 bg-slate-50';
                return `
                    <tr>
                        <td class="py-1 text-[10px] font-black text-slate-900 tracking-tight">Start ${startStr} — End ${endStr}</td>
                        <td class="py-1 text-right">
                            <span class="text-[10px] font-black px-1.5 py-0.5 rounded-md border ${badgeClass}">${durMin}m</span>
                        </td>
                    </tr>
                `;
            }).join('');
            tbody.innerHTML = rows;
        }
    }

    // Update Target Gap
    if (d.targetGap) {
        const target = Number(d.targetGap.target_meter) || 0;
        const actual = Number(d.targetGap.actual_meter) || 0;
        const gap = Number(d.targetGap.gap_meter) || 0;
        const rawEff = Number(d.targetGap.achievement_percentage) || 0;
        const efficiency = Math.max(0, Math.min(100, rawEff));

        document.getElementById('target-val').innerText = target.toFixed(1);
        document.getElementById('actual-val').innerText = actual.toFixed(1);
        document.getElementById('sisa-target').innerText = gap.toFixed(1);
        document.getElementById('persen-teks').innerText = efficiency.toFixed(0) + '%';

        const persenTeks = document.getElementById('persen-teks');

        if (efficiency >= 95) {
            document.getElementById('emoji').innerText = '🤩';
            document.getElementById('label-mood').innerText = 'EXCELLENT';
            persenTeks.className = 'font-black text-emerald-500 tracking-tighter text-[5rem] leading-none';
        } else if (efficiency >= 70) {
            document.getElementById('emoji').innerText = '😊';
            document.getElementById('label-mood').innerText = 'ON TRACK';
            persenTeks.className = 'font-black text-blue-600 tracking-tighter text-[5rem] leading-none';
        } else {
            document.getElementById('emoji').innerText = '😟';
            document.getElementById('label-mood').innerText = 'BELOW TARGET';
            persenTeks.className = 'font-black text-red-500 tracking-tighter text-[5rem] leading-none';
        }
        const bar = document.getElementById('target-achievement-bar');
        const label = document.getElementById('target-achievement-label');
        const statusEl = document.getElementById('target-status');
        const card = document.getElementById('card-target');
        const color = efficiency >= 95 ? '#10b981' : efficiency >= 70 ? '#3b82f6' : '#ef4444';
        bar.style.width = efficiency + '%';
        bar.style.backgroundColor = color;
        label.innerText = efficiency.toFixed(0) + '%';
        statusEl.innerText = efficiency >= 95 ? 'EXCELLENT' : efficiency >= 70 ? 'ON TRACK' : 'BELOW TARGET';
        card.style.borderLeftColor = color;
    }

    let knife = Math.max(0, 100 - d.joints);
    if (d.targetGap && d.targetGap.target_joints > 0) {
        const kRaw = 100 - (d.targetGap.actual_joints / d.targetGap.target_joints) * 100;
        knife = Math.max(0, Math.min(100, kRaw));
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
