const express = require("express");
const { body, param } = require("express-validator");
const Restaurant = require("../models/Restaurant");
const SystemSettings = require("../models/SystemSettings");
const { protect, adminOnly } = require("../middleware/auth");
const { validate } = require("../middleware/validate");

const router = express.Router();

router.get("/delivery-config", async (_req, res) => {
  try {
    const defaults = {
      lat: Number(process.env.RESTAURANT_LAT || 23.0225),
      lng: Number(process.env.RESTAURANT_LNG || 72.5714),
      radiusKm: Number(process.env.DELIVERY_RADIUS_KM || 30)
    };

    const setting = await SystemSettings.findOne({
      key: "RESTAURANT_DELIVERY_CONFIG"
    });
    const value = setting?.value || {};

    const lat = Number(value.lat);
    const lng = Number(value.lng);
    const radiusKm = Number(value.radiusKm);

    return res.json({
      lat: Number.isFinite(lat) ? lat : defaults.lat,
      lng: Number.isFinite(lng) ? lng : defaults.lng,
      radiusKm: Number.isFinite(radiusKm) ? radiusKm : defaults.radiusKm
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get("/", async (_req, res) => {
  try {
    const restaurants = await Restaurant.find().sort({ createdAt: -1 });
    return res.json(restaurants);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post(
  "/",
  protect,
  adminOnly,
  [
    body("name").trim().isLength({ min: 2 }).withMessage("name is required"),
    body("cuisine").trim().isLength({ min: 2 }).withMessage("cuisine is required"),
    body("address")
      .optional({ checkFalsy: true })
      .trim()
      .isLength({ min: 2 })
      .withMessage("address is invalid"),
    body("location.lat").optional().isFloat({ min: -90, max: 90 }).withMessage("location latitude is invalid"),
    body("location.lng").optional().isFloat({ min: -180, max: 180 }).withMessage("location longitude is invalid"),
    body("image").optional().trim().isURL().withMessage("image must be a valid URL"),
    body("rating").optional().isFloat({ min: 0, max: 5 }).withMessage("rating must be between 0 and 5"),
    body("deliveryTime").optional().trim().isLength({ min: 1 }).withMessage("deliveryTime is invalid")
  ],
  validate,
  async (req, res) => {
    try {
      const { name, cuisine, address, location, image, rating, deliveryTime } = req.body;

      const restaurant = await Restaurant.create({
        name,
        cuisine,
        address: address || "",
        location:
          location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))
            ? {
                lat: Number(location.lat),
                lng: Number(location.lng)
              }
            : undefined,
        image: image || "",
        rating: rating || 4.5,
        deliveryTime: deliveryTime || "30-40 min"
      });

      return res.status(201).json(restaurant);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.put(
  "/:id",
  protect,
  adminOnly,
  [param("id").isMongoId().withMessage("Invalid restaurant id")],
  validate,
  async (req, res) => {
    try {
      const { name, cuisine, address, location, image, rating, deliveryTime } = req.body;
      const restaurant = await Restaurant.findById(req.params.id);
      
      if (!restaurant) {
        return res.status(404).json({ message: "Restaurant not found" });
      }

      if (name) restaurant.name = name;
      if (cuisine) restaurant.cuisine = cuisine;
      if (address !== undefined) restaurant.address = address;
      if (location !== undefined) {
        if (
          location &&
          Number.isFinite(Number(location.lat)) &&
          Number.isFinite(Number(location.lng))
        ) {
          restaurant.location = {
            lat: Number(location.lat),
            lng: Number(location.lng)
          };
        } else {
          restaurant.location = undefined;
        }
      }
      if (image !== undefined) restaurant.image = image;
      if (rating !== undefined) restaurant.rating = rating;
      if (deliveryTime) restaurant.deliveryTime = deliveryTime;

      await restaurant.save();
      return res.json(restaurant);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.delete(
  "/:id",
  protect,
  adminOnly,
  [param("id").isMongoId().withMessage("Invalid restaurant id")],
  validate,
  async (req, res) => {
    try {
      const deleted = await Restaurant.findByIdAndDelete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ message: "Restaurant not found" });
      }
      return res.json({ message: "Restaurant deleted" });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;
