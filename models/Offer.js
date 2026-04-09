const mongoose = require("mongoose");

const offerSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      unique: true
    },
    name: {
      type: String,
      required: true
    },
    description: {
      type: String,
      default: ""
    },
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0
    },
    minOrderValue: {
      type: Number,
      default: 0
    },
    maxDiscountValue: {
      type: Number,
      default: null
    },
    applicableCategories: [{
      type: String
    }],
    applicableMenuItems: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "MenuItem"
    }],
    usageLimit: {
      type: Number,
      default: null // null means unlimited
    },
    usageCount: {
      type: Number,
      default: 0
    },
    userUsageLimit: {
      type: Number,
      default: 1
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    isPublic: {
      type: Boolean,
      default: true // Can be used by anyone with the code
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  { timestamps: true }
);

// Index for efficient querying
offerSchema.index({ isActive: 1, startDate: 1, endDate: 1 });

module.exports = mongoose.model("Offer", offerSchema);
