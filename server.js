require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { connect } = require('./config/database');
const authRoutes = require('./routes/auth');
const commentRoutes = require('./routes/comments');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const movieRoutes = require('./routes/movies');
const setupWatchParty = require('./socket/watchParty');

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3002;

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
    cors: {
        origin: (origin, cb) => {
            if (!origin || allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('192.168.')) {
                return cb(null, true);
            }
            cb(new Error('Not allowed by CORS'));
        },
        methods: ['GET', 'POST'],
        credentials: true,
    },
    transports: ['websocket', 'polling'],
});

setupWatchParty(io);

// ── Security ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
    origin: (origin, cb) => {
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
app.use('/api/admin', adminRoutes);
app.use('/api/movies', movieRoutes);

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'TuPhim Mobile Backend is running 🚀',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
        version: '1.0.0',
    });
});

app.get('/', (req, res) => res.json({ name: 'TuPhim Mobile Backend API', version: '1.0.0' }));

app.use('*', (req, res) => {
    res.status(404).json({ success: false, message: `Endpoint ${req.originalUrl} không tồn tại` });
});

app.use((err, req, res, next) => {
    console.error('Global error:', err);
    res.status(err.status || 500).json({ success: false, message: err.message || 'Lỗi server' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
async function start() {
    await connect();
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`\n🚀 TuPhim Mobile Backend running on http://0.0.0.0:${PORT}`);
        console.log(`🎬 Watch Party Socket.io ready`);
        console.log(`🏥 Health check: http://localhost:${PORT}/api/health\n`);
    });
}

process.on('uncaughtException', err => { console.error('Uncaught:', err); process.exit(1); });
process.on('unhandledRejection', err => { console.error('Unhandled:', err); process.exit(1); });

start();
