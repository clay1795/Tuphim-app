/**
 * routes/movies.js
 * API endpoints cho Review phim
 * GET /api/movies/:slug/reviews       — lấy danh sách reviews + điểm TB
 * POST /api/movies/:slug/review       — tạo/cập nhật review (yêu cầu đăng nhập)
 * DELETE /api/movies/:slug/review     — xóa review của mình
 */

const router = require('express').Router();
const Review = require('../models/Review');
const { authMiddleware } = require('../middleware/auth');

// ── GET /api/movies/:slug/reviews ──────────────────────────────────────────────
router.get('/:slug/reviews', async (req, res) => {
    try {
        const { slug } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const [reviews, total, aggResult] = await Promise.all([
            Review.find({ slug })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .populate('user', 'username fullName avatar'),
            Review.countDocuments({ slug }),
            Review.aggregate([
                { $match: { slug } },
                { $group: { _id: null, avg: { $avg: '$score' } } },
            ]),
        ]);

        const avgScore = aggResult.length > 0 ? Math.round(aggResult[0].avg * 10) / 10 : null;

        res.json({
            success: true,
            data: reviews,
            total,
            avgScore,
            page: Number(page),
        });
    } catch (err) {
        console.error('GET reviews error:', err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ── POST /api/movies/:slug/review ──────────────────────────────────────────────
// Tạo mới hoặc cập nhật review (upsert)
router.post('/:slug/review', authMiddleware, async (req, res) => {
    try {
        const { slug } = req.params;
        const { score, text = '' } = req.body;

        if (!score || score < 1 || score > 10) {
            return res.status(400).json({ success: false, message: 'Điểm phải từ 1 đến 10' });
        }

        const review = await Review.findOneAndUpdate(
            { slug, user: req.user._id },
            {
                slug,
                user: req.user._id,
                score: Number(score),
                text: text.trim().slice(0, 500),
            },
            { upsert: true, new: true, runValidators: true }
        );

        await review.populate('user', 'username fullName avatar');

        res.json({ success: true, data: review, message: 'Đánh giá đã được lưu' });
    } catch (err) {
        console.error('POST review error:', err);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

// ── DELETE /api/movies/:slug/review ───────────────────────────────────────────
router.delete('/:slug/review', authMiddleware, async (req, res) => {
    try {
        const { slug } = req.params;
        const deleted = await Review.findOneAndDelete({ slug, user: req.user._id });
        if (!deleted) return res.status(404).json({ success: false, message: 'Không tìm thấy đánh giá' });
        res.json({ success: true, message: 'Đã xóa đánh giá' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

module.exports = router;
