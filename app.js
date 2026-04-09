const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const restaurantRoutes = require("./routes/restaurantRoutes");
const menuRoutes = require("./routes/menuRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const driverRoutes = require("./routes/driverRoutes");
const seedRoutes = require("./routes/seedRoutes");
const financialRoutes = require("./routes/financialRoutes");
const adminRoutes = require("./routes/adminRoutes");
const offerRoutes = require("./routes/offerRoutes");
const chatRoutes = require("./routes/chatRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ message: "API is running" }));
app.use("/api/auth", authRoutes);
app.use("/api/restaurants", restaurantRoutes);
app.use("/api/menu", menuRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/seed", seedRoutes);
app.use("/api/financial", financialRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/chat", chatRoutes);

module.exports = app;
