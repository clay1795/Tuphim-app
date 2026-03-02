const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['reply', 'like', 'system'], default: 'reply' },
    title: { type: String, required: true },
    body: { type: String, required: true },
    fromUser: { type: String }, // username who triggered
    movieSlug: { type: String }, // link back to movie
    commentId: { type: mongoose.Schema.Types.ObjectId },
    read: { type: Boolean, default: false },
}, { timestamps: true });

notificationSchema.index({ recipient: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
