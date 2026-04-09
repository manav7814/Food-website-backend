const mongoose = require("mongoose");

const menuItemSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Restaurant",
      required: true
    },
    name: { type: String, required: true },
    category: { type: String, default: "Other" },
    description: { type: String, default: "" },
    price: { type: Number, required: true },
    image: { type: String, default: "" },
    quantity: { type: Number, default: 100, min: 0 },
    unit: { 
      type: String, 
      enum: ["pieces", "kg", "pack", "liter", "glass", "plate", "bowl", "medium", "large"], 
      default: "pieces" 
    },
    // Category visibility toggle
    isVisible: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("MenuItem", menuItemSchema);
