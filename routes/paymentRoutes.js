const express = require("express");
const { body, param } = require("express-validator");
const Payment = require("../models/Payment");
const Order = require("../models/Order");
const { protect, adminOnly } = require("../middleware/auth");
const { validate } = require("../middleware/validate");

const router = express.Router();

// Mock payment processing function (simulates real payment gateway)
const processPayment = async (paymentDetails) => {
  // Simulate payment processing delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Simulate success/failure based on card number
  const { cardNumber, amount } = paymentDetails;
  
  // Mock: Cards starting with 4000 succeed, others fail
  if (cardNumber && cardNumber.startsWith("4000")) {
    return {
      success: true,
      transactionId: "TXN-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9).toUpperCase(),
      cardLast4: cardNumber.slice(-4),
      cardBrand: detectCardBrand(cardNumber)
    };
  } else if (cardNumber === "5000") {
    // Simulate insufficient funds
    return {
      success: false,
      failureReason: "Insufficient funds"
    };
  } else if (cardNumber === "4000") {
    return {
      success: true,
      transactionId: "TXN-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9).toUpperCase(),
      cardLast4: "0000",
      cardBrand: "Visa"
    };
  }
  
  return {
    success: false,
    failureReason: "Payment declined"
  };
};

// Detect card brand from card number
const detectCardBrand = (cardNumber) => {
  if (!cardNumber) return "Unknown";
  const firstDigit = cardNumber[0];
  const firstTwo = cardNumber.substring(0, 2);
  
  if (firstDigit === "4") return "Visa";
  if (firstTwo >= "51" && firstTwo <= "55") return "Mastercard";
  if (firstTwo === "34" || firstTwo === "37") return "Amex";
  if (firstTwo === "60" || firstTwo === "65") return "Discover";
  
  return "Unknown";
};

