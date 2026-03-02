const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// ── Helpers ──────────────────────────────────────────────────────────────────
const generateToken = (user) => {
    const isVip = user.vip?.isVip === true &&
        (!user.vip.expiredAt || new Date(user.vip.expiredAt) > new Date());

    return jwt.sign(
        {
            userId: user._id,
            email: user.email,
            username: user.username,
            role: user.role,
            isVip,
            vipExpiredAt: user.vip?.expiredAt || null,
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
};

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const first = errors.array()[0];
        return res.status(400).json({ success: false, message: first.msg, field: first.path });
    }
    next();
};

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', [
    body('email').isEmail().withMessage('Email không hợp lệ').normalizeEmail(),
    body('username').isLength({ min: 3, max: 30 }).withMessage('Username từ 3-30 ký tự')
        .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username chỉ chứa chữ, số, dấu _'),
    body('fullName').isLength({ min: 2, max: 50 }).withMessage('Tên từ 2-50 ký tự').trim(),
    body('password').isLength({ min: 6 }).withMessage('Mật khẩu tối thiểu 6 ký tự')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Mật khẩu cần có chữ hoa, chữ thường và số'),
], validate, async (req, res) => {
    try {
        const { email, username, fullName, password } = req.body;

        // Check duplicate
        const existing = await User.findByIdentifier(email);
        const existingUsername = await User.findByIdentifier(username);
        if (existing || existingUsername) {
            return res.status(409).json({ success: false, message: 'Email hoặc username đã tồn tại' });
        }

        // Tặng 30 ngày VIP cho tài khoản mới
        const vipExpiredAt = new Date();
        vipExpiredAt.setDate(vipExpiredAt.getDate() + 30);

        const user = await User.create({
            email, username, fullName, password,
            vip: {
                isVip: true,
                plan: 'monthly',
                expiredAt: vipExpiredAt,
                grantedAt: new Date()
            }
        });

        // Bắn thông báo chào mừng
        await Notification.create({
            recipient: user._id,
            type: 'system',
            title: '[Anh Tư] Chào mừng! 🎉',
            body: 'Tài khoản mới của bạn đã được nhận thưởng 1 tháng VIP miễn phí. Chúc bạn xem phim vui vẻ!',
            read: false,
        });

        const token = generateToken(user);

        res.status(201).json({
            success: true,
            message: 'Đăng ký thành công và nhận thưởng 1 tháng VIP',
            data: { user: user.getPublicProfile(), token },
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Đăng ký thất bại, thử lại sau' });
    }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', [
    body('identifier').notEmpty().withMessage('Email hoặc username là bắt buộc').trim(),
    body('password').notEmpty().withMessage('Mật khẩu là bắt buộc'),
], validate, async (req, res) => {
    try {
        const { identifier, password } = req.body;
        const user = await User.findByIdentifier(identifier);

        if (!user || !user.isActive) {
            return res.status(401).json({ success: false, message: 'Email/username hoặc mật khẩu không đúng' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Email/username hoặc mật khẩu không đúng' });
        }

        user.lastLogin = new Date();
        await user.save();

        const token = generateToken(user);
        res.json({
            success: true,
            message: 'Đăng nhập thành công',
            data: { user: user.getPublicProfile(), token },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Đăng nhập thất bại, thử lại sau' });
    }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });

        res.json({ success: true, data: { user: user.getPublicProfile() } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', authMiddleware, (req, res) => {
    // JWT is stateless — client drops the token.
    res.json({ success: true, message: 'Đăng xuất thành công' });
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user || !user.isActive) {
            return res.status(401).json({ success: false, message: 'Tài khoản không còn hợp lệ' });
        }
        const token = generateToken(user);
        res.json({ success: true, data: { token } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ── POST /api/auth/change-password ────────────────────────────────────────────
router.post('/change-password', authMiddleware, [
    body('oldPassword').notEmpty().withMessage('Mật khẩu cũ là bắt buộc'),
    body('newPassword').isLength({ min: 6 }).withMessage('Mật khẩu mới tối thiểu 6 ký tự')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Mật khẩu mới cần chữ hoa, chữ thường và số'),
], validate, async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        const isMatch = await user.comparePassword(req.body.oldPassword);
        if (!isMatch) return res.status(400).json({ success: false, message: 'Mật khẩu cũ không đúng' });

        user.password = req.body.newPassword;
        await user.save();
        res.json({ success: true, message: 'Đổi mật khẩu thành công' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────────
router.post('/reset-password', [
    body('email').isEmail().withMessage('Email không hợp lệ').normalizeEmail(),
    body('username').notEmpty().withMessage('Username là bắt buộc').trim(),
    body('newPassword').isLength({ min: 6 }).withMessage('Mật khẩu mới tối thiểu 6 ký tự')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Mật khẩu mới cần chữ hoa, chữ thường và số'),
], validate, async (req, res) => {
    try {
        const { email, username, newPassword } = req.body;

        // Find user by both email and username exact match
        const user = await User.findOne({ email, username });
        if (!user) {
            return res.status(404).json({ success: false, message: 'Email và Username không khớp với hệ thống' });
        }

        user.password = newPassword;
        await user.save();
        res.json({ success: true, message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại.' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ success: false, message: 'Thao tác thất bại, thử lại sau' });
    }
});

// ── PUT /api/auth/update-info ─────────────────────────────────────────────────
router.put('/update-info', authMiddleware, [
    body('fullName').optional().isLength({ min: 2, max: 50 }).withMessage('Tên từ 2-50 ký tự').trim(),
    body('email').optional().isEmail().withMessage('Email không hợp lệ').normalizeEmail(),
    body('gender').optional().isIn(['Nam', 'Nữ', 'Không xác định']).withMessage('Giới tính không hợp lệ'),
], validate, async (req, res) => {
    try {
        const { fullName, email, gender } = req.body;
        const user = await User.findById(req.user.userId);

        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });

        // If changing email, ensure it's not already taken
        if (email && email !== user.email) {
            const existing = await User.findOne({ email });
            if (existing) return res.status(409).json({ success: false, message: 'Email này đã được sử dụng' });
            user.email = email;
        }

        if (fullName) user.fullName = fullName;
        if (gender) user.gender = gender;

        await user.save();

        // Also need a new token if email changed
        const token = generateToken(user);

        res.json({
            success: true,
            message: 'Cập nhật thông tin thành công',
            data: { user: user.getPublicProfile(), token }
        });
    } catch (err) {
        console.error('Update info error:', err);
        res.status(500).json({ success: false, message: 'Cập nhật thất bại, thử lại sau' });
    }
});

// ── POST /api/auth/grant-vip (admin only) ─────────────────────────────────────
router.post('/grant-vip', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId, plan = 'monthly', durationDays = 30 } = req.body;

        if (!userId) return res.status(400).json({ success: false, message: 'userId là bắt buộc' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });

        const expiredAt = new Date();
        expiredAt.setDate(expiredAt.getDate() + parseInt(durationDays));

        user.vip = { isVip: true, plan, grantedAt: new Date(), expiredAt };
        await user.save();

        console.log(`VIP granted: ${user.email} | ${plan} | expires ${expiredAt.toISOString()}`);

        res.json({
            success: true,
            message: `Đã cấp VIP (${plan}, ${durationDays} ngày)`,
            data: { userId: user._id, email: user.email, vip: user.vip },
        });
    } catch (err) {
        console.error('Grant VIP error:', err);
        res.status(500).json({ success: false, message: 'Cấp VIP thất bại' });
    }
});

// ── POST /api/auth/revoke-vip (admin only) ────────────────────────────────────
router.post('/revoke-vip', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, message: 'userId là bắt buộc' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });

        user.vip = { isVip: false, plan: null, grantedAt: null, expiredAt: null };
        await user.save();

        res.json({ success: true, message: 'Đã thu hồi VIP', data: { userId: user._id, email: user.email } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Thu hồi VIP thất bại' });
    }
});

// ── GET /api/auth/lookup?identifier=email_or_username (admin only) ────────────
router.get('/lookup', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { identifier } = req.query;
        if (!identifier) return res.status(400).json({ success: false, message: 'identifier là bắt buộc' });

        const user = await User.findByIdentifier(identifier.trim());
        if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng với email/username này' });

        res.json({ success: true, data: { user: user.getPublicProfile() } });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

module.exports = router;

