const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const Setting = require('../models/Setting');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// GET /api/admin/stats
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalVipUsers = await User.countDocuments({
            'vip.isVip': true,
            $or: [
                { 'vip.expiredAt': { $gt: new Date() } },
                { 'vip.expiredAt': null }
            ]
        });
        const totalComments = await Comment.countDocuments();

        res.json({
            success: true,
            data: {
                totalUsers,
                totalVipUsers,
                totalComments
            }
        });
    } catch (err) {
        console.error('Lỗi API/admin/stats:', err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// POST /api/admin/broadcast
router.post('/broadcast', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { title, message } = req.body;
        if (!title || !message) {
            return res.status(400).json({ success: false, message: 'Thiếu tiêu đề hoặc nội dung thông báo' });
        }

        // Lấy tất cả user ID
        const users = await User.find({}, '_id');

        if (users.length === 0) {
            return res.json({ success: true, message: 'Không có người dùng nào để gửi thông báo', count: 0 });
        }

        // Tạo cục notification cho tất cả
        const notificationsToInsert = users.map(u => ({
            recipient: u._id,
            type: 'system',
            title: `Anh Tư💕 ${title.trim()}`,
            body: message.trim(),
            read: false,
            createdAt: new Date()
        }));

        // InsertMany cho nhanh
        await Notification.insertMany(notificationsToInsert);

        res.json({
            success: true,
            message: `Đã gửi thông báo đến ${users.length} người dùng`,
            count: users.length
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server khi gửi thông báo' });
    }
});

// GET /api/admin/public-settings (PUBLIC — không cần đăng nhập)
// Chỉ trả về các setting an toàn cho client kiểm tra Force Update
const PUBLIC_SETTING_KEYS = [
    'minVersion',
    'androidDownloadUrl',
    'iosDownloadUrl',
    'forceUpdateMessage',
];

router.get('/public-settings', async (req, res) => {
    try {
        const settings = await Setting.find({ key: { $in: PUBLIC_SETTING_KEYS } });
        const configMap = {
            // Giá trị mặc định an toàn (không kích hoạt force update)
            minVersion: '1.0.0',
            androidDownloadUrl: '',
            iosDownloadUrl: '',
            forceUpdateMessage: 'Phiên bản mới đã sẵn sàng. Vui lòng cập nhật để tiếp tục sử dụng.',
        };
        settings.forEach(s => {
            configMap[s.key] = s.value;
        });
        res.json({ success: true, data: configMap });
    } catch (err) {
        console.error('Lỗi GET /public-settings:', err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// GET /api/admin/settings
router.get('/settings', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const settings = await Setting.find({});
        // Chuyển array thành object type { [key]: value } cho dễ xài ở frontend
        const configMap = {};
        settings.forEach(s => {
            configMap[s.key] = s.value;
        });
        res.json({ success: true, data: configMap });
    } catch (err) {
        console.error('Lỗi GET /settings:', err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// POST /api/admin/settings
router.post('/settings', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { key, value, description } = req.body;
        if (!key) {
            return res.status(400).json({ success: false, message: 'Thiếu key cấu hình' });
        }

        await Setting.findOneAndUpdate(
            { key },
            { $set: { value, description } },
            { upsert: true, new: true }
        );
        res.json({ success: true, message: 'Lưu cấu hình thành công' });
    } catch (err) {
        console.error('Lỗi POST /settings:', err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

module.exports = router;
