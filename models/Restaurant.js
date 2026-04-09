const mongoose = require("mongoose");

const restaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    address: { type: String, default: "" },
    location: {
      lat: { type: Number },
      lng: { type: Number }
    },
    image: { type: String, default: "" },
    cuisine: { type: String, required: true },
    rating: { type: Number, default: 4.5 },
    deliveryTime: { type: String, default: "30-40 min" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Restaurant", restaurantSchema);
