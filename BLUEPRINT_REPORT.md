# 📘 Blueprint & Laporan Teknis: Fingerjoint Kiosk System

## 1. Gambaran Umum Sistem
Sistem ini adalah aplikasi **HMI (Human Machine Interface) Kiosk** berbasis web untuk mesin produksi *Finger Joint*. Aplikasi ini berfungsi untuk memantau kinerja produksi secara *real-time*, menghitung efisiensi (OEE), melacak waktu henti (*downtime*), dan menampilkan visualisasi data kepada operator di lantai produksi.

## 2. Fitur Utama

### A. Monitoring Produksi Real-time
*   **Sensor Integration**: Membaca sinyal sensor fisik dari mesin melalui protokol Modbus RTU.
*   **Live Dashboard**: Menampilkan metrik kunci secara langsung:
    *   **Meter Lari**: Total panjang kayu yang diproduksi.
    *   **Joint Count**: Jumlah sambungan yang dibuat.
    *   **Target vs Aktual**: Perbandingan visual pencapaian terhadap target harian.
    *   **Status Mesin**: Indikator visual (ONLINE/OFFLINE/STOPPED) dan lampu status.

### B. OEE (Overall Equipment Effectiveness) Engine
*   Sistem menghitung efisiensi mesin secara otomatis berdasarkan standar industri:
    *   **Availability**: Ketersediaan mesin dikurangi waktu *downtime*.
    *   **Performance**: Kecepatan produksi aktual dibanding target ideal.
    *   **Quality**: Rasio produk bagus (saat ini diset default 100% menunggu sensor kualitas).
    *   **Skor OEE**: Nilai gabungan (A x P x Q) yang memberikan gambaran kesehatan produksi.

### C. Manajemen Shift Otomatis
*   Sistem secara otomatis mendeteksi shift kerja berdasarkan jam operasional:
    *   **Shift 1 (Pagi)**: 07:00 - 15:00
    *   **Shift 2 (Sore)**: 15:00 - 23:00
    *   **Standby/Malam**: 23:00 - 07:00 (Produksi tidak dicatat sebagai shift aktif).

### D. Downtime Tracking
*   **Deteksi Otomatis**: Jika mesin mati (power off) lebih dari 60 detik, sistem otomatis mencatatnya sebagai *downtime*.
*   **Logging Durasi**: Mencatat waktu mulai dan selesai *downtime* ke database untuk analisis kehilangan waktu produksi.

### E. Keamanan & Manajemen Data
*   **Supervisor Reset**: Fitur reset data harian yang dilindungi PIN.
*   **Data Persistence**: Data produksi disimpan aman di database PostgreSQL, tahan terhadap mati listrik atau *restart* aplikasi.

## 3. Pembaruan Fitur & Optimasi Terkini (Technical Improvements)

Berikut adalah daftar perbaikan teknis yang baru saja diimplementasikan untuk meningkatkan stabilitas dan keandalan sistem:

| Fitur / Modul | Status Sebelumnya | Pembaruan / Status Baru | Manfaat |
| :--- | :--- | :--- | :--- |
| **Sensor Loop** | Polling 1 detik, query DB berat. | **Polling 500ms**, query ringan. | Respons sensor lebih cepat, beban server turun drastis. |
| **Debouncing** | Tidak ada, rentan *double count*. | **Software Debounce (2000ms)**. | Data produksi lebih akurat, bebas dari *glitch* sensor. |
| **Keamanan Reset** | Validasi PIN di Frontend (tidak aman). | **Validasi PIN di Backend**. | PIN tidak bisa diintip lewat "Inspect Element" browser. |
| **Error Handling** | Hanya `console.log`. | **Winston Logger** (File & Console). | Riwayat error tersimpan rapi untuk audit & debugging. |
| **Kalkulasi OEE** | 4x query DB terpisah per siklus. | **1x Query Efisien (CTE)**. | Beban database berkurang signifikan, kalkulasi lebih cepat. |
| **Akurasi OEE** | Kalkulasi berbasis harian. | **Kalkulasi berbasis Shift**. | Data OEE kini 100% akurat sesuai shift yang berjalan. |
| **Logika Standby**| Menampilkan data shift terakhir. | **Emit Status "Standby"**. | HMI secara eksplisit menampilkan status standby, tidak ada data usang. |
| **Database** | Query OEE salah tabel. | **Fixed Query Logic**. | Data downtime kini terbaca dengan benar oleh engine OEE. |

## 4. Struktur Kode & Teknologi

*   **Backend**: Node.js dengan Express & Socket.io (Real-time communication).
*   **Database**: PostgreSQL (Relational DB untuk integritas data).
*   **Frontend**: HTML/CSS/JS Native (Ringan, performa tinggi untuk Kiosk).
*   **Hardware Interface**: `modbus-serial` dengan lapisan abstraksi (mendukung mode Simulasi & Real).

### Struktur Direktori Penting
*   [src/app.js](file:///Users/mac/Desktop/Fingerjoint_Project/src/app.js): Pusat logika aplikasi dan *event loop*.
*   [src/services/oeeEngine.js](file:///Users/mac/Desktop/Fingerjoint_Project/src/services/oeeEngine.js): Logika perhitungan efisiensi.
*   [src/utils/logger.js](file:///Users/mac/Desktop/Fingerjoint_Project/src/utils/logger.js): Sistem pencatatan log error terpusat.
*   [src/hardware.js](file:///Users/mac/Desktop/Fingerjoint_Project/src/hardware.js): Driver komunikasi ke PLC/Sensor.

## 5. Rekomendasi Pengembangan (Roadmap)
Untuk fase selanjutnya, disarankan untuk:
1.  **Implementasi Unit Testing**: Menggunakan Jest untuk memastikan logika bisnis tetap benar saat ada perubahan kode.
2.  **Dashboard Analytics**: Menambahkan halaman *history* untuk melihat tren produksi mingguan/bulanan.
3.  **User Management**: Menambahkan login bertingkat (Operator, Supervisor, Manager).
