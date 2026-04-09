const express = require("express");
const { body, param } = require("express-validator");
const Driver = require("../models/Driver");
const Order = require("../models/Order");
const { protect, adminOnly } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { emitOrderTracking } = require("../realtime/emitOrderTracking");

const router = express.Router();
const ASSIGNMENT_ACCEPT_WINDOW_MS = 5 * 60 * 1000;
const DELIVERY_TRANSITIONS = {
  accepted: "picked",
  picked: "out_for_delivery",
  out_for_delivery: "delivered"
};

const findReplacementDriver = async (currentDriverId) => {
  const replacement = await Driver.findOne({
    _id: { $ne: currentDriverId },
    status: "available"
  }).sort({ rating: -1, createdAt: 1 });
  return replacement;
};

// ============================================
// SPECIFIC ROUTES (must come before /:id routes)
// ============================================

// Update driver status (available, offline, busy) - MUST BE BEFORE /:id
router.put("/status", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    
    const { status } = req.body;
    
    // Validate status value
    if (!["available", "busy", "offline"].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be: available, busy, or offline" });
    }
    
    if (status === "available") {
      const activeOrders = await Order.find({ driver: driver._id, status: { $in: ["accepted", "picked", "out_for_delivery"] } });
      if (activeOrders.length > 0) return res.status(400).json({ message: "Cannot go available while you have active deliveries" });
    }
    driver.status = status;
    await driver.save();
    return res.json({ message: "Status updated successfully", status: driver.status });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Get driver earnings
router.get("/earnings", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const { period } = req.query;
    const now = new Date();
    let startDate = new Date(0);
    if (period === "daily") startDate = new Date(now.setHours(0, 0, 0, 0));
    else if (period === "weekly") startDate = new Date(now.setDate(now.getDate() - 7));
    const earnings = driver.earningsHistory || [];
    const filteredEarnings = earnings.filter(e => new Date(e.date) >= startDate);
    const totalEarnings = filteredEarnings.reduce((sum, e) => sum + e.amount, 0);
    return res.json({ 
      walletBalance: driver.walletBalance || 0, 
      totalEarnings: driver.totalEarnings || 0, 
      bonuses: driver.bonuses || 0, 
      penalties: driver.penalties || 0, 
      periodEarnings: totalEarnings, 
      earningsHistory: filteredEarnings, 
      withdrawalRequests: driver.withdrawalRequests || [] 
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Request withdrawal
router.post("/withdraw", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const { amount, upiId, bankAccount } = req.body;
    if ((driver.walletBalance || 0) < amount) return res.status(400).json({ message: "Insufficient wallet balance" });
    driver.walletBalance = (driver.walletBalance || 0) - amount;
    driver.pendingWithdrawal = (driver.pendingWithdrawal || 0) + amount;
    driver.withdrawalRequests = driver.withdrawalRequests || [];
    driver.withdrawalRequests.push({ amount, status: "pending", requestedAt: new Date(), upiId, bankAccount });
    driver.earningsHistory = driver.earningsHistory || [];
    driver.earningsHistory.push({ date: new Date(), amount: -amount, type: "withdrawal", description: "Withdrawal requested" });
    await driver.save();
    return res.json({ message: "Withdrawal request submitted successfully", walletBalance: driver.walletBalance, pendingWithdrawal: driver.pendingWithdrawal });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Get driver performance stats
router.get("/stats", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const total = driver.totalDeliveries || 0;
    const completed = driver.completedDeliveries || 0;
    const cancelled = driver.cancelledDeliveries || 0;
    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEarnings = (driver.earningsHistory || []).filter(e => new Date(e.date) >= today && e.type === "delivery").reduce((sum, e) => sum + e.amount, 0);
    const todayDeliveries = (driver.earningsHistory || []).filter(e => new Date(e.date) >= today && e.type === "delivery").length;
    return res.json({ 
      totalDeliveries: total, 
      completedDeliveries: completed, 
      cancelledDeliveries: cancelled, 
      completionRate, 
      averageDeliveryTime: driver.averageDeliveryTime || 0, 
      rating: driver.rating || 5.0, 
      walletBalance: driver.walletBalance || 0, 
      totalEarnings: driver.totalEarnings || 0, 
      bonuses: driver.bonuses || 0, 
      penalties: driver.penalties || 0, 
      todayEarnings, 
      todayDeliveries, 
      status: driver.status 
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Get current driver profile
router.get("/profile/me", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: "Driver profile not found" });
    }
    return res.json(driver);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Update driver profile (driver's own profile)
router.put("/profile", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: "Driver profile not found" });
    }
    const { name, phone, vehicleType, vehicleNumber, licenseNumber } = req.body;
    if (name) driver.name = name;
    if (phone) driver.phone = phone;
    if (vehicleType) driver.vehicleType = vehicleType;
    if (vehicleNumber) driver.vehicleNumber = vehicleNumber;
    if (licenseNumber) driver.licenseNumber = licenseNumber;
    await driver.save();
    return res.json(driver);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Upload documents (license, vehicle)
router.put("/documents", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(404).json({ message: "Driver profile not found" });
    }
    const { licenseImage, vehicleImage, insuranceImage } = req.body;
    if (!driver.documents) driver.documents = {};
    if (licenseImage) driver.documents.licenseImage = licenseImage;
    if (vehicleImage) driver.documents.vehicleImage = vehicleImage;
    if (insuranceImage) driver.documents.insuranceImage = insuranceImage;
    driver.documents.uploadedAt = new Date();
    await driver.save();
    return res.json({ message: "Documents uploaded successfully", documents: driver.documents });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Get driver's assigned orders
router.get("/my-orders", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) {
      return res.status(403).json({ message: "Driver profile not found" });
    }
    const orders = await Order.find({ driver: driver._id }).populate("user", "name email phone").sort({ createdAt: -1 });
    return res.json(orders);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Accept delivery order
router.post("/orders/:id/accept", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.driver && order.driver.toString() !== driver._id.toString()) {
      return res.status(403).json({ message: "This order is not assigned to you" });
    }
    if (order.status !== "assigned") {
      return res.status(400).json({ message: "Only assigned orders can be accepted" });
    }
    const expiresAt = order.assignedExpiresAt
      ? new Date(order.assignedExpiresAt)
      : new Date((order.assignedAt || order.createdAt).getTime() + ASSIGNMENT_ACCEPT_WINDOW_MS);
    if (Date.now() > expiresAt.getTime()) {
      return res.status(400).json({ message: "Acceptance window expired for this delivery" });
    }

    order.status = "accepted";
    order.acceptedAt = new Date();
    order.assignedExpiresAt = null;
    const deliveryFee = order.deliveryFee || 30;
    order.deliveryFee = deliveryFee;
    order.driverEarning = Math.round(deliveryFee * 0.8 * 100) / 100;
    
    // Update driver location in order when accepting
    if (driver.currentLocation?.latitude != null && driver.currentLocation?.longitude != null) {
      order.driverLocation = {
        lat: Number(driver.currentLocation.latitude),
        lng: Number(driver.currentLocation.longitude)
      };
    }
    
    await order.save();
    driver.status = "busy";
    await driver.save();
    emitOrderTracking(req.app.get("io"), order);
    return res.json({ message: "Order accepted successfully", order, driverEarning: order.driverEarning });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Reject delivery order
router.post("/orders/:id/reject", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.driver && order.driver.toString() !== driver._id.toString()) {
      return res.status(403).json({ message: "This order is not assigned to you" });
    }
    if (order.status !== "assigned") {
      return res.status(400).json({ message: "Only assigned orders can be rejected" });
    }
    const expiresAt = order.assignedExpiresAt
      ? new Date(order.assignedExpiresAt)
      : new Date((order.assignedAt || order.createdAt).getTime() + ASSIGNMENT_ACCEPT_WINDOW_MS);
    if (Date.now() > expiresAt.getTime()) {
      return res.status(400).json({ message: "Rejection window expired for this delivery" });
    }

    const { reason } = req.body;
    order.rejectReason = reason || "Driver rejected the order";
    order.rejectedAt = new Date();

    const replacement = await findReplacementDriver(driver._id);
    if (replacement) {
      order.driver = replacement._id;
      order.driverName = replacement.name;
      order.driverPhone = replacement.phone;
      order.status = "assigned";
      order.assignedAt = new Date();
      order.assignedExpiresAt = new Date(Date.now() + ASSIGNMENT_ACCEPT_WINDOW_MS);
      order.acceptedAt = null;
      order.pickedAt = null;
      replacement.status = "busy";
      await replacement.save();
    } else {
      order.driver = null;
      order.driverName = null;
      order.driverPhone = null;
      order.status = "confirmed";
      order.assignedAt = null;
      order.assignedExpiresAt = null;
    }

    await order.save();
    driver.cancelledDeliveries = (driver.cancelledDeliveries || 0) + 1;
    driver.status = "available";
    await driver.save();
    emitOrderTracking(req.app.get("io"), order);
    if (replacement) {
      return res.json({
        message: `Order reassigned to ${replacement.name}`,
        orderId: order._id,
        reassignedTo: replacement._id
      });
    }
    return res.json({ message: "Order rejected. No replacement driver available, sent back for reassignment.", orderId: order._id });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Update delivery status (picked, out_for_delivery, delivered)
router.put("/orders/:id/status", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.driver && order.driver.toString() !== driver._id.toString()) {
      return res.status(403).json({ message: "This order is not assigned to you" });
    }
    const { status } = req.body;
    const expectedNextStatus = DELIVERY_TRANSITIONS[order.status];
    if (!expectedNextStatus || expectedNextStatus !== status) {
      return res.status(400).json({
        message: `Invalid status transition. Expected: ${expectedNextStatus || "N/A"}`
      });
    }

    order.status = status;
    if (status === "picked") order.pickedAt = new Date();
    if (status === "delivered") {
      order.deliveredAt = new Date();
      if (order.acceptedAt) {
        const deliveryTime = Math.round((new Date() - order.acceptedAt) / 60000);
        const currentAvg = driver.averageDeliveryTime || 0;
        const totalDeliveries = driver.completedDeliveries || 0;
        driver.averageDeliveryTime = Math.round((currentAvg * totalDeliveries + deliveryTime) / (totalDeliveries + 1));
      }
      const earning = order.driverEarning || 30;
      driver.walletBalance = (driver.walletBalance || 0) + earning;
      driver.totalEarnings = (driver.totalEarnings || 0) + earning;
      driver.completedDeliveries = (driver.completedDeliveries || 0) + 1;
      driver.totalDeliveries = (driver.totalDeliveries || 0) + 1;
      driver.earningsHistory = driver.earningsHistory || [];
      driver.earningsHistory.push({ date: new Date(), amount: earning, type: "delivery", description: "Delivery for Order #" + order._id.toString().slice(-6), orderId: order._id });
      driver.status = "available";
      order.deliveryOtp = undefined;
    }
    if (driver.currentLocation?.latitude != null && driver.currentLocation?.longitude != null) {
      order.driverLocation = {
        lat: Number(driver.currentLocation.latitude),
        lng: Number(driver.currentLocation.longitude)
      };
    }
    await order.save();
    await driver.save();
    emitOrderTracking(req.app.get("io"), order);
    return res.json({ message: "Order status updated successfully", order, walletBalance: driver.walletBalance });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Send chat message (to admin or customer)
router.post("/chat", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const { orderId, message, recipient } = req.body;
    
    // Validate recipient - can be "admin" or "customer"
    if (!recipient || !["admin", "customer"].includes(recipient)) {
      return res.status(400).json({ message: "Recipient must be 'admin' or 'customer'" });
    }
    
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    // Check if order is out for delivery (chat disabled after delivery completed)
    if (!["picked", "picked_up", "out_for_delivery"].includes(order.status)) {
      return res.status(400).json({ message: "Chat is only available after picking up the order" });
    }
    
    if (!order.chatMessages) order.chatMessages = [];
    order.chatMessages.push({ sender: "driver", senderName: driver.name, message, sentAt: new Date(), recipient });
    await order.save();
    
    // Create notification for customer if recipient is customer
    if (recipient === "customer") {
      const User = require("../models/User");
      const user = await User.findById(order.user);
      if (user) {
        if (!user.notifications) user.notifications = [];
        user.notifications.push({
          orderId: order._id,
          message: message,
          sender: "driver",
          senderName: driver.name,
          isRead: false,
          createdAt: new Date()
        });
        await user.save();
      }
    }
    
    return res.json({ message: "Message sent successfully", chatMessages: order.chatMessages });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Get chat messages for an order
router.get("/chat/:orderId", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const order = await Order.findById(req.params.orderId).populate("user", "name email phone");
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (order.driver && order.driver.toString() !== driver._id.toString()) return res.status(403).json({ message: "Not authorized to view this chat" });
    return res.json({ chatMessages: order.chatMessages || [], customer: order.user ? { name: order.user.name, email: order.user.email, phone: order.user.phone } : null });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// ============================================
// DRIVER NOTIFICATION ENDPOINTS
// ============================================

// Get driver notifications
router.get("/notifications", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    
    // Get notifications sorted by date (newest first)
    const notifications = (driver.notifications || []).sort((a, b) => 
      new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    // Get unread count
    const unreadCount = notifications.filter(n => !n.isRead).length;
    
    return res.json({ 
      notifications,
      unreadCount
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Mark all notifications as read
router.put("/notifications/read", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    
    // Mark all notifications as read
    if (driver.notifications) {
      driver.notifications.forEach(n => {
        n.isRead = true;
      });
      await driver.save();
    }
    
    return res.json({ message: "All notifications marked as read" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Mark specific notification as read
router.put("/notifications/:notificationId/read", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    
    const notification = driver.notifications?.find(n => n._id.toString() === req.params.notificationId);
    if (notification) {
      notification.isRead = true;
      await driver.save();
    }
    
    return res.json({ message: "Notification marked as read" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Report delivery issue
router.post("/issues", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const { orderId, issueType, description } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });
    if (!order.issues) order.issues = [];
    order.issues.push({ reportedBy: "driver", driverName: driver.name, issueType, description, reportedAt: new Date(), status: "open" });
    await order.save();
    return res.json({ message: "Issue reported successfully", issue: order.issues[order.issues.length - 1] });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// SOS Emergency button
router.post("/sos", protect, async (req, res) => {
  try {
    const driver = await Driver.findOne({ user: req.user.id });
    if (!driver) return res.status(403).json({ message: "Driver profile not found" });
    const { location, description } = req.body;
    const sosRecord = { driverId: driver._id, driverName: driver.name, driverPhone: driver.phone, location: location || driver.currentLocation, description: description || "Emergency SOS triggered", triggeredAt: new Date(), status: "active" };
    if (!driver.sosHistory) driver.sosHistory = [];
    driver.sosHistory.push(sosRecord);
    await driver.save();
    return res.json({ message: "SOS alert triggered. Help is on the way!", sosRecord, emergencyContact: "100" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Confirm order delivery (with OTP)
router.post("/deliver", protect, async (req, res) => {
  try {
    const { orderId, otp } = req.body;
    const driver = await Driver.findOne({ user: req.user.id });
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (driver) {
      if (order.driver && order.driver.toString() !== driver._id.toString()) {
        return res.status(403).json({ message: "This order is not assigned to you" });
      }
    } else {
      return res.status(403).json({ message: "Driver profile not found" });
    }
    if (order.deliveryOtp !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }
    if (order.status !== "out_for_delivery") {
      return res.status(400).json({ message: "Order is not out for delivery" });
    }
    order.status = "delivered";
    order.deliveredAt = new Date();
    order.deliveryOtp = undefined;
    await order.save();
    if (driver) {
      driver.status = "available";
      driver.totalDeliveries += 1;
      await driver.save();
    }
    emitOrderTracking(req.app.get("io"), order);
    return res.json({ message: "Order delivered successfully", order });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Update driver location
router.post("/:id/location", protect, async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    const ownerDriver = await Driver.findOne({ user: req.user.id }).select("_id");
    const isAdmin = req.user.role === "admin" || req.user.role === "super_admin";
    if (!isAdmin && String(ownerDriver?._id || "") !== String(driver._id)) {
      return res.status(403).json({ message: "Not authorized to update this driver location" });
    }

    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ message: "Valid latitude and longitude are required" });
    }

    driver.currentLocation = { latitude, longitude };
    await driver.save();

    const activeOrders = await Order.find({
      driver: driver._id,
      status: { $in: ["assigned", "accepted", "picked", "out_for_delivery"] }
    });

    const io = req.app.get("io");
    for (const activeOrder of activeOrders) {
      activeOrder.driverLocation = { lat: latitude, lng: longitude };
      await activeOrder.save();
      emitOrderTracking(io, activeOrder, "order:driver-location");
    }

    return res.json({ message: "Location updated", location: driver.currentLocation });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// ============================================
// ADMIN ONLY ROUTES (must have adminOnly)
// ============================================

// Get all drivers (admin only)
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const { status, isVerified } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (isVerified !== undefined) filter.isVerified = isVerified === "true";
    const drivers = await Driver.find(filter).populate("user", "name email").sort({ createdAt: -1 });
    return res.json(drivers);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Get available drivers (for assignment)
router.get("/available", protect, adminOnly, async (req, res) => {
  try {
    const drivers = await Driver.find({ status: "available" });
    return res.json(drivers);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Verify/Approve driver (admin only)
router.put("/:id/verify", protect, adminOnly, async (req, res) => {
  try {
    const { isVerified } = req.body;
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    driver.isVerified = isVerified;
    await driver.save();
    const message = isVerified ? "Driver approved successfully" : "Driver verification revoked";
    return res.json({ message, driver: { _id: driver._id, name: driver.name, email: driver.email, isVerified: driver.isVerified } });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Create new driver (admin only)
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { name, email, phone, vehicleType, vehicleNumber, licenseNumber } = req.body;
    const existingDriver = await Driver.findOne({ email });
    if (existingDriver) {
      return res.status(400).json({ message: "Driver with this email already exists" });
    }
    const driverData = { name, email, phone, vehicleType: vehicleType || "bike", vehicleNumber, licenseNumber, status: "available", isVerified: true };
    const driver = await Driver.create(driverData);
    return res.status(201).json(driver);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Update driver (admin only)
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    const { name, phone, vehicleType, vehicleNumber, licenseNumber, status } = req.body;
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    if (name) driver.name = name;
    if (phone) driver.phone = phone;
    if (vehicleType) driver.vehicleType = vehicleType;
    if (vehicleNumber) driver.vehicleNumber = vehicleNumber;
    if (licenseNumber) driver.licenseNumber = licenseNumber;
    if (status) driver.status = status;
    await driver.save();
    return res.json(driver);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Delete driver (admin only)
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    const driver = await Driver.findByIdAndDelete(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    return res.json({ message: "Driver deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Assign order to driver (admin only)
router.post("/assign", protect, adminOnly, async (req, res) => {
  try {
    const { orderId, driverId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    if (driver.status !== "available") {
      return res.status(400).json({ message: "Driver is not available" });
    }
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    order.driver = driverId;
    order.driverName = driver.name;
    order.driverPhone = driver.phone;
    order.driverLocation = {
      lat: Number(driver.currentLocation?.latitude || 0),
      lng: Number(driver.currentLocation?.longitude || 0)
    };
    order.status = "assigned";
    order.deliveryOtp = otp;
    order.assignedAt = new Date();
    order.assignedExpiresAt = new Date(Date.now() + ASSIGNMENT_ACCEPT_WINDOW_MS);
    await order.save();
    driver.status = "busy";
    await driver.save();
    emitOrderTracking(req.app.get("io"), order);
    return res.json({ message: "Order assigned to driver successfully", order, driver, otp });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Generate delivery OTP for an order
router.post("/generate-otp", protect, adminOnly, async (req, res) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    order.deliveryOtp = otp;
    await order.save();
    return res.json({ message: "Delivery OTP generated", otp: otp, orderId: order._id });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// ============================================
// GENERIC ROUTES WITH :id PARAM (must come last)
// ============================================

// Get driver by ID
router.get("/:id", protect, async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    return res.json(driver);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// ============================================
// NEW ADMIN-ONLY DRIVER MANAGEMENT ROUTES
// ============================================

// Get driver performance metrics (admin only)
router.get("/:id/performance", protect, adminOnly, async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    
    // Calculate performance metrics
    const total = driver.totalDeliveries || 0;
    const completed = driver.completedDeliveries || 0;
    const cancelled = driver.cancelledDeliveries || 0;
    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
    const cancellationRate = total > 0 ? ((cancelled / total) * 100).toFixed(1) : 0;
    
    // Get delivery time stats from recent orders
    const recentOrders = await Order.find({ 
      driver: driver._id, 
      status: "delivered" 
    }).sort({ deliveredAt: -1 }).limit(20);
    
    let avgDeliveryTime = 0;
    if (recentOrders.length > 0) {
      const deliveryTimes = recentOrders
        .filter(o => o.acceptedAt && o.deliveredAt)
        .map(o => Math.round((new Date(o.deliveredAt) - new Date(o.acceptedAt)) / 60000));
      if (deliveryTimes.length > 0) {
        avgDeliveryTime = Math.round(deliveryTimes.reduce((a, b) => a + b, 0) / deliveryTimes.length);
      }
    }
    
    // Get this month's stats
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const monthEarnings = (driver.earningsHistory || [])
      .filter(e => new Date(e.date) >= startOfMonth && e.type === "delivery")
      .reduce((sum, e) => sum + e.amount, 0);
    
    const monthDeliveries = (driver.earningsHistory || [])
      .filter(e => new Date(e.date) >= startOfMonth && e.type === "delivery")
      .length;
    
    return res.json({
      driverId: driver._id,
      name: driver.name,
      email: driver.email,
      phone: driver.phone,
      vehicleType: driver.vehicleType,
      rating: driver.rating,
      totalDeliveries: total,
      completedDeliveries: completed,
      cancelledDeliveries: cancelled,
      completionRate,
      cancellationRate,
      averageDeliveryTime: avgDeliveryTime || driver.averageDeliveryTime || 0,
      walletBalance: driver.walletBalance || 0,
      totalEarnings: driver.totalEarnings || 0,
      bonuses: driver.bonuses || 0,
      penalties: driver.penuses || 0,
      monthEarnings,
      monthDeliveries,
      status: driver.status,
      isVerified: driver.isVerified,
      joinedAt: driver.createdAt
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Get driver delivery history (admin only)
router.get("/:id/deliveries", protect, adminOnly, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    
    const query = { driver: driver._id };
    if (status) {
      query.status = status;
    }
    
    const orders = await Order.find(query)
      .populate("user", "name email phone")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);
    
    const count = await Order.countDocuments(query);
    
    // Calculate delivery times for each order
    const ordersWithTimes = orders.map(order => {
      let deliveryTimeMinutes = null;
      if (order.acceptedAt && order.deliveredAt) {
        deliveryTimeMinutes = Math.round((new Date(order.deliveredAt) - new Date(order.acceptedAt)) / 60000);
      }
      
      return {
        _id: order._id,
        orderId: order._id.toString().slice(-6),
        customerName: order.user?.name || "Unknown",
        customerPhone: order.user?.phone || "N/A",
        status: order.status,
        totalPrice: order.totalPrice,
        deliveryFee: order.deliveryFee || 0,
        driverEarning: order.driverEarning || 0,
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        pickedAt: order.pickedAt,
        deliveredAt: order.deliveredAt,
        deliveryTimeMinutes,
        address: order.address
      };
    });
    
    return res.json({
      driverId: driver._id,
      driverName: driver.name,
      orders: ordersWithTimes,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      totalOrders: count
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Block or suspend driver (admin only)
router.put("/:id/block", protect, adminOnly, async (req, res) => {
  try {
    const { action, reason } = req.body; // action: "block" | "suspend" | "unblock" | "unsuspend"
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    
    if (action === "block") {
      driver.status = "blocked";
      driver.blockedAt = new Date();
      driver.suspensionReason = reason || "Blocked by admin";
    } else if (action === "unblock") {
      driver.status = "offline";
      driver.blockedAt = null;
      driver.suspensionReason = null;
    } else if (action === "suspend") {
      driver.status = "suspended";
      driver.suspendedAt = new Date();
      driver.suspensionReason = reason || "Suspended by admin";
    } else if (action === "unsuspend") {
      driver.status = "offline";
      driver.suspendedAt = null;
      driver.suspensionReason = null;
    }
    
    await driver.save();
    
    const message = action === "block" ? "Driver blocked successfully" :
                   action === "unblock" ? "Driver unblocked successfully" :
                   action === "suspend" ? "Driver suspended successfully" :
                   "Driver unsuspended successfully";
    
    return res.json({ 
      message, 
      driver: { 
        _id: driver._id, 
        name: driver.name, 
        status: driver.status,
        blockedAt: driver.blockedAt,
        suspendedAt: driver.suspendedAt,
        suspensionReason: driver.suspensionReason
      } 
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Approve or reject KYC documents (admin only)
router.put("/:id/kyc", protect, adminOnly, async (req, res) => {
  try {
    const { status, reason } = req.body; // status: "approved" | "rejected"
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    
    if (!driver.kyc) {
      return res.status(400).json({ message: "No KYC documents submitted by this driver" });
    }
    
    if (status === "approved") {
      driver.kyc.status = "approved";
      driver.kyc.verifiedAt = new Date();
      driver.kyc.rejectedReason = null;
      driver.isVerified = true;
    } else if (status === "rejected") {
      driver.kyc.status = "rejected";
      driver.kyc.rejectedReason = reason || "KYC rejected by admin";
      driver.isVerified = false;
    }
    
    await driver.save();
    
    const message = status === "approved" ? "KYC approved successfully" : "KYC rejected";
    
    return res.json({ 
      message, 
      kyc: driver.kyc,
      isVerified: driver.isVerified
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Update driver rating (admin only)
router.put("/:id/rating", protect, adminOnly, async (req, res) => {
  try {
    const { rating } = req.body;
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: "Rating must be between 1 and 5" });
    }
    
    driver.rating = rating;
    await driver.save();
    
    return res.json({ 
      message: "Driver rating updated successfully", 
      rating: driver.rating 
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
