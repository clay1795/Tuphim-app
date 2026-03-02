const express = require('express');
const router = express.Router();
const Comment = require('../models/Comment');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { authMiddleware } = require('../middleware/auth');

// ── GET /api/comments/:slug ─ lấy bình luận của 1 phim
router.get('/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const [comments, total] = await Promise.all([
            Comment.find({ slug })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Comment.countDocuments({ slug }),
        ]);

        res.json({ success: true, data: comments, total, page, totalPages: Math.ceil(total / limit) });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/comments/:slug ─ thêm bình luận mới (cần đăng nhập)
router.post('/:slug', authMiddleware, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || text.trim().length < 1) return res.status(400).json({ success: false, message: 'Nội dung không được để trống' });
        if (text.length > 500) return res.status(400).json({ success: false, message: 'Bình luận tối đa 500 ký tự' });

        const comment = await Comment.create({
            slug: req.params.slug,
            user: req.user.userId,
            username: req.user.username || 'Người dùng',
            text: text.trim(),
        });

        res.status(201).json({ success: true, data: comment });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/comments/:id/reply ─ trả lời bình luận (cần đăng nhập)
router.post('/:id/reply', authMiddleware, async (req, res) => {
    try {
        const { text } = req.body;
        if (!text || text.trim().length < 1) return res.status(400).json({ success: false, message: 'Nội dung không được để trống' });
        if (text.length > 500) return res.status(400).json({ success: false, message: 'Trả lời tối đa 500 ký tự' });

        let comment = await Comment.findById(req.params.id);
        let originalAuthorId = null;
        let originalAuthorName = null;

        if (comment) {
            originalAuthorId = comment.user?.toString();
            originalAuthorName = comment.username;
        } else {
            comment = await Comment.findOne({ 'replies._id': req.params.id });
            if (comment) {
                const originalReply = comment.replies.id(req.params.id);
                originalAuthorId = originalReply.user?.toString();
                originalAuthorName = originalReply.username;
            }
        }

        if (!comment) return res.status(404).json({ success: false, message: 'Bình luận không tồn tại' });

        comment.replies.push({
            user: req.user.userId,
            username: req.user.username || 'Người dùng',
            text: text.trim(),
        });
        await comment.save();

        // Đẩy thông báo đến người được nhắc tới (mention @username) hoặc người sở hữu
        const replierId = req.user.userId?.toString();
        let recipientId = originalAuthorId;
        let recipientName = originalAuthorName;

        // Extract @username from text (e.g. "@clay hello")
        const mentionMatch = text.match(/^@([a-zA-Z0-9_]+)/);
        if (mentionMatch) {
            const mentionedUsername = mentionMatch[1];
            // Look up the mentioned user
            const mentionedUser = await User.findOne({ username: mentionedUsername }).lean();
            if (mentionedUser) {
                recipientId = mentionedUser._id.toString();
                recipientName = mentionedUser.username;
            }
        }

        if (recipientId && recipientId !== replierId) {
            await Notification.create({
                recipient: recipientId,
                type: 'reply',
                title: `Ôi! ${recipientName ? `Bình luận của ${recipientName}` : 'Bình luận của bạn'} được trả lời`,
                body: `${req.user.username || 'Ai đó'} đã trả lời: "${text.trim().slice(0, 60)}${text.length > 60 ? '...' : ''}"`,
                fromUser: req.user.username,
                movieSlug: comment.slug,
                commentId: comment._id,
            }).catch(() => { }); // silent fail, don’t break reply if noti fails
        }

        res.json({ success: true, data: comment });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── POST /api/comments/:id/like ─ toggle like bình luận
router.post('/:id/like', authMiddleware, async (req, res) => {
    try {
        const uid = req.user.userId;
        let isReplyLike = false;

        let comment = await Comment.findById(req.params.id);
        if (!comment) {
            comment = await Comment.findOne({ 'replies._id': req.params.id });
            if (comment) isReplyLike = true;
        }

        if (!comment) return res.status(404).json({ success: false, message: 'Bình luận không tồn tại' });

        if (isReplyLike) {
            const reply = comment.replies.id(req.params.id);
            const idx = reply.likes.indexOf(uid);
            if (idx === -1) reply.likes.push(uid);
            else reply.likes.splice(idx, 1);
            await comment.save();
            return res.json({ success: true, liked: idx === -1, likes: reply.likes.length });
        } else {
            const idx = comment.likes.indexOf(uid);
            if (idx === -1) comment.likes.push(uid);
            else comment.likes.splice(idx, 1);
            await comment.save();
            return res.json({ success: true, liked: idx === -1, likes: comment.likes.length });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── DELETE /api/comments/:id ─ xóa bình luận (chủ bình luận hoặc admin)
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const comment = await Comment.findById(req.params.id);
        if (!comment) return res.status(404).json({ success: false, message: 'Bình luận không tồn tại' });

        const isOwner = comment.user.toString() === req.user.userId;
        const isAdmin = req.user.role === 'admin';
        if (!isOwner && !isAdmin) return res.status(403).json({ success: false, message: 'Không có quyền xóa bình luận này' });

        await comment.deleteOne();
        res.json({ success: true, message: 'Đã xóa bình luận' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
