const mongoose = require("mongoose");

const normalizeOrderStatus = (status) => {
  if (["pending", "confirmed"].includes(status)) return "confirmed";
  if (["assigned", "accepted"].includes(status)) return "driver_assigned";
  if (status === "picked") return "picked_up";
  if (status === "out_for_delivery") return "out_for_delivery";
  if (status === "delivered") return "delivered";
  if (status === "cancelled") return "cancelled";
  return "confirmed";
};

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    items: [
      {
        menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem", required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        quantity: { type: Number, required: true, min: 1 },
        unit: { type: String, default: "pieces" }
      }
    ],
    totalPrice: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "confirmed", "assigned", "accepted", "picked", "out_for_delivery", "delivered", "cancelled"],
      default: "pending"
    },
    orderStatus: {
      type: String,
      enum: ["confirmed", "driver_assigned", "picked_up", "out_for_delivery", "delivered", "cancelled"],
      default: "confirmed"
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending"
    },
    address: { type: String, required: true },
    phone: { type: String },
    
    // Driver assignment fields
    driver: { type: mongoose.Schema.Types.ObjectId, ref: "Driver" },
    driverName: { type: String },
    driverPhone: { type: String },
    assignedExpiresAt: { type: Date },
    
    // Delivery confirmation
    deliveryOtp: { type: String },
    deliveredAt: { type: Date },
    
    // Delivery status timestamps
    assignedAt: { type: Date },
    acceptedAt: { type: Date },
    pickedAt: { type: Date },
    
    // Delivery details
    deliveryNotes: { type: String },
    estimatedDeliveryTime: { type: String },
    
    // Driver earnings
    deliveryFee: { type: Number, default: 0 },
    driverEarning: { type: Number, default: 0 },
    
    // Order rejection
    rejectReason: { type: String },
    rejectedAt: { type: Date },
    
    // Delivery location for map display
    userLocation: {
      lat: { type: Number },
      lng: { type: Number }
    },
    driverLocation: {
      lat: { type: Number },
      lng: { type: Number }
    },
    deliveryLocation: {
      latitude: { type: Number },
      longitude: { type: Number }
    },
    restaurantLocation: {
      lat: { type: Number },
      lng: { type: Number },
      latitude: { type: Number },
      longitude: { type: Number }
    },
    
    // Chat messages between driver and customer/admin
    chatMessages: [{
      sender: { type: String, enum: ["driver", "customer", "admin"] },
      senderName: { type: String },
      message: { type: String },
      sentAt: { type: Date, default: Date.now },
      recipient: { type: String }
    }],
    
    // Delivery issues reported
    issues: [{
      reportedBy: { type: String, enum: ["driver", "customer"] },
      driverName: { type: String },
      issueType: { type: String },
      description: { type: String },
      reportedAt: { type: Date },
      status: { type: String, enum: ["open", "resolved"], default: "open" }
    }],
    
    // Priority tagging
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium"
    },
    
    // Scheduled delivery
    scheduledDelivery: {
      scheduledDate: { type: Date },
      scheduledTimeSlot: { type: String }, // e.g., "10:00 AM - 12:00 PM"
      isScheduled: { type: Boolean, default: false }
    },
    
    // Refund management
    refundAmount: { type: Number, default: 0 },
    refundReason: { type: String },
    refundedAt: { type: Date },
    refundId: { type: String },

    // Customer review and rating
    customerReview: {
      rating: { type: Number, min: 1, max: 5 },
      comment: { type: String },
      reviewedAt: { type: Date }
    },

    // Cancellation metadata
    cancellation: {
      cancelledBy: { type: String, enum: ["customer", "driver", "admin", "system"] },
      reason: { type: String },
      cancelledAt: { type: Date }
    }
  },
  { timestamps: true }
);

orderSchema.pre("save", function normalizeGeoAndOrderStatus(next) {
  this.orderStatus = normalizeOrderStatus(this.status);

  if (this.deliveryLocation?.latitude != null && this.deliveryLocation?.longitude != null) {
    this.userLocation = {
      lat: this.deliveryLocation.latitude,
      lng: this.deliveryLocation.longitude
    };
  }

  if (this.userLocation?.lat != null && this.userLocation?.lng != null) {
    this.deliveryLocation = {
      latitude: this.userLocation.lat,
      longitude: this.userLocation.lng
    };
  }

  if (this.restaurantLocation?.latitude != null && this.restaurantLocation?.longitude != null) {
    this.restaurantLocation.lat = this.restaurantLocation.latitude;
    this.restaurantLocation.lng = this.restaurantLocation.longitude;
  }

  if (this.restaurantLocation?.lat != null && this.restaurantLocation?.lng != null) {
    this.restaurantLocation.latitude = this.restaurantLocation.lat;
    this.restaurantLocation.longitude = this.restaurantLocation.lng;
  }

  next();
});

module.exports = mongoose.model("Order", orderSchema);
