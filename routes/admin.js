const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// GET /api/admin/stats
router.get('/stats', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalVipUsers = await User.countDocuments({
            isVip: true,
            $or: [
                { vipExpirationDate: { $gt: new Date() } },
                { vipExpirationDate: null }
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
            title: `[Anh Tư] ${title.trim()}`,
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
        console.error('Lỗi API/admin/broadcast:', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi gửi thông báo' });
    }
});

module.exports = router;
