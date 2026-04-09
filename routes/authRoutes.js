const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { body } = require("express-validator");
const User = require("../models/User");
const Driver = require("../models/Driver");
const { validate } = require("../middleware/validate");
const { protect, adminOnly } = require("../middleware/auth");

const router = express.Router();

const createToken = (user) =>
  jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d"
  });

router.post(
  "/register",
  [
    body("name").trim().isLength({ min: 2 }).withMessage("Name must be at least 2 characters"),
    body("email").trim().isEmail().withMessage("Valid email is required").normalizeEmail(),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters")
  ],
  validate,
  async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashedPassword });
    const token = createToken(user);

    return res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post(
  "/login",
  [
    body("email").trim().isEmail().withMessage("Valid email is required").normalizeEmail(),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters")
  ],
  validate,
  async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ 
        message: "No account found with this email. Please register or check your email address.",
        code: "USER_NOT_FOUND"
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ 
        message: "Invalid password. Please check your credentials.",
        code: "INVALID_PASSWORD"
      });
    }

    // Check if user is trying to access admin areas but is not an admin
    // This is handled on the frontend and route protection, but we can allow the login
    
    const token = createToken(user);
    return res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Driver Registration - SIMPLIFIED VALIDATION
router.post(
  "/driver/register",
  [
    body("name").notEmpty().trim().withMessage("Name is required"),
    body("email").isEmail().trim().withMessage("Valid email is required"),
    body("password").notEmpty().withMessage("Password is required"),
    body("phone").notEmpty().trim().withMessage("Phone is required"),
    body("vehicleNumber").notEmpty().trim().withMessage("Vehicle number is required"),
    body("licenseNumber").notEmpty().trim().withMessage("License number is required")
  ],
  validate,
  async (req, res) => {
    try {
      console.log("DRIVER REGISTER called with:", req.body);
      const { name, email, password, phone, vehicleType, vehicleNumber, licenseNumber } = req.body;
      
      // Check if user already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) return res.status(400).json({ message: "Email already exists" });
      
      // Check if driver already exists
      const existingDriver = await Driver.findOne({ email });
      if (existingDriver) return res.status(400).json({ message: "Driver with this email already exists" });

      // Create user account
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await User.create({ name, email, password: hashedPassword, role: "customer" });
      
      // Create driver profile linked to user
      const driver = await Driver.create({
        name,
        email,
        phone,
        vehicleType: vehicleType || "bike",
        vehicleNumber,
        licenseNumber,
        status: "available",
        isVerified: false, // Requires admin approval
        user: user._id
      });

      const token = createToken(user);
      return res.status(201).json({
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role },
        driver: { id: driver._id, status: driver.status, message: "Registration pending approval" }
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// Driver Login
router.post(
  "/driver/login",
  [
    body("email").trim().isEmail().withMessage("Valid email is required").normalizeEmail(),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters")
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      
      // Find driver by email
      const driver = await Driver.findOne({ email });
      if (!driver) {
        return res.status(400).json({ 
          message: "No driver account found with this email. Please register first.",
          code: "DRIVER_NOT_FOUND"
        });
      }

      // Check if driver is blocked
      if (driver.status === "blocked") {
        return res.status(403).json({ 
          message: "Your driver account has been blocked. Please contact support.",
          code: "DRIVER_BLOCKED"
        });
      }

      // Check if driver is suspended
      if (driver.status === "suspended") {
        return res.status(403).json({ 
          message: `Your driver account is suspended. Reason: ${driver.suspensionReason || "Please contact support"}`,
          code: "DRIVER_SUSPENDED"
        });
      }

      // Check if driver is approved
      if (!driver.isVerified) {
        return res.status(403).json({ 
          message: "Your driver account is pending approval. Please wait for admin to approve your registration.",
          code: "DRIVER_PENDING_APPROVAL",
          driverStatus: "pending"
        });
      }

      // Find the linked user account or create one if it doesn't exist
      let user = await User.findById(driver.user);
      
      if (!user) {
        // Create a user account for this driver (for admin-created drivers)
        const hashedPassword = await bcrypt.hash(password, 10);
        user = await User.create({
          name: driver.name,
          email: driver.email,
          password: hashedPassword,
          role: "driver"
        });
        
        // Link driver to user
        driver.user = user._id;
        await driver.save();
      }

      // Verify password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ 
          message: "Invalid password. Please check your credentials.",
          code: "INVALID_PASSWORD"
        });
      }

      const token = createToken(user);
      return res.json({
        token,
        user: { id: user._id, name: user.name, email: user.email, role: "driver" },
        driver: { 
          id: driver._id, 
          name: driver.name,
          phone: driver.phone,
          vehicleType: driver.vehicleType,
          vehicleNumber: driver.vehicleNumber,
          status: driver.status,
          rating: driver.rating,
          totalDeliveries: driver.totalDeliveries
        }
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

router.post(
  "/bootstrap-admin",
  [
    body("name").trim().isLength({ min: 2 }).withMessage("Name must be at least 2 characters"),
    body("email").trim().isEmail().withMessage("Valid email is required").normalizeEmail(),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body("setupKey").trim().notEmpty().withMessage("Admin setup key is required")
  ],
  validate,
  async (req, res) => {
  try {
    const { name, email, password, setupKey } = req.body;
    console.log("Admin setup attempt:", { name, email, setupKey });

    // Accept both environment variable and fallback key "admin123"
    const validKey = process.env.ADMIN_SETUP_KEY || "admin123";
    console.log("Valid key:", validKey, "Provided:", setupKey);
    
    if (setupKey !== validKey) {
      console.log("Key mismatch!");
      return res.status(403).json({ message: "Invalid admin setup key" });
    }

    let user = await User.findOne({ email });
    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await User.create({ name, email, password: hashedPassword, role: "admin" });
    } else {
      user.name = name;
      user.role = "admin";
      if (password) {
        user.password = await bcrypt.hash(password, 10);
      }
      await user.save();
    }

    const token = createToken(user);
    return res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

// Admin Login - Simple login for existing admins
router.post(
  "/admin/login",
  [
    body("email").trim().isEmail().withMessage("Valid email is required").normalizeEmail(),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters")
  ],
  validate,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      
      const user = await User.findOne({ email });
      if (!user) {
        return res.status(400).json({ 
          message: "No account found with this email.",
          code: "USER_NOT_FOUND"
        });
      }

      // Check if user is admin
      if (user.role !== "admin" && user.role !== "super_admin") {
        return res.status(403).json({ 
          message: "This account is not an admin account. Use the setup page to create an admin.",
          code: "NOT_ADMIN"
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ 
          message: "Invalid password.",
          code: "INVALID_PASSWORD"
        });
      }

      const token = createToken(user);
      return res.json({
        token,
        user: { id: user._id, name: user.name, email: user.email, role: user.role }
      });
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  }
);

// Get all users (admin only) - with driver info
router.get("/users", protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select("-password").lean();
    
    // Get all drivers to check which users have driver profiles
    const drivers = await Driver.find().select("user email").lean();
    
    // Create Set of user IDs that have driver profiles (via user field)
    const driverUserIds = new Set(
      drivers
        .map(d => d.user ? d.user.toString() : null)
        .filter(Boolean)
    );
    
    // Create Set of emails that have driver profiles (for old drivers without user field)
    const driverEmails = new Set(
      drivers
        .map(d => d.email ? d.email.toLowerCase() : null)
        .filter(Boolean)
    );
    
    // Add driver flag to each user
    const usersWithDriverInfo = users.map(user => ({
      ...user,
      // User has driver profile if:
      // 1. Their user ID is linked to a driver, OR
      // 2. Their email matches an old driver's email (for backward compatibility)
      driver: driverUserIds.has(user._id.toString()) || 
              driverEmails.has(user.email.toLowerCase())
    }));
    
    return res.json(usersWithDriverInfo);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
