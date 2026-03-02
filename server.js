require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { connect } = require('./config/database');
const authRoutes = require('./routes/auth');
const commentRoutes = require('./routes/comments');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 3002;

// ── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS — allow Expo Go + Web ────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
    origin: (origin, cb) => {
        // Allow no-origin requests (mobile apps / curl)
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('192.168.')) {
            return cb(null, true);
        }
        cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Rate limiting (100 req / 15 min per IP)
app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Quá nhiều yêu cầu, thử lại sau 15 phút' },
    standardHeaders: true, legacyHeaders: false,
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'TuPhim Mobile Backend is running 🚀',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        version: '1.0.0',
    });
});

// Root
app.get('/', (req, res) => res.json({ name: 'TuPhim Mobile Backend API', version: '1.0.0' }));

// 404
app.use('*', (req, res) => {
    res.status(404).json({ success: false, message: `Endpoint ${req.originalUrl} không tồn tại` });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error:', err);
    res.status(err.status || 500).json({ success: false, message: err.message || 'Lỗi server' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
    await connect();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 TuPhim Mobile Backend running on http://0.0.0.0:${PORT}`);
        console.log(`📱 Mobile endpoint: http://192.168.29.101:${PORT}/api/auth`);
        console.log(`🏥 Health check: http://localhost:${PORT}/api/health\n`);
    });
}

process.on('uncaughtException', err => { console.error('Uncaught:', err); process.exit(1); });
process.on('unhandledRejection', err => { console.error('Unhandled:', err); process.exit(1); });

start();
