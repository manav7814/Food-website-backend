const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        "CREATE",
        "UPDATE",
        "DELETE",
        "LOGIN",
        "LOGOUT",
        "MAINTENANCE_MODE",
        "BROADCAST_NOTIFICATION",
        "ROLE_CHANGE",
        "BANNER_CHANGE",
        "OFFER_CHANGE",
        "CATEGORY_VISIBILITY"
      ]
    },
    entityType: {
      type: String,
      required: true,
      enum: [
        "USER",
        "DRIVER",
        "ORDER",
        "MENU_ITEM",
        "RESTAURANT",
        "BANNER",
        "OFFER",
        "SYSTEM",
        "ROLE"
      ]
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId
    },
    description: {
      type: String,
      required: true
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    performedByName: {
      type: String
    },
    performedByRole: {
      type: String
    },
    previousValue: {
      type: mongoose.Schema.Types.Mixed
    },
    newValue: {
      type: mongoose.Schema.Types.Mixed
    },
    ipAddress: {
      type: String
    },
    userAgent: {
      type: String
    }
  },
  { timestamps: true }
);

// Index for efficient querying
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ performedBy: 1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ entityType: 1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
