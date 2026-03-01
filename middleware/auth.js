const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Token không hợp lệ hoặc chưa đăng nhập' });
    }
    const token = header.substring(7);
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Token hết hạn hoặc không hợp lệ' });
    }
};

const adminMiddleware = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Yêu cầu quyền Admin' });
    }
    next();
};

module.exports = { authMiddleware, adminMiddleware };
