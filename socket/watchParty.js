/**
 * socket/watchParty.js
 * Quản lý phòng xem chung real-time qua Socket.io
 */

const jwt = require('jsonwebtoken');

// Rooms lưu in-memory: { roomCode: { hostSocketId, movie, currentTime, isPlaying, members[], chat[] } }
const rooms = new Map();

function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function getRoomBySocket(socketId) {
    for (const [code, room] of rooms.entries()) {
        if (room.members.some(m => m.socketId === socketId)) {
            return { code, room };
        }
    }
    return null;
}

module.exports = function setupWatchParty(io) {

    // Auth middleware cho socket
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error('Chưa đăng nhập'));
        try {
            socket.user = jwt.verify(token, process.env.JWT_SECRET);
            next();
        } catch {
            next(new Error('Token không hợp lệ'));
        }
    });

    io.on('connection', (socket) => {
        const { userId, username } = socket.user;
        console.log(`[WatchParty] ${username} connected (${socket.id})`);

        // ── TẠO PHÒNG ──────────────────────────────────────────────
        socket.on('create-room', ({ movie }, cb) => {
            let code;
            do { code = generateCode(); } while (rooms.has(code));

            rooms.set(code, {
                hostSocketId: socket.id,
                hostId: userId,
                movie,
                currentTime: 0,
                currentEpisode: null, // Lưu tên tập host đang xem
                isPlaying: false,
                members: [{ userId, username, socketId: socket.id }],
                chat: [],
                createdAt: Date.now(),
                lastActivity: Date.now(),
            });

            socket.join(code);
            console.log(`[WatchParty] ${username} tạo phòng ${code}`);
            cb?.({ success: true, roomCode: code });
        });

        // ── VÀO PHÒNG ──────────────────────────────────────────────
        socket.on('join-room', ({ roomCode }, cb) => {
            const room = rooms.get(roomCode);
            if (!room) return cb?.({ success: false, message: 'Phòng không tồn tại hoặc đã đóng' });

            // Nếu host reconnect trong grace period, hủy timer và tiếp tục
            if (room.hostId === userId && room.hostGraceTimer) {
                clearTimeout(room.hostGraceTimer);
                room.hostGraceTimer = null;
                const m = room.members.find(m => m.userId === userId);
                if (m) m.socketId = socket.id;
                else room.members.push({ userId, username, socketId: socket.id });
                room.hostSocketId = socket.id;
                io.to(roomCode).emit('host-reconnected', { username });
            } else if (!room.members.find(m => m.userId === userId)) {
                room.members.push({ userId, username, socketId: socket.id });
            } else {
                const m = room.members.find(m => m.userId === userId);
                if (m) m.socketId = socket.id;
            }

            socket.join(roomCode);

            // Thông báo cho cả phòng
            io.to(roomCode).emit('member-update', { members: room.members });

            // Trả về state hiện tại để client sync
            cb?.({
                success: true,
                roomCode,
                movie: room.movie,
                currentTime: room.currentTime,
                currentEpisode: room.currentEpisode,
                isPlaying: room.isPlaying,
                members: room.members,
                chat: room.chat.slice(-30),
                isHost: room.hostId === userId,
            });

            console.log(`[WatchParty] ${username} vào phòng ${roomCode}`);
        });

        // ── PLAY ───────────────────────────────────────────────────
        socket.on('sync-play', ({ roomCode, currentTime }) => {
            const room = rooms.get(roomCode);
            if (!room) return;
            room.currentTime = currentTime;
            room.isPlaying = true;
            socket.to(roomCode).emit('remote-play', { currentTime, by: username });
        });

        // ── PAUSE ──────────────────────────────────────────────────
        socket.on('sync-pause', ({ roomCode, currentTime }) => {
            const room = rooms.get(roomCode);
            if (!room) return;
            room.currentTime = currentTime;
            room.isPlaying = false;
            room.lastActivity = Date.now();
            socket.to(roomCode).emit('remote-pause', { currentTime, by: username });
        });

        // ── SEEK ─────────────────────────────────────────
        socket.on('sync-seek', ({ roomCode, currentTime }) => {
            const room = rooms.get(roomCode);
            if (!room) return;
            room.currentTime = currentTime;
            room.lastActivity = Date.now();
            socket.to(roomCode).emit('remote-seek', { currentTime, by: username });
        });

        // ── ĐỔI TẬP ───────────────────────────────────────
        socket.on('change-episode', ({ roomCode, episode }) => {
            const room = rooms.get(roomCode);
            if (!room || room.hostId !== userId) return;
            room.currentTime = 0;
            room.currentEpisode = episode; // Lưu tên tập mới
            room.isPlaying = false;
            room.lastActivity = Date.now();
            socket.to(roomCode).emit('remote-episode', { episode }); // socket.to() = gửi cho joiners, không gửi lại host
        });

        // ── CHAT ───────────────────────────────────────────────────
        socket.on('chat-message', ({ roomCode, text }) => {
            const room = rooms.get(roomCode);
            if (!room || !text?.trim()) return;

            const msg = {
                id: Date.now().toString(),
                userId,
                username,
                text: text.trim().slice(0, 200),
                time: new Date().toISOString(),
            };

            room.chat.push(msg);
            if (room.chat.length > 100) room.chat = room.chat.slice(-100);
            room.lastActivity = Date.now();

            io.to(roomCode).emit('chat-message', msg);
        });

        // ── PING để cập nhật currentTime ──────────────────────
        socket.on('ping-time', ({ roomCode, currentTime }) => {
            const room = rooms.get(roomCode);
            if (room) {
                room.currentTime = currentTime;
                room.lastActivity = Date.now();
            }
        });

        // ── RỜI PHÒNG (explicit) ─────────────────────────────────
        socket.on('leave-room', ({ roomCode }) => {
            // Explicit leave: hủy grace timer nếu có, rồi đóng phòng ngay
            const room = rooms.get(roomCode);
            if (room?.hostGraceTimer) {
                clearTimeout(room.hostGraceTimer);
                room.hostGraceTimer = null;
            }
            leaveRoom(socket, roomCode, io, true);
        });

        // ── DISCONNECT (mất mạng / đóng app) ───────────────────────
        socket.on('disconnect', () => {
            const result = getRoomBySocket(socket.id);
            if (!result) return;
            const { code, room } = result;

            if (room.hostId === userId) {
                // Host mất kết nối → grace period 15 phút
                room.members = room.members.filter(m => m.userId !== userId);
                socket.leave(code);
                io.to(code).emit('host-disconnected', {
                    message: 'Host mất kết nối, chờ 15 phút...',
                });
                console.log(`[WatchParty] Host ${username} disconnected - grace 15p phòng ${code}`);

                room.hostGraceTimer = setTimeout(() => {
                    // Hết 15 phút mà host chưa vào lại → đóng phòng
                    if (rooms.has(code)) {
                        io.to(code).emit('room-closed', { message: 'Host không kết nối lại sau 15 phút' });
                        rooms.delete(code);
                        console.log(`[WatchParty] Đóng phòng ${code} (host vắng 15p)`);
                    }
                }, 15 * 60 * 1000);
            } else {
                leaveRoom(socket, code, io, false);
            }
        });
    });

    // Dọn phòng không hoạt động sau 2 tiếng (không phân biệt có members hay không)
    setInterval(() => {
        const cutoff = Date.now() - 2 * 60 * 60 * 1000; // 2 tiếng
        for (const [code, room] of rooms.entries()) {
            if ((room.lastActivity || room.createdAt) < cutoff) {
                io.to(code).emit('room-closed', { message: 'Phòng đã hết giờ (2h không hoạt động)' });
                rooms.delete(code);
                console.log(`[WatchParty] Auto-closed phòng ${code} (inactive 2h)`);
            }
        }
    }, 15 * 60 * 1000); // Kiểm tra mỗi 15 phút
};

function leaveRoom(socket, roomCode, io) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const { userId } = socket.user;
    room.members = room.members.filter(m => m.userId !== userId);
    socket.leave(roomCode);

    if (room.members.length === 0 || room.hostId === userId) {
        // Host rời hoặc phòng trống → đóng phòng
        io.to(roomCode).emit('room-closed', { message: 'Host đã rời phòng' });
        rooms.delete(roomCode);
        console.log(`[WatchParty] Phòng ${roomCode} đã đóng`);
    } else {
        io.to(roomCode).emit('member-update', { members: room.members });
    }
}
