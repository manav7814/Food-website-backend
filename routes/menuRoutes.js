const express = require("express");
const { body, param, query } = require("express-validator");
const MenuItem = require("../models/MenuItem");
const Banner = require("../models/Banner");
const { protect, adminOnly } = require("../middleware/auth");
const { validate } = require("../middleware/validate");

const router = express.Router();

const validUnits = ["pieces", "kg", "pack", "liter", "glass", "plate", "bowl","medium","large"];

// ============================================
// PUBLIC BANNERS ENDPOINT
// ============================================

// Get active banners for customers
router.get(
  "/banners",
  async (req, res) => {
    try {
      const now = new Date();
      const banners = await Banner.find({
        isActive: true,
        $or: [
          { startDate: { $lte: now }, endDate: { $gte: now } },
          { startDate: { $exists: false }, endDate: { $exists: false } },
          { startDate: null, endDate: null }
        ]
      }).sort({ position: 1, createdAt: -1 });
      
      return res.json(banners);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.get(
  "/",
  [
    query("restaurantId").optional().trim().isMongoId().withMessage("restaurantId must be valid"),
    query("category").optional().trim().isLength({ min: 2 }).withMessage("category is invalid")
  ],
  validate,
  async (req, res) => {
  try {
    const { restaurantId, category } = req.query;
    const filter = {};
    if (restaurantId) filter.restaurant = restaurantId;
    if (category) filter.category = category;
    const menu = await MenuItem.find(filter).populate("restaurant", "name cuisine").sort({ createdAt: -1 });
    return res.json(menu);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post(
  "/",
  protect,
  adminOnly,
  [
    body("restaurant").trim().isMongoId().withMessage("restaurant is required"),
    body("name").trim().isLength({ min: 2 }).withMessage("name is required"),
    body("category").optional().trim().isLength({ min: 2 }).withMessage("category is invalid"),
    body("description").optional().trim().isLength({ max: 250 }).withMessage("description is too long"),
    body("price").isFloat({ gt: 0 }).withMessage("price must be greater than 0"),
    body("image").optional().trim().isURL().withMessage("image must be a valid URL"),
    body("quantity").optional().isInt({ min: 0 }).withMessage("quantity must be 0 or more"),
    body("unit").optional().isIn(validUnits).withMessage("unit must be one of: " + validUnits.join(", "))
  ],
  validate,
  async (req, res) => {
  try {
    const { restaurant, name, category, description, price, image, quantity, unit } = req.body;

    const item = await MenuItem.create({
      restaurant,
      name,
      category: category || "Other",
      description: description || "",
      price: Number(price),
      image: image || "",
      quantity: quantity !== undefined ? Number(quantity) : 100,
      unit: unit || "pieces"
    });

    const populated = await item.populate("restaurant", "name cuisine");
    return res.status(201).json(populated);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.put(
  "/:id",
  protect,
  adminOnly,
  [
    param("id").isMongoId().withMessage("Invalid menu item id"),
    body("restaurant").optional().trim().isMongoId().withMessage("restaurant is invalid"),
    body("name").optional().trim().isLength({ min: 2 }).withMessage("name is invalid"),
    body("category").optional().trim().isLength({ min: 2 }).withMessage("category is invalid"),
    body("description").optional().trim().isLength({ max: 250 }).withMessage("description is too long"),
    body("price").optional().isFloat({ gt: 0 }).withMessage("price must be greater than 0"),
    body("image").optional().trim().isURL().withMessage("image must be a valid URL"),
    body("quantity").optional().isInt({ min: 0 }).withMessage("quantity must be 0 or more"),
    body("unit").optional().isIn(validUnits).withMessage("unit must be one of: " + validUnits.join(", "))
  ],
  validate,
  async (req, res) => {
  try {
    const { restaurant, name, category, description, price, image, quantity, unit } = req.body;
    const item = await MenuItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: "Menu item not found" });

    if (restaurant) item.restaurant = restaurant;
    if (name) item.name = name;
    if (category) item.category = category;
    if (description !== undefined) item.description = description;
    if (price !== undefined) item.price = Number(price);
    if (image !== undefined) item.image = image;
    if (quantity !== undefined) item.quantity = Number(quantity);
    if (unit) item.unit = unit;

    await item.save();
    const populated = await item.populate("restaurant", "name cuisine");
    return res.json(populated);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.delete(
  "/:id",
  protect,
  adminOnly,
  [param("id").isMongoId().withMessage("Invalid menu item id")],
  validate,
  async (req, res) => {
    try {
      const deleted = await MenuItem.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ message: "Menu item not found" });
      return res.json({ message: "Menu item deleted" });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;
