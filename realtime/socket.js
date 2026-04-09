const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const Driver = require("../models/Driver");

const createSocketServer = (httpServer, app) => {
  const io = new Server(httpServer, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace("Bearer ", "");

      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      socket.join(`user:${decoded.id}`);

      if (decoded.role === "driver") {
        const driver = await Driver.findOne({ user: decoded.id }).select("_id");
        if (driver) {
          socket.driverId = String(driver._id);
          socket.join(`driver:${socket.driverId}`);
        }
      }

      next();
    } catch (_error) {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("tracking:join-order", (orderId) => {
      if (!orderId) return;
      socket.join(`order:${orderId}`);
    });

    socket.on("tracking:leave-order", (orderId) => {
      if (!orderId) return;
      socket.leave(`order:${orderId}`);
    });
  });

  app.set("io", io);
  return io;
};

module.exports = { createSocketServer };

