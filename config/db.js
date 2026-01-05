const { Pool } = require('pg'); // WAJIB ada ini
require('dotenv').config();

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

pool.on('connect', () => {
    console.log('✅ Database PostgreSQL Terhubung');
});

pool.on('error', (err) => {
    console.error('❌ Error Database:', err.message);
});

module.exports = pool;