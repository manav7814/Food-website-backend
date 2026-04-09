const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { 
      type: String, 
      enum: ["customer", "admin", "super_admin", "manager"], 
      default: "customer" 
    },
    // For tracking user usage of offers
    offerUsage: [{
      offerId: { type: mongoose.Schema.Types.ObjectId, ref: "Offer" },
      usedAt: { type: Date, default: Date.now }
    }],
    // Notifications for chat messages
    notifications: [{
      orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
      message: { type: String },
      sender: { type: String, enum: ["driver", "admin"] },
      senderName: { type: String },
      isRead: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now }
    }]
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
