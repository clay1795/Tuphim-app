const mongoose = require('mongoose');

const connect = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            dbName: 'tuphim-mobile',
        });
        console.log('✅ MongoDB Atlas connected:', mongoose.connection.host);
    } catch (err) {
        console.error('❌ MongoDB connection failed:', err.message);
        process.exit(1);
    }
};

mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected. Attempting reconnect...');
});

module.exports = { connect };
