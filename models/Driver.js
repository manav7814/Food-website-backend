const mongoose = require("mongoose");

const driverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  phone: {
    type: String,
    required: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  vehicleType: {
    type: String,
    enum: ["bike", "scooter", "car", "van"],
    default: "bike"
  },
  vehicleNumber: {
    type: String,
    required: true
  },
  licenseNumber: {
    type: String,
    required: true
  },
  
  // Document uploads
  documents: {
    licenseImage: { type: String },
    vehicleImage: { type: String },
    insuranceImage: { type: String },
    uploadedAt: { type: Date }
  },
  
  // KYC Documents
  kyc: {
    aadharCard: { type: String },
    panCard: { type: String },
    photo: { type: String },
    uploadedAt: { type: Date },
    status: { 
      type: String, 
      enum: ["pending", "approved", "rejected"], 
      default: "pending" 
    },
    rejectedReason: { type: String },
    verifiedAt: { type: Date }
  },
  
  // Account status
  status: {
    type: String,
    enum: ["available", "busy", "offline", "blocked", "suspended"],
    default: "available"
  },
  
  // Suspension/Block reason
  suspensionReason: { type: String },
  suspendedAt: { type: Date },
  blockedAt: { type: Date },
  
  currentLocation: {
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 }
  },
  
  isVerified: {
    type: Boolean,
    default: false
  },
  
  // Performance metrics
  rating: {
    type: Number,
    default: 5.0
  },
  totalDeliveries: {
    type: Number,
    default: 0
  },
  completedDeliveries: {
    type: Number,
    default: 0
  },
  cancelledDeliveries: {
    type: Number,
    default: 0
  },
  averageDeliveryTime: {
    type: Number,
    default: 0
  },
  
  // Earnings
  walletBalance: {
    type: Number,
    default: 0
  },
  totalEarnings: {
    type: Number,
    default: 0
  },
  pendingWithdrawal: {
    type: Number,
    default: 0
  },
  earningsHistory: [{
    date: { type: Date },
    amount: { type: Number },
    type: { type: String, enum: ["delivery", "bonus", "penalty", "withdrawal"] },
    description: { type: String },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" }
  }],
  bonuses: {
    type: Number,
    default: 0
  },
  penalties: {
    type: Number,
    default: 0
  },
  
  // Withdrawal requests
  withdrawalRequests: [{
    amount: { type: Number },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    bankAccount: { type: String },
    upiId: { type: String }
  }],
  
  // SOS Emergency History
  sosHistory: [{
    location: {
      latitude: { type: Number },
      longitude: { type: Number }
    },
    description: { type: String },
    triggeredAt: { type: Date },
    status: { type: String, enum: ["active", "resolved"], default: "active" }
  }],
  
  // Notifications for chat messages
  notifications: [{
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    message: { type: String },
    sender: { type: String, enum: ["customer", "admin"] },
    senderName: { type: String },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model("Driver", driverSchema);
