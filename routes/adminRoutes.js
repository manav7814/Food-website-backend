const express = require("express");
const Order = require("../models/Order");
const User = require("../models/User");
const Driver = require("../models/Driver");
const MenuItem = require("../models/MenuItem");
const Banner = require("../models/Banner");
const Offer = require("../models/Offer");
const SystemSettings = require("../models/SystemSettings");
const AuditLog = require("../models/AuditLog");
const { protect, adminOnly } = require("../middleware/auth");

const router = express.Router();

// Helper function to create audit log - fire and forget, doesn't block the main request
const createAuditLog = (action, entityType, description, req, entityId = null, previousValue = null, newValue = null) => {
  // Don't await - this runs in background and won't affect the main request
  AuditLog.create({
    action,
    entityType,
    entityId,
    description,
    performedBy: req.user?.id,
    performedByName: req.user?.name,
    performedByRole: req.user?.role,
    previousValue,
    newValue,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.get("User-Agent")
  }).catch(error => {
    console.error("Failed to create audit log:", error.message);
  });
};

// ============================================
// MAINTENANCE MODE
// ============================================

// Get maintenance mode status
router.get(
  "/maintenance",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      let settings = await SystemSettings.findOne({ key: "MAINTENANCE_MODE" });
      if (!settings) {
        settings = await SystemSettings.create({
          key: "MAINTENANCE_MODE",
          value: { enabled: false, message: "" },
          description: "System maintenance mode toggle"
        });
      }
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Toggle maintenance mode
router.post(
  "/maintenance",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { enabled, message } = req.body;
      let settings = await SystemSettings.findOne({ key: "MAINTENANCE_MODE" });
      
      const previousValue = settings ? settings.value : { enabled: false };
      
      if (settings) {
        settings.value = { enabled, message: message || "" };
        settings.updatedBy = req.user.id;
        await settings.save();
      } else {
        settings = await SystemSettings.create({
          key: "MAINTENANCE_MODE",
          value: { enabled, message: message || "" },
          description: "System maintenance mode toggle",
          updatedBy: req.user.id
        });
      }
      
      // Create audit log
      await createAuditLog(
        "MAINTENANCE_MODE",
        "SYSTEM",
        `Maintenance mode ${enabled ? "enabled" : "disabled"}`,
        req,
        settings._id,
        previousValue,
        settings.value
      );
      
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// CATEGORY VISIBILITY
// ============================================

// Get all categories with visibility status
router.get(
  "/categories",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const categories = await MenuItem.aggregate([
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { _id: 1 } }
      ]);
      
      // Get visibility settings
      let settings = await SystemSettings.findOne({ key: "CATEGORY_VISIBILITY" });
      const visibilityMap = settings ? settings.value : {};
      
      // Get items count per category
      const categoriesWithVisibility = await Promise.all(
        categories.map(async (cat) => {
          const items = await MenuItem.find({ category: cat._id });
          const visibleCount = items.filter(item => item.isVisible !== false).length;
          return {
            name: cat._id,
            totalItems: cat.count,
            visibleItems: visibleCount,
            isVisible: visibilityMap[cat._id] !== false
          };
        })
      );
      
      res.json(categoriesWithVisibility);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Toggle category visibility
router.post(
  "/categories/visibility",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { category, isVisible } = req.body;
      
      // Update all items in the category
      await MenuItem.updateMany(
        { category },
        { $set: { isVisible } }
      );
      
      // Update settings
      let settings = await SystemSettings.findOne({ key: "CATEGORY_VISIBILITY" });
      const visibilityMap = settings ? { ...settings.value } : {};
      visibilityMap[category] = isVisible;
      
      if (settings) {
        settings.value = visibilityMap;
        settings.updatedBy = req.user.id;
        await settings.save();
      } else {
        settings = await SystemSettings.create({
          key: "CATEGORY_VISIBILITY",
          value: visibilityMap,
          description: "Category visibility settings",
          updatedBy: req.user.id
        });
      }
      
      // Create audit log
      await createAuditLog(
        "CATEGORY_VISIBILITY",
        "MENU_ITEM",
        `Category "${category}" visibility changed to ${isVisible ? "visible" : "hidden"}`,
        req
      );
      
      res.json({ success: true, category, isVisible });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// BANNER MANAGEMENT
// ============================================

// Get all banners
router.get(
  "/banners",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const banners = await Banner.find().sort({ position: 1, createdAt: -1 });
      res.json(banners);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Create banner
router.post(
  "/banners",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { title, description, image, link, linkType, category, position, isActive, startDate, endDate } = req.body;
      
      const banner = await Banner.create({
        title,
        description,
        image,
        link,
        linkType,
        category,
        position: position || 0,
        isActive: isActive !== false,
        startDate,
        endDate,
        createdBy: req.user.id,
        updatedBy: req.user.id
      });
      
      // Create audit log
      await createAuditLog(
        "CREATE",
        "BANNER",
        `Created banner: ${title}`,
        req,
        banner._id,
        null,
        { title, isActive }
      );
      
      res.status(201).json(banner);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Update banner
router.put(
  "/banners/:id",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, image, link, linkType, category, position, isActive, startDate, endDate } = req.body;
      
      const previousBanner = await Banner.findById(id);
      if (!previousBanner) {
        return res.status(404).json({ message: "Banner not found" });
      }
      
      const banner = await Banner.findByIdAndUpdate(
        id,
        {
          title,
          description,
          image,
          link,
          linkType,
          category,
          position: position || 0,
          isActive,
          startDate,
          endDate,
          updatedBy: req.user.id
        },
        { new: true }
      );
      
      // Create audit log
      await createAuditLog(
        "UPDATE",
        "BANNER",
        `Updated banner: ${title}`,
        req,
        banner._id,
        { title: previousBanner.title, isActive: previousBanner.isActive },
        { title, isActive }
      );
      
      res.json(banner);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Delete banner
router.delete(
  "/banners/:id",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const banner = await Banner.findById(id);
      
      if (!banner) {
        return res.status(404).json({ message: "Banner not found" });
      }
      
      await Banner.findByIdAndDelete(id);
      
      // Create audit log
      await createAuditLog(
        "DELETE",
        "BANNER",
        `Deleted banner: ${banner.title}`,
        req,
        banner._id,
        { title: banner.title, isActive: banner.isActive },
        null
      );
      
      res.json({ message: "Banner deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Toggle banner active status
router.patch(
  "/banners/:id/toggle",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const banner = await Banner.findById(id);
      
      if (!banner) {
        return res.status(404).json({ message: "Banner not found" });
      }
      
      banner.isActive = !banner.isActive;
      banner.updatedBy = req.user.id;
      await banner.save();
      
      // Create audit log
      await createAuditLog(
        "UPDATE",
        "BANNER",
        `${banner.isActive ? "Enabled" : "Disabled"} banner: ${banner.title}`,
        req,
        banner._id,
        null,
        { isActive: banner.isActive }
      );
      
      res.json(banner);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// OFFER/COUPON MANAGEMENT
// ============================================

// Get all offers
router.get(
  "/offers",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const offers = await Offer.find()
        .populate("createdBy", "name email")
        .populate("updatedBy", "name email")
        .sort({ createdAt: -1 });
      res.json(offers);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Create offer
router.post(
  "/offers",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { code, name, description, discountType, discountValue, minOrderValue, maxDiscountValue, applicableCategories, applicableMenuItems, usageLimit, userUsageLimit, startDate, endDate, isPublic } = req.body;
      
      // Check if code already exists
      const existingOffer = await Offer.findOne({ code: code.toUpperCase() });
      if (existingOffer) {
        return res.status(400).json({ message: "Offer code already exists" });
      }
      
      const offer = await Offer.create({
        code: code.toUpperCase(),
        name,
        description,
        discountType,
        discountValue,
        minOrderValue: minOrderValue || 0,
        maxDiscountValue,
        applicableCategories: applicableCategories || [],
        applicableMenuItems: applicableMenuItems || [],
        usageLimit,
        userUsageLimit: userUsageLimit || 1,
        startDate,
        endDate,
        isPublic: isPublic !== false,
        createdBy: req.user.id,
        updatedBy: req.user.id
      });
      
      // Create audit log
      await createAuditLog(
        "CREATE",
        "OFFER",
        `Created offer: ${code} - ${name}`,
        req,
        offer._id,
        null,
        { code: offer.code, discountType, discountValue, isActive: true }
      );
      
      res.status(201).json(offer);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Update offer
router.put(
  "/offers/:id",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { code, name, description, discountType, discountValue, minOrderValue, maxDiscountValue, applicableCategories, applicableMenuItems, usageLimit, userUsageLimit, startDate, endDate, isActive, isPublic } = req.body;
      
      const previousOffer = await Offer.findById(id);
      if (!previousOffer) {
        return res.status(404).json({ message: "Offer not found" });
      }
      
      const offer = await Offer.findByIdAndUpdate(
        id,
        {
          code: code.toUpperCase(),
          name,
          description,
          discountType,
          discountValue,
          minOrderValue: minOrderValue || 0,
          maxDiscountValue,
          applicableCategories: applicableCategories || [],
          applicableMenuItems: applicableMenuItems || [],
          usageLimit,
          userUsageLimit: userUsageLimit || 1,
          startDate,
          endDate,
          isActive,
          isPublic,
          updatedBy: req.user.id
        },
        { new: true }
      );
      
      // Create audit log
      await createAuditLog(
        "UPDATE",
        "OFFER",
        `Updated offer: ${code} - ${name}`,
        req,
        offer._id,
        { code: previousOffer.code, isActive: previousOffer.isActive },
        { code: offer.code, isActive }
      );
      
      res.json(offer);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Delete offer
router.delete(
  "/offers/:id",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const offer = await Offer.findById(id);
      
      if (!offer) {
        return res.status(404).json({ message: "Offer not found" });
      }
      
      await Offer.findByIdAndDelete(id);
      
      // Create audit log
      await createAuditLog(
        "DELETE",
        "OFFER",
        `Deleted offer: ${offer.code} - ${offer.name}`,
        req,
        offer._id,
        { code: offer.code, isActive: offer.isActive },
        null
      );
      
      res.json({ message: "Offer deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Toggle offer active status
router.patch(
  "/offers/:id/toggle",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const offer = await Offer.findById(id);
      
      if (!offer) {
        return res.status(404).json({ message: "Offer not found" });
      }
      
      offer.isActive = !offer.isActive;
      offer.updatedBy = req.user.id;
      await offer.save();
      
      // Create audit log
      await createAuditLog(
        "UPDATE",
        "OFFER",
        `${offer.isActive ? "Enabled" : "Disabled"} offer: ${offer.code}`,
        req,
        offer._id,
        null,
        { isActive: offer.isActive }
      );
      
      res.json(offer);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Validate offer (public endpoint for customers)
router.post(
  "/offers/validate",
  async (req, res) => {
    try {
      const { code, orderValue, category } = req.body;
      
      const offer = await Offer.findOne({ code: code.toUpperCase() });
      
      if (!offer) {
        return res.status(404).json({ message: "Invalid offer code", valid: false });
      }
      
      // Check if offer is active
      if (!offer.isActive) {
        return res.status(400).json({ message: "Offer is not active", valid: false });
      }
      
      // Check date validity
      const now = new Date();
      if (now < new Date(offer.startDate) || now > new Date(offer.endDate)) {
        return res.status(400).json({ message: "Offer is not valid for this period", valid: false });
      }
      
      // Check usage limit
      if (offer.usageLimit && offer.usageCount >= offer.usageLimit) {
        return res.status(400).json({ message: "Offer usage limit exceeded", valid: false });
      }
      
      // Check minimum order value
      if (offer.minOrderValue && orderValue < offer.minOrderValue) {
        return res.status(400).json({ 
          message: `Minimum order value of ${offer.minOrderValue} required`, 
          valid: false 
        });
      }
      
      // Calculate discount
      let discount = 0;
      if (offer.discountType === "percentage") {
        discount = (orderValue * offer.discountValue) / 100;
        if (offer.maxDiscountValue) {
          discount = Math.min(discount, offer.maxDiscountValue);
        }
      } else {
        discount = offer.discountValue;
      }
      
      res.json({
        valid: true,
        offer: {
          code: offer.code,
          name: offer.name,
          discountType: offer.discountType,
          discountValue: offer.discountValue,
          discount: discount.toFixed(2)
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// ROLE MANAGEMENT (Super Admin)
// ============================================

// Get all users with roles
router.get(
  "/users",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { role, search } = req.query;
      
      let query = {};
      if (role) {
        query.role = role;
      }
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } }
        ];
      }
      
      const users = await User.find(query)
        .select("-password")
        .sort({ createdAt: -1 });
      res.json(users);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Get user by ID
router.get(
  "/users/:id",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const user = await User.findById(id).select("-password");
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(user);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Update user role
router.patch(
  "/users/:id/role",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      
      // Only super_admin can assign super_admin role
      if (role === "super_admin" && req.user.role !== "super_admin") {
        return res.status(403).json({ message: "Only super admin can assign super admin role" });
      }
      
      const user = await User.findById(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const previousRole = user.role;
      user.role = role;
      await user.save();
      
      // Create audit log
      await createAuditLog(
        "ROLE_CHANGE",
        "USER",
        `Changed role of ${user.name} from ${previousRole} to ${role}`,
        req,
        user._id,
        { role: previousRole },
        { role }
      );
      
      res.json({ message: "Role updated successfully", user });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// NOTIFICATION BROADCASTING
// ============================================

// Broadcast notification to all users
router.post(
  "/broadcast",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { title, message, target } = req.body; // target: "all", "customers", "drivers"
      
      let usersToNotify = [];
      
      if (target === "all") {
        usersToNotify = await User.find({});
        const drivers = await Driver.find({});
        
        // Add notification to all users
        for (const user of usersToNotify) {
          user.notifications.push({
            message: `${title}: ${message}`,
            sender: "admin",
            senderName: req.user.name,
            isRead: false,
            createdAt: new Date()
          });
          await user.save();
        }
        
        // Add notification to all drivers
        for (const driver of drivers) {
          driver.notifications.push({
            message: `${title}: ${message}`,
            sender: "admin",
            senderName: req.user.name,
            isRead: false,
            createdAt: new Date()
          });
          await driver.save();
        }
      } else if (target === "customers") {
        usersToNotify = await User.find({ role: "customer" });
        
        for (const user of usersToNotify) {
          user.notifications.push({
            message: `${title}: ${message}`,
            sender: "admin",
            senderName: req.user.name,
            isRead: false,
            createdAt: new Date()
          });
          await user.save();
        }
      } else if (target === "drivers") {
        usersToNotify = await Driver.find({});
        
        for (const driver of usersToNotify) {
          driver.notifications.push({
            message: `${title}: ${message}`,
            sender: "admin",
            senderName: req.user.name,
            isRead: false,
            createdAt: new Date()
          });
          await driver.save();
        }
      }
      
      // Create audit log
      await createAuditLog(
        "BROADCAST_NOTIFICATION",
        "SYSTEM",
        `Broadcast notification to ${target}: "${title} - ${message}"`,
        req
      );
      
      res.json({ 
        message: "Notification broadcasted successfully",
        recipients: usersToNotify.length
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// AUDIT LOGS
// ============================================

// Get audit logs
router.get(
  "/audit-logs",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { action, entityType, userId, startDate, endDate, page = 1, limit = 50 } = req.query;
      
      let query = {};
      
      if (action) {
        query.action = action;
      }
      if (entityType) {
        query.entityType = entityType;
      }
      if (userId) {
        query.performedBy = userId;
      }
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
          query.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          query.createdAt.$lte = new Date(endDate);
        }
      }
      
      const logs = await AuditLog.find(query)
        .populate("performedBy", "name email role")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit));
      
      const total = await AuditLog.countDocuments(query);
      
      res.json({
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Get audit log actions summary
router.get(
  "/audit-logs/summary",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const actionCounts = await AuditLog.aggregate([
        { $group: { _id: "$action", count: { $sum: 1 } } }
      ]);
      
      const entityTypeCounts = await AuditLog.aggregate([
        { $group: { _id: "$entityType", count: { $sum: 1 } } }
      ]);
      
      const totalLogs = await AuditLog.countDocuments();
      
      res.json({
        totalLogs,
        byAction: actionCounts,
        byEntityType: entityTypeCounts
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// SYSTEM SETTINGS
// ============================================

// Get all system settings
router.get(
  "/settings",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const settings = await SystemSettings.find();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// Update system setting
router.put(
  "/settings/:key",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { key } = req.params;
      const { value, description } = req.body;
      
      let setting = await SystemSettings.findOne({ key });
      
      if (setting) {
        const previousValue = setting.value;
        setting.value = value;
        setting.description = description || setting.description;
        setting.updatedBy = req.user.id;
        await setting.save();
        
        // Create audit log
        await createAuditLog(
          "UPDATE",
          "SYSTEM",
          `Updated system setting: ${key}`,
          req,
          setting._id,
          previousValue,
          value
        );
      } else {
        setting = await SystemSettings.create({
          key,
          value,
          description,
          updatedBy: req.user.id
        });
        
        // Create audit log
        await createAuditLog(
          "CREATE",
          "SYSTEM",
          `Created system setting: ${key}`,
          req,
          setting._id,
          null,
          value
        );
      }
      
      res.json(setting);
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// ADMIN DASHBOARD STATS
// ============================================

// Get all dashboard statistics
router.get(
  "/dashboard-stats",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const { period } = req.query; // daily, weekly, monthly
      
      // Determine date range based on period
      const now = new Date();
      let startDate;
      switch (period) {
        case "daily":
          startDate = new Date(now.setHours(0, 0, 0, 0));
          break;
        case "weekly":
          startDate = new Date(now.setDate(now.getDate() - 7));
          break;
        case "monthly":
        default:
          startDate = new Date(now.setMonth(now.getMonth() - 1));
          break;
      }

      // ========== Total Revenue ==========
      const allDeliveredOrders = await Order.find({
        status: "delivered",
        paymentStatus: "paid"
      });
      
      const periodDeliveredOrders = await Order.find({
        status: "delivered",
        paymentStatus: "paid",
        createdAt: { $gte: startDate }
      });

      const totalRevenue = allDeliveredOrders.reduce((sum, order) => sum + order.totalPrice, 0);
      const periodRevenue = periodDeliveredOrders.reduce((sum, order) => sum + order.totalPrice, 0);

      // Revenue by day for chart (last 30 days)
      const last30Days = [];
      for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);
        const nextDate = new Date(date);
        nextDate.setDate(nextDate.getDate() + 1);
        
        const dayOrders = await Order.find({
          status: "delivered",
          paymentStatus: "paid",
          createdAt: { $gte: date, $lt: nextDate }
        });
        
        last30Days.push({
          date: date.toISOString().split("T")[0],
          revenue: dayOrders.reduce((sum, order) => sum + order.totalPrice, 0),
          orders: dayOrders.length
        });
      }

      // ========== Total Orders ==========
      const totalOrders = await Order.countDocuments();
      const periodOrders = await Order.countDocuments({ createdAt: { $gte: startDate } });

      // ========== Total Users ==========
      const totalUsers = await User.countDocuments({ role: "customer" });

      // ========== Total Drivers ==========
      const totalDrivers = await Driver.countDocuments();

      // ========== Order Completion Rate ==========
      const allOrders = await Order.find();
      const completedOrders = await Order.find({ status: "delivered" });
      const orderCompletionRate = allOrders.length > 0 
        ? (completedOrders.length / allOrders.length) * 100 
        : 0;

      // ========== Cancelled Orders Report ==========
      const cancelledOrders = await Order.find({ status: "cancelled" });
      const periodCancelledOrders = await Order.find({ 
        status: "cancelled",
        createdAt: { $gte: startDate }
      });
      
      const cancelledOrdersByReason = {};
      cancelledOrders.forEach(order => {
        const reason = order.rejectReason || "No reason provided";
        cancelledOrdersByReason[reason] = (cancelledOrdersByReason[reason] || 0) + 1;
      });

      // Recent cancelled orders
      const recentCancelledOrders = cancelledOrders
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 10)
        .map(order => ({
          _id: order._id,
          userName: order.user?.name || "N/A",
          totalPrice: order.totalPrice,
          rejectReason: order.rejectReason,
          cancelledAt: order.updatedAt
        }));

      // ========== Top Selling Items ==========
      const allOrderItems = [];
      allDeliveredOrders.forEach(order => {
        order.items.forEach(item => {
          allOrderItems.push({
            menuItem: item.menuItem,
            name: item.name,
            quantity: item.quantity,
            price: item.price
          });
        });
      });

      // Aggregate top selling items
      const itemSales = {};
      allOrderItems.forEach(item => {
        const itemId = item.menuItem?.toString() || item.name;
        if (!itemSales[itemId]) {
          itemSales[itemId] = {
            name: item.name,
            totalQuantity: 0,
            totalRevenue: 0
          };
        }
        itemSales[itemId].totalQuantity += item.quantity;
        itemSales[itemId].totalRevenue += item.price * item.quantity;
      });

      const topSellingItems = Object.entries(itemSales)
        .map(([id, data]) => ({
          itemId: id,
          name: data.name,
          totalQuantity: data.totalQuantity,
          totalRevenue: data.totalRevenue
        }))
        .sort((a, b) => b.totalQuantity - a.totalQuantity)
        .slice(0, 10);

      // ========== Most Active Drivers ==========
      const driverDeliveries = {};
      allDeliveredOrders.forEach(order => {
        if (order.driver) {
          const driverId = order.driver.toString();
          if (!driverDeliveries[driverId]) {
            driverDeliveries[driverId] = {
              driverId: order.driver,
              driverName: order.driverName,
              driverPhone: order.driverPhone,
              totalDeliveries: 0,
              totalEarnings: 0
            };
          }
          driverDeliveries[driverId].totalDeliveries += 1;
          driverDeliveries[driverId].totalEarnings += order.driverEarning || 0;
        }
      });

      const mostActiveDrivers = Object.values(driverDeliveries)
        .sort((a, b) => b.totalDeliveries - a.totalDeliveries)
        .slice(0, 10);

      // ========== Real-time Active Deliveries ==========
      const activeDeliveryStatuses = ["confirmed", "assigned", "accepted", "picked", "out_for_delivery"];
      const activeDeliveries = await Order.find({
        status: { $in: activeDeliveryStatuses }
      }).populate("user", "name").populate("driver", "name phone");

      const activeDeliveriesCount = activeDeliveries.length;

      // ========== Revenue by Period (Daily/Weekly/Monthly) ==========
      const dailyRevenue = last30Days.slice(-7).map(day => ({
        date: day.date,
        revenue: day.revenue,
        orders: day.orders
      }));

      const weeklyRevenue = [];
      for (let i = 3; i >= 0; i--) {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - (i * 7));
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        
        const weekOrders = await Order.find({
          status: "delivered",
          paymentStatus: "paid",
          createdAt: { $gte: weekStart, $lt: weekEnd }
        });
        
        weeklyRevenue.push({
          week: `Week ${4 - i}`,
          revenue: weekOrders.reduce((sum, order) => sum + order.totalPrice, 0),
          orders: weekOrders.length
        });
      }

      const monthlyRevenue = [];
      for (let i = 5; i >= 0; i--) {
        const monthStart = new Date();
        monthStart.setMonth(monthStart.getMonth() - i);
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const monthEnd = new Date(monthStart);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        
        const monthOrders = await Order.find({
          status: "delivered",
          paymentStatus: "paid",
          createdAt: { $gte: monthStart, $lt: monthEnd }
        });
        
        monthlyRevenue.push({
          month: monthStart.toLocaleString("default", { month: "short" }),
          year: monthStart.getFullYear(),
          revenue: monthOrders.reduce((sum, order) => sum + order.totalPrice, 0),
          orders: monthOrders.length
        });
      }

      res.json({
        // Revenue
        revenue: {
          total: totalRevenue,
          period: periodRevenue,
          daily: dailyRevenue,
          weekly: weeklyRevenue,
          monthly: monthlyRevenue,
          last30Days
        },
        // Orders
        orders: {
          total: totalOrders,
          period: periodOrders,
          completed: completedOrders.length,
          cancelled: cancelledOrders.length,
          completionRate: orderCompletionRate.toFixed(1)
        },
        // Users
        users: {
          total: totalUsers
        },
        // Drivers
        drivers: {
          total: totalDrivers
        },
        // Cancelled Orders Report
        cancelledOrdersReport: {
          total: cancelledOrders.length,
          periodTotal: periodCancelledOrders.length,
          byReason: cancelledOrdersByReason,
          recent: recentCancelledOrders
        },
        // Top Selling Items
        topSellingItems,
        // Most Active Drivers
        mostActiveDrivers,
        // Active Deliveries (Real-time)
        activeDeliveries: {
          count: activeDeliveriesCount,
          orders: activeDeliveries.map(order => ({
            _id: order._id,
            status: order.status,
            customerName: order.user?.name || "N/A",
            driverName: order.driverName || order.driver?.name || "Not assigned",
            driverPhone: order.driverPhone || order.driver?.phone || "N/A",
            totalPrice: order.totalPrice,
            createdAt: order.createdAt
          }))
        }
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// GET ACTIVE DELIVERIES (Real-time)
// ============================================

router.get(
  "/active-deliveries",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const activeDeliveryStatuses = ["confirmed", "assigned", "accepted", "picked", "out_for_delivery"];
      const activeDeliveries = await Order.find({
        status: { $in: activeDeliveryStatuses }
      })
        .populate("user", "name phone")
        .populate("driver", "name phone vehicleType")
        .sort({ createdAt: -1 });

      res.json({
        count: activeDeliveries.length,
        orders: activeDeliveries.map(order => ({
          _id: order._id,
          status: order.status,
          customerName: order.user?.name || "N/A",
          customerPhone: order.user?.phone || "N/A",
          driverName: order.driver?.name || "Not assigned",
          driverPhone: order.driver?.phone || "N/A",
          driverVehicle: order.driver?.vehicleType || "N/A",
          totalPrice: order.totalPrice,
          address: order.address,
          createdAt: order.createdAt,
          estimatedDeliveryTime: order.estimatedDeliveryTime
        }))
      });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;
