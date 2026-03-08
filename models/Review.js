const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    slug: { type: String, required: true, index: true },  // movie slug
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    score: { type: Number, required: true, min: 1, max: 10 },
    text: { type: String, maxlength: 500, default: '' },
}, { timestamps: true });

// Mỗi user chỉ review 1 lần / phim
reviewSchema.index({ slug: 1, user: 1 }, { unique: true });

// Index để lấy reviews theo phim nhanh
reviewSchema.index({ slug: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
