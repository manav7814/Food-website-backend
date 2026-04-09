const express = require("express");
const { body, param, query } = require("express-validator");
const Order = require("../models/Order");
const Driver = require("../models/Driver");
const SystemSettings = require("../models/SystemSettings");
const { protect, adminOnly } = require("../middleware/auth");
const { validate } = require("../middleware/validate");
const { haversineDistanceKm, calculateETA } = require("../utils/geo");
const { emitOrderTracking } = require("../realtime/emitOrderTracking");

const router = express.Router();
const ASSIGNMENT_ACCEPT_WINDOW_MS = 5 * 60 * 1000;
const CUSTOMER_CANCELLABLE_STATUSES = ["pending", "confirmed", "assigned"];

const toLatLng = (location = {}) => {
  const lat = Number(location.lat ?? location.latitude);
  const lng = Number(location.lng ?? location.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const getRestaurantLocationFallback = async () => {
  const defaults = {
    lat: Number(process.env.RESTAURANT_LAT || 19.076),
    lng: Number(process.env.RESTAURANT_LNG || 72.8777)
  };

  const setting = await SystemSettings.findOne({ key: "RESTAURANT_DELIVERY_CONFIG" });
  if (!setting?.value) return defaults;
  const location = toLatLng(setting.value);
  return location || defaults;
};

router.post(
  "/",
  protect,
  [
    body("items").isArray({ min: 1 }).withMessage("Order items are required"),
    body("items.*.menuItem").isMongoId().withMessage("menuItem id is invalid"),
    body("items.*.name").trim().isLength({ min: 2 }).withMessage("item name is invalid"),
    body("items.*.price").isFloat({ gt: 0 }).withMessage("item price is invalid"),
    body("items.*.quantity").isInt({ min: 1 }).withMessage("item quantity is invalid"),
    body("address").trim().isLength({ min: 5 }).withMessage("address is required"),
    body("deliveryLocation.latitude")
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage("deliveryLocation latitude is invalid"),
    body("deliveryLocation.longitude")
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage("deliveryLocation longitude is invalid"),
    body("restaurantLocation.lat")
      .optional()
      .isFloat({ min: -90, max: 90 })
      .withMessage("restaurantLocation latitude is invalid"),
    body("restaurantLocation.lng")
      .optional()
      .isFloat({ min: -180, max: 180 })
      .withMessage("restaurantLocation longitude is invalid")
  ],
  validate,
  async (req, res) => {
    try {
      const { items, address, deliveryLocation, userLocation, restaurantLocation } = req.body;

      const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const parsedUserLocation = toLatLng(userLocation || deliveryLocation);
      const parsedRestaurantLocation = toLatLng(restaurantLocation) || (await getRestaurantLocationFallback());

      const order = await Order.create({
        user: req.user.id,
        items,
        totalPrice,
        address,
        userLocation: parsedUserLocation,
        deliveryLocation: parsedUserLocation
          ? {
              latitude: parsedUserLocation.lat,
              longitude: parsedUserLocation.lng
            }
          : undefined,
        restaurantLocation: parsedRestaurantLocation
          ? {
              lat: parsedRestaurantLocation.lat,
              lng: parsedRestaurantLocation.lng,
              latitude: parsedRestaurantLocation.lat,
              longitude: parsedRestaurantLocation.lng
            }
          : undefined
      });

      emitOrderTracking(req.app.get("io"), order);

      // Send confirmation email via n8n webhook
      try {
        const webhookUrl = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook-test/order-confirmation';
        
        // Populate user details for the email
        await order.populate('user', 'name email');
        
        const emailData = {
          _id: order._id.toString(),
          user: {
            name: order.user.name,
            email: order.user.email
          },
          items: order.items.map(item => ({
            name: item.name,
            quantity: item.quantity
          })),
          totalPrice: order.totalPrice,
          address: order.address,
          estimatedDeliveryTime: order.estimatedDeliveryTime || '30-40 minutes',
          createdAt: order.createdAt.toISOString()
        };
        
        // Call the n8n webhook
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(emailData)
        });
      } catch (emailError) {
        console.error('Failed to send confirmation email:', emailError.message);
      }

      return res.status(201).json(order);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.get("/my", protect, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
    return res.json(orders);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get(
  "/:id/tracking",
  protect,
  [param("id").isMongoId().withMessage("Invalid order id")],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id).populate("driver", "name phone");
      if (!order) return res.status(404).json({ message: "Order not found" });

      const isCustomer = String(order.user) === String(req.user.id);
      const driver = await Driver.findOne({ user: req.user.id }).select("_id");
      const isAssignedDriver = driver && String(order.driver?._id || order.driver) === String(driver._id);
      const isAdmin = ["admin", "super_admin"].includes(req.user.role);

      if (!isCustomer && !isAssignedDriver && !isAdmin) {
        return res.status(403).json({ message: "Not authorized to track this order" });
      }

      const restaurant = toLatLng(order.restaurantLocation);
      const userLocation = toLatLng(order.userLocation || order.deliveryLocation);
      const driverLocation = toLatLng(order.driverLocation);

      // Calculate distances based on order status
      let pickupDistanceKm = null;
      let deliveryDistanceKm = null;
      let routeDistanceKm = null;
      let estimatedDurationMin = null;
      let activeRoute = "restaurant_to_user"; // 'restaurant_to_user', 'driver_to_restaurant', 'driver_to_user'

      if (restaurant && userLocation) {
        // Always calculate restaurant to user distance for reference
        routeDistanceKm = haversineDistanceKm(restaurant, userLocation);
        const etaInfo = routeDistanceKm ? calculateETA(routeDistanceKm) : { estimatedMinutes: null };
        estimatedDurationMin = etaInfo.estimatedMinutes;
      }

      // Calculate driver-specific distances based on status
      if (driverLocation) {
        if (restaurant) {
          // Driver to restaurant (pickup phase - when driver is assigned or accepted)
          pickupDistanceKm = haversineDistanceKm(driverLocation, restaurant);
        }
        if (userLocation) {
          // Driver to user (delivery phase - when out for delivery)
          deliveryDistanceKm = haversineDistanceKm(driverLocation, userLocation);
        }
      }

      // Determine which route is active based on order status
      const status = order.status;
      if (["assigned", "accepted"].includes(status)) {
        // Pickup phase - driver going to restaurant
        activeRoute = "driver_to_restaurant";
      } else if (["picked", "out_for_delivery"].includes(status)) {
        // Delivery phase - driver going to user
        activeRoute = "driver_to_user";
      } else {
        // Default - restaurant to user (for customers viewing)
        activeRoute = "restaurant_to_user";
      }

      // Calculate ETA based on active route
      let activeDistanceKm = routeDistanceKm;
      if (activeRoute === "driver_to_restaurant" && pickupDistanceKm) {
        activeDistanceKm = pickupDistanceKm;
        // For pickup, just calculate travel time (no prep time)
        const travelTimeMin = Math.round((pickupDistanceKm / 20) * 60); // 20 km/h average
        estimatedDurationMin = travelTimeMin;
      } else if (activeRoute === "driver_to_user" && deliveryDistanceKm) {
        activeDistanceKm = deliveryDistanceKm;
        // For delivery, just calculate travel time (no prep time)
        const travelTimeMin = Math.round((deliveryDistanceKm / 20) * 60); // 20 km/h average
        estimatedDurationMin = travelTimeMin;
      }

      return res.json({
        orderId: order._id,
        status: order.status,
        orderStatus: order.orderStatus,
        restaurantLocation: restaurant,
        userLocation,
        driverLocation,
        // All distance calculations
        routeDistanceKm, // restaurant to user
        pickupDistanceKm, // driver to restaurant
        deliveryDistanceKm, // driver to user
        // Active route info
        activeRoute,
        activeDistanceKm,
        estimatedDurationMin,
        driver: order.driver || null,
        updatedAt: order.updatedAt
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.patch(
  "/:id/cancel",
  protect,
  [
    param("id").isMongoId().withMessage("Invalid order id"),
    body("reason").optional({ values: [null, ""] }).trim().isLength({ max: 250 }).withMessage("reason is too long")
  ],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.user.toString() !== req.user.id) {
        return res.status(403).json({ message: "Not authorized to cancel this order" });
      }
      if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
        return res.status(400).json({ message: "Order can only be cancelled before preparation starts" });
      }

      order.status = "cancelled";
      order.cancellation = {
        cancelledBy: "customer",
        reason: req.body.reason || "Cancelled by customer",
        cancelledAt: new Date()
      };
      order.rejectReason = order.cancellation.reason;
      order.rejectedAt = order.cancellation.cancelledAt;

      if (order.driver) {
        const assignedDriver = await Driver.findById(order.driver);
        if (assignedDriver) {
          assignedDriver.status = "available";
          await assignedDriver.save();
        }
      }

      order.driver = null;
      order.driverName = null;
      order.driverPhone = null;
      order.assignedExpiresAt = null;

      await order.save();
      emitOrderTracking(req.app.get("io"), order);
      return res.json({ message: "Order cancelled successfully", order });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.post(
  "/:id/review",
  protect,
  [
    param("id").isMongoId().withMessage("Invalid order id"),
    body("rating").isInt({ min: 1, max: 5 }).withMessage("rating must be between 1 and 5"),
    body("comment").optional({ values: [null, ""] }).trim().isLength({ max: 500 }).withMessage("comment is too long")
  ],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.user.toString() !== req.user.id) {
        return res.status(403).json({ message: "Not authorized to review this order" });
      }
      if (order.status !== "delivered") {
        return res.status(400).json({ message: "Review can only be submitted after delivery" });
      }
      if (order.customerReview?.rating) {
        return res.status(400).json({ message: "Review already submitted for this order" });
      }

      order.customerReview = {
        rating: req.body.rating,
        comment: req.body.comment || "",
        reviewedAt: new Date()
      };
      await order.save();

      if (order.driver) {
        const driver = await Driver.findById(order.driver);
        if (driver) {
          const reviewedOrders = await Order.find({
            driver: driver._id,
            "customerReview.rating": { $exists: true }
          }).select("customerReview.rating");

          if (reviewedOrders.length > 0) {
            const totalRating = reviewedOrders.reduce((sum, item) => sum + (item.customerReview?.rating || 0), 0);
            driver.rating = Math.round((totalRating / reviewedOrders.length) * 10) / 10;
            await driver.save();
          }
        }
      }

      return res.status(201).json({ message: "Review submitted successfully", review: order.customerReview });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.get(
  "/admin/all",
  protect,
  adminOnly,
  [query("status").optional({ values: [null, ""] }).custom((value) => {
    if (value && !["pending", "confirmed", "assigned", "accepted", "picked", "out_for_delivery", "delivered", "cancelled"].includes(value)) {
      throw new Error("Invalid status value");
    }
    return true;
  })],
  validate,
  async (req, res) => {
    try {
      const filter = req.query.status ? { status: req.query.status } : {};
      const orders = await Order.find(filter)
        .populate("user", "name email phone")
        .populate("driver", "name phone vehicleType")
        .sort({ createdAt: -1 });
      return res.json(orders);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.get(
  "/driver/orders",
  protect,
  async (req, res) => {
    try {
      const driver = await Driver.findOne({ user: req.user.id });
      
      if (!driver) {
        return res.status(404).json({ message: "Driver profile not found" });
      }

      const filter = { driver: driver._id };
      if (req.query.status) {
        const statuses = String(req.query.status)
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean);
        filter.status = statuses.length > 1 ? { $in: statuses } : statuses[0];
      }
      
      const orders = await Order.find(filter)
        .populate("user", "name email phone")
        .sort({ createdAt: -1 });
      
      return res.json(orders);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.patch(
  "/:id/status",
  protect,
  adminOnly,
  [
    param("id").isMongoId().withMessage("Invalid order id"),
    body("status")
      .isIn(["pending", "confirmed", "assigned", "accepted", "picked", "out_for_delivery", "delivered", "cancelled"])
      .withMessage("Invalid status value")
  ],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      order.status = req.body.status || order.status;
      await order.save();
      emitOrderTracking(req.app.get("io"), order);

      const populated = await order.populate("user", "name email");
      return res.json(populated);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.patch(
  "/:id/assign-driver",
  protect,
  adminOnly,
  [
    param("id").isMongoId().withMessage("Invalid order id"),
    body("driverId").isMongoId().withMessage("Valid driver ID is required"),
    body("estimatedDeliveryTime").optional({ values: [null, ""] }).trim().custom((value) => {
      if (value && value.length < 1) {
        throw new Error("Invalid estimated time");
      }
      return true;
    })
  ],
  validate,
  async (req, res) => {
    try {
      const { driverId, estimatedDeliveryTime } = req.body;
      
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      const driver = await Driver.findById(driverId);
      if (!driver) return res.status(404).json({ message: "Driver not found" });

      if (driver.status !== "available") {
        return res.status(400).json({ message: "Driver is not available" });
      }

      // Calculate distance and ETA based on restaurant and delivery locations
      const restaurant = toLatLng(order.restaurantLocation);
      const userLocation = toLatLng(order.deliveryLocation);
      
      let etaValue = estimatedDeliveryTime;
      
      // If no manual ETA provided, calculate it automatically based on distance
      if (!etaValue && restaurant && userLocation) {
        const distanceKm = haversineDistanceKm(restaurant, userLocation);
        if (distanceKm) {
          const eta = calculateETA(distanceKm);
          etaValue = eta.formattedETA;
        }
      }
      
      order.driver = driverId;
      order.driverName = driver.name;
      order.driverPhone = driver.phone;
      order.driverLocation = {
        lat: Number(driver.currentLocation?.latitude || 0),
        lng: Number(driver.currentLocation?.longitude || 0)
      };
      order.status = "assigned";
      order.assignedAt = new Date();
      order.assignedExpiresAt = new Date(Date.now() + ASSIGNMENT_ACCEPT_WINDOW_MS);
      
      if (etaValue) {
        order.estimatedDeliveryTime = etaValue;
      }
      
      order.deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
      
      await order.save();

      driver.status = "busy";
      await driver.save();
      emitOrderTracking(req.app.get("io"), order);

      const populated = await order.populate("user", "name email phone");
      await populated.populate("driver", "name phone vehicleType");
      
      return res.json(populated);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.patch(
  "/:id/delivery-time",
  protect,
  adminOnly,
  [
    param("id").isMongoId().withMessage("Invalid order id"),
    body("estimatedDeliveryTime").trim().isLength({ min: 1 }).withMessage("Estimated time is required")
  ],
  validate,
  async (req, res) => {
    try {
      const { estimatedDeliveryTime } = req.body;
      
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });

      order.estimatedDeliveryTime = estimatedDeliveryTime;
      await order.save();

      return res.json(order);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.get(
  "/available-drivers",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const drivers = await Driver.find({ status: "available" });
      return res.json(drivers);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// AUTO-ASSIGN NEAREST DRIVER
// ============================================

router.post(
  "/:id/auto-assign-driver",
  protect,
  adminOnly,
  [param("id").isMongoId()],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.driver) return res.status(400).json({ message: "Order already has a driver" });

      const availableDrivers = await Driver.find({ status: "available" });
      if (availableDrivers.length === 0) return res.status(404).json({ message: "No available drivers" });

      const restaurant = toLatLng(order.restaurantLocation);
      if (!restaurant) return res.status(400).json({ message: "Restaurant location is missing on order" });

      let nearestDriver = null;
      let minDistance = Infinity;

      for (const driver of availableDrivers) {
        const distance = haversineDistanceKm(
          restaurant,
          {
            lat: Number(driver.currentLocation?.latitude || 0),
            lng: Number(driver.currentLocation?.longitude || 0)
          }
        );
        if (distance < minDistance) {
          minDistance = distance;
          nearestDriver = driver;
        }
      }

      if (!nearestDriver) return res.status(404).json({ message: "Could not find driver" });

      const { estimatedDeliveryTime } = req.body;
      
      // Calculate distance and ETA based on restaurant and delivery locations
      const userLocation = toLatLng(order.deliveryLocation);
      let etaValue = estimatedDeliveryTime;
      
      // If no manual ETA provided, calculate it automatically based on distance
      if (!etaValue && restaurant && userLocation) {
        const distanceKm = haversineDistanceKm(restaurant, userLocation);
        if (distanceKm) {
          const eta = calculateETA(distanceKm);
          etaValue = eta.formattedETA;
        }
      }
      
      order.driver = nearestDriver._id;
      order.driverName = nearestDriver.name;
      order.driverPhone = nearestDriver.phone;
      order.driverLocation = {
        lat: Number(nearestDriver.currentLocation?.latitude || 0),
        lng: Number(nearestDriver.currentLocation?.longitude || 0)
      };
      order.status = "assigned";
      order.assignedAt = new Date();
      order.assignedExpiresAt = new Date(Date.now() + ASSIGNMENT_ACCEPT_WINDOW_MS);
      if (etaValue) order.estimatedDeliveryTime = etaValue;
      order.deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
      await order.save();

      nearestDriver.status = "busy";
      await nearestDriver.save();
      emitOrderTracking(req.app.get("io"), order);

      const populated = await order.populate("user", "name email phone");
      await populated.populate("driver", "name phone vehicleType");
      return res.json({ message: `Driver ${nearestDriver.name} assigned (${minDistance.toFixed(2)} km)`, order: populated });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// REFUND MANAGEMENT
// ============================================

router.post(
  "/:id/refund",
  protect,
  adminOnly,
  [param("id").isMongoId(), body("refundAmount").isFloat({ min: 0 }), body("refundReason").trim()],
  validate,
  async (req, res) => {
    try {
      const { refundAmount, refundReason } = req.body;
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.paymentStatus === "refunded") return res.status(400).json({ message: "Already refunded" });
      if (refundAmount > order.totalPrice) return res.status(400).json({ message: "Amount exceeds total" });

      order.refundAmount = refundAmount;
      order.refundReason = refundReason;
      order.paymentStatus = "refunded";
      order.refundedAt = new Date();
      order.refundId = "REF-" + Math.random().toString(36).substr(2, 9).toUpperCase();
      await order.save();
      return res.json({ message: "Refund processed", order });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// SCHEDULED DELIVERY
// ============================================

router.patch(
  "/:id/schedule",
  protect,
  adminOnly,
  [param("id").isMongoId(), body("scheduledDate").isISO8601(), body("scheduledTimeSlot").trim()],
  validate,
  async (req, res) => {
    try {
      const { scheduledDate, scheduledTimeSlot } = req.body;
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      order.scheduledDelivery = { scheduledDate: new Date(scheduledDate), scheduledTimeSlot, isScheduled: true };
      await order.save();
      return res.json({ message: "Delivery scheduled", order });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.patch(
  "/:id/cancel-schedule",
  protect,
  adminOnly,
  [param("id").isMongoId()],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      order.scheduledDelivery = { scheduledDate: null, scheduledTimeSlot: null, isScheduled: false };
      await order.save();
      return res.json({ message: "Schedule cancelled", order });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// ORDER PRIORITY
// ============================================

router.patch(
  "/:id/priority",
  protect,
  adminOnly,
  [param("id").isMongoId(), body("priority").isIn(["low", "medium", "high", "urgent"])],
  validate,
  async (req, res) => {
    try {
      const { priority } = req.body;
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      order.priority = priority;
      await order.save();
      return res.json({ message: "Priority updated", order });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// CUSTOMER CHAT ENDPOINTS
// ============================================

router.post(
  "/:id/chat",
  protect,
  [
    param("id").isMongoId().withMessage("Invalid order id"),
    body("message").trim().isLength({ min: 1 }).withMessage("Message is required")
  ],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      if (order.user.toString() !== req.user.id) {
        return res.status(403).json({ message: "Not authorized to chat for this order" });
      }
      
      if (!order.driver) {
        return res.status(400).json({ message: "No driver assigned to this order yet" });
      }
      
      // Allow chat when driver has picked up the order
      if (!["picked", "picked_up", "out_for_delivery"].includes(order.status)) {
        return res.status(400).json({ message: "Chat is only available after driver picks up your order" });
      }
      
      const { message } = req.body;
      if (!order.chatMessages) order.chatMessages = [];
      order.chatMessages.push({ 
        sender: "customer", 
        senderName: req.user.name || "Customer", 
        message, 
        sentAt: new Date(),
        recipient: "driver"
      });
      await order.save();
      
      const Driver = require("../models/Driver");
      const driver = await Driver.findById(order.driver);
      if (driver) {
        if (!driver.notifications) driver.notifications = [];
        driver.notifications.push({
          orderId: order._id,
          message: message,
          sender: "customer",
          senderName: req.user.name || "Customer",
          isRead: false,
          createdAt: new Date()
        });
        await driver.save();
      }
      
      return res.json({ message: "Message sent to driver", chatMessages: order.chatMessages });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.get(
  "/:id/chat",
  protect,
  [param("id").isMongoId().withMessage("Invalid order id")],
  validate,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.id);
      if (!order) return res.status(404).json({ message: "Order not found" });
      
      if (order.user.toString() !== req.user.id) {
        return res.status(403).json({ message: "Not authorized to view chat for this order" });
      }
      
      let driverInfo = null;
      if (order.driver) {
        const driver = await Driver.findById(order.driver);
        if (driver) {
          driverInfo = { name: driver.name, phone: driver.phone };
        }
      }
      
      return res.json({ 
        chatMessages: order.chatMessages || [],
        driver: driverInfo,
        hasDriver: !!order.driver
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// ============================================
// CUSTOMER NOTIFICATION ENDPOINTS
// ============================================

router.get(
  "/notifications",
  protect,
  async (req, res) => {
    try {
      const User = require("../models/User");
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      
      const notifications = (user.notifications || []).sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
      );
      
      const unreadCount = notifications.filter(n => !n.isRead).length;
      
      return res.json({ 
        notifications,
        unreadCount
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.put(
  "/notifications/read",
  protect,
  async (req, res) => {
    try {
      const User = require("../models/User");
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      
      if (user.notifications) {
        user.notifications.forEach(n => {
          n.isRead = true;
        });
        await user.save();
      }
      
      return res.json({ message: "All notifications marked as read" });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.put(
  "/notifications/:notificationId/read",
  protect,
  async (req, res) => {
    try {
      const User = require("../models/User");
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: "User not found" });
      
      const notification = user.notifications?.find(n => n._id.toString() === req.params.notificationId);
      if (notification) {
        notification.isRead = true;
        await user.save();
      }
      
      return res.json({ message: "Notification marked as read" });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;    






