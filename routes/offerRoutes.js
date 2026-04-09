const express = require("express");
const Offer = require("../models/Offer");

const router = express.Router();

// Get all active and valid offers for customers (public endpoint)
router.get("/", async (req, res) => {
  try {
    const now = new Date();
    
    // Find offers that are:
    // 1. Active
    // 2. Within the valid date range
    // 3. Have not exceeded usage limit (if set)
    const offers = await Offer.find({
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
      $or: [
        { usageLimit: { $exists: false } },
        { usageLimit: null },
        { $expr: { $lt: ["$usageCount", "$usageLimit"] } }
      ]
    })
      .select("code name description discountType discountValue minOrderValue maxDiscountValue")
      .sort({ createdAt: -1 });
    
    res.json(offers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Validate offer (public endpoint for customers)
router.post("/validate", async (req, res) => {
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
        message: `Minimum order value of ₹${offer.minOrderValue} required`, 
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
        _id: offer._id,
        code: offer.code,
        name: offer.name,
        description: offer.description,
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        minOrderValue: offer.minOrderValue,
        maxDiscountValue: offer.maxDiscountValue,
        discount: discount.toFixed(2)
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