// Create payment for an order
router.post(
  "/",
  protect,
  [
    body("orderId").isMongoId().withMessage("orderId is required"),
    body("paymentMethod").isIn(["card", "upi", "netbanking", "wallet", "cod"]).withMessage("Invalid payment method"),
    body("cardNumber").optional().isLength({ min: 13, max: 19 }).withMessage("Invalid card number"),
    body("cardExpiry").optional().isLength({ min: 5, max: 5 }).withMessage("Invalid expiry format (MM/YY)"),
    body("cardCvv").optional().isLength({ min: 3, max: 4 }).withMessage("Invalid CVV"),
    body("upiId").optional().isEmail().withMessage("Invalid UPI ID")
  ],
  validate,
  async (req, res) => {
    try {
      const { orderId, paymentMethod, cardNumber, cardExpiry, cardCvv, upiId } = req.body;
      
      // Find the order
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Check if order belongs to user
      if (order.user.toString() !== req.user.id) {
        return res.status(403).json({ message: "Not authorized to pay for this order" });
      }
      
      // Check if order is already paid
      const existingPayment = await Payment.findOne({ order: orderId, status: "completed" });
      if (existingPayment) {
        return res.status(400).json({ message: "Order is already paid" });
      }
      
      // Process payment based on method
      let paymentResult;
      
      if (paymentMethod === "card") {
        paymentResult = await processPayment({
          cardNumber,
          amount: order.totalPrice
        });
      } else if (paymentMethod === "upi") {
        // Mock UPI payment
        await new Promise(resolve => setTimeout(resolve, 800));
        paymentResult = {
          success: true,
          transactionId: "UPI-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9).toUpperCase()
        };
      } else if (paymentMethod === "netbanking") {
        // Mock Netbanking payment
        await new Promise(resolve => setTimeout(resolve, 800));
        paymentResult = {
          success: true,
          transactionId: "NB-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9).toUpperCase()
        };
      } else if (paymentMethod === "wallet") {
        // Mock Wallet payment
        await new Promise(resolve => setTimeout(resolve, 500));
        paymentResult = {
          success: true,
          transactionId: "WALLET-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9).toUpperCase()
        };
      } else if (paymentMethod === "cod") {
        // Cash on Delivery - no immediate payment required
        await new Promise(resolve => setTimeout(resolve, 300));
        paymentResult = {
          success: true,
          transactionId: "COD-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9).toUpperCase()
        };
      }
      
      // Create payment record
      const payment = await Payment.create({
        order: orderId,
        user: req.user.id,
        amount: order.totalPrice,
        paymentMethod,
        status: paymentResult.success ? "completed" : "failed",
        transactionId: paymentResult.transactionId,
        cardLast4: paymentResult.cardLast4,
        cardBrand: paymentResult.cardBrand,
        failureReason: paymentResult.failureReason,
        codConfirmed: paymentMethod === "cod" ? true : false
      });
      
      if (!paymentResult.success) {
        // Update order payment status on failure
        order.paymentStatus = "failed";
        await order.save();
        return res.status(400).json({ 
          message: "Payment failed: " + paymentResult.failureReason,
          payment 
        });
      }
      
      // Update order status and payment status based on payment method
      if (paymentMethod === "cod") {
        // For COD, order stays pending until delivery
        order.status = "pending";
        order.paymentStatus = "pending"; // Will be collected on delivery
      } else {
        order.status = "confirmed";
        order.paymentStatus = "paid";
      }
      await order.save();
      
      return res.status(201).json(payment);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// Confirm COD payment (called when delivery person collects payment)
router.post(
  "/cod/confirm/:orderId",
  protect,
  async (req, res) => {
    try {
      const order = await Order.findById(req.params.orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Check if order belongs to user or user is admin
      if (order.user.toString() !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      const payment = await Payment.findOne({ order: order._id, paymentMethod: "cod" });
      if (!payment) {
        return res.status(404).json({ message: "COD payment not found" });
      }
      
      // Mark COD as confirmed
      payment.status = "completed";
      payment.codConfirmed = true;
      await payment.save();
      
      // Update order payment status
      order.paymentStatus = "paid";
      await order.save();
      
      return res.json(payment);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// Get payment details for an order
router.get(
  "/order/:orderId",
  protect,
  [param("orderId").isMongoId().withMessage("Invalid order id")],
  validate,
  async (req, res) => {
    try {
      const payment = await Payment.findOne({ order: req.params.orderId });
      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }
      
      // Check authorization
      if (payment.user.toString() !== req.user.id && req.user.role !== "admin") {
        return res.status(403).json({ message: "Not authorized" });
      }
      
      return res.json(payment);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// Get payment history for current user
router.get("/my", protect, async (req, res) => {
  try {
    const payments = await Payment.find({ user: req.user.id })
      .populate("order")
      .sort({ createdAt: -1 });
    return res.json(payments);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Admin: Get all payments
router.get("/admin/all", protect, adminOnly, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    
    const payments = await Payment.find(filter)
      .populate("user", "name email")
      .populate({
        path: "order",
        populate: { path: "items.menuItem" }
      })
      .sort({ createdAt: -1 });
    
    return res.json(payments);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Admin: Process refund
router.post(
  "/:id/refund",
  protect,
  adminOnly,
  [param("id").isMongoId().withMessage("Invalid payment id")],
  validate,
  async (req, res) => {
    try {
      const payment = await Payment.findById(req.params.id);
      if (!payment) {
        return res.status(404).json({ message: "Payment not found" });
      }
      
      if (payment.status !== "completed") {
        return res.status(400).json({ message: "Only completed payments can be refunded" });
      }
      
      // Process mock refund
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      payment.status = "refunded";
      payment.transactionId = "REF-" + payment.transactionId;
      await payment.save();
      
      // Update order payment status to refunded
      const order = await Order.findById(payment.order);
      if (order) {
        order.paymentStatus = "refunded";
        await order.save();
      }
      
      return res.json(payment);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;
