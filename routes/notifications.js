const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const { authMiddleware } = require('../middleware/auth');

// GET /api/notifications — lấy thông báo của user hiện tại
router.get('/', authMiddleware, async (req, res) => {
    try {
        const notifications = await Notification.find({ recipient: req.user.userId })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        const unread = notifications.filter(n => !n.read).length;
        res.json({ success: true, data: notifications, unread });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// PATCH /api/notifications/:id/read — đánh dấu đã đọc
router.patch('/:id/read', authMiddleware, async (req, res) => {
    try {
        await Notification.findOneAndUpdate(
            { _id: req.params.id, recipient: req.user.userId },
            { read: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// PATCH /api/notifications/read-all — đánh dấu tất cả đã đọc
router.patch('/read-all', authMiddleware, async (req, res) => {
    try {
        await Notification.updateMany({ recipient: req.user.userId, read: false }, { read: true });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// GET /api/notifications/unread-count — chỉ lấy số lượng chưa đọc
router.get('/unread-count', authMiddleware, async (req, res) => {
    try {
        const count = await Notification.countDocuments({ recipient: req.user.userId, read: false });
        res.json({ success: true, count });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
