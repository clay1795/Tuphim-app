const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    email: {
        type: String, required: true, unique: true,
        lowercase: true, trim: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Email không hợp lệ'],
    },
    password: { type: String, required: true, minlength: 6 },
    username: {
        type: String, required: true, unique: true,
        trim: true, minlength: 3, maxlength: 30,
        match: [/^[a-zA-Z0-9_]+$/, 'Username chỉ được chứa chữ cái, số và dấu _'],
    },
    fullName: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
    avatar: { type: String, default: null },
    gender: { type: String, enum: ['Nam', 'Nữ', 'Không xác định'], default: 'Không xác định' },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    // VIP Membership
    vip: {
        isVip: { type: Boolean, default: false },
        plan: { type: String, enum: ['monthly', 'yearly', null], default: null },
        expiredAt: { type: Date, default: null },
        grantedAt: { type: Date, default: null },
    },

    // Watch History
    watchHistory: [{ type: mongoose.Schema.Types.Mixed }],

    // Account status
    isActive: { type: Boolean, default: true },
    lastLogin: { type: Date },

    // Push Notification Tokens (Expo)
    pushTokens: [{ type: String }],
}, { timestamps: true });

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (err) {
        next(err);
    }
});

// Compare password
userSchema.methods.comparePassword = async function (candidate) {
    return bcrypt.compare(candidate, this.password);
};

// Public profile (no sensitive data)
userSchema.methods.getPublicProfile = function () {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

// Find by email OR username
userSchema.statics.findByIdentifier = function (id) {
    return this.findOne({
        $or: [{ email: id.toLowerCase() }, { username: id }],
    });
};

module.exports = mongoose.model('User', userSchema);
