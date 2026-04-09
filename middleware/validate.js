const { validationResult } = require("express-validator");

const validate = (req, res, next) => {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const errors = result.array().map((error) => ({ field: error.path, message: error.msg }));
    console.log("Validation failed:", errors);
    return res.status(400).json({
      message: "Validation failed",
      errors
    });
  }
  next();
};

module.exports = { validate };
