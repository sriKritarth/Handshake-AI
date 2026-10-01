const supabase = require("../config/db");
const { validate_email } = require("../config/validation");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { useEvents } = require("../controllers/events");
require("dotenv").config();

const SALT_ROUNDS = 12;

/**
 * Sign-up controller
 * Supports: first_name, last_name, email (or email_id), password (or password_hash), confirm_password, role ('buyer' | 'merchant')
 */
exports.sign_up = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email_id,
      password,
      confirm_password,
      role ,
    } = req.body;

    // 1. Check mandatory fields
    if (!first_name || !last_name || !email_id || !password || !confirm_password) {
      return res.status(422).json({
        success: false,
        message: "First name, last name, email_id, password, and confirm_password are required",
      });
    }

    const email = email_id.trim().toLowerCase();

    // 2. Confirm password check
    if (password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    // 3. Email format validation
    const emailValidation = validate_email(email);
    if (!emailValidation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // 4. Role normalization & validation
    const normalizedRole = (role || "buyer").toLowerCase();
    if (!["buyer", "merchant", "admin"].includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: "Role must be either 'buyer' or 'merchant'",
      });
    }

    // 5. Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("Supabase user lookup error:", checkError);
    }

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User with this email already exists",
      });
    }

    // 6. Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 7. Insert new user into Supabase
    const { data, error } = await supabase
      .from("users")
      .insert({
        first_name: first_name.trim(),
        last_name: last_name.trim(),
        email: email,
        password_hash: hashedPassword,
        role: normalizedRole,
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to register user",
      });
    }

    // 8. Emit post-signup event (Nodemailer hook in background)
    useEvents.emit("user:signed_up", {
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
      role: data.role,
    });

    // 9. Generate JWT access token
    const payload = {
        id: data.id,
        email: data.email,
        role: data.role,
        first_name: data.first_name,
        last_name: data.last_name,
      }
    const token = jwt.sign(
      payload,
      process.env.JWT_SIGN,
      { expiresIn: "7d" }
    );

    // 10. Sanitized user response (strip password_hash)
    data.password_hash = undefined

    return res.status(201).json({
      success: true,
      token,
      user: data,
      message: "User registered successfully",
    });
  } catch (err) {
    console.error("Sign-up error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Sign-up failed due to internal error",
    });
  }
};

/**
 * Login controller
 * Supports: email (or email_id), password (or password_hash)
 */
exports.login = async (req, res) => {
  try {
    const { email_id, password } = req.body;

    if (!email_id || !password) {
      return res.status(422).json({
        success: false,
        message: "Email_id and password are required",
      });
    }

    const email = email_id.trim().toLowerCase();

    // 1. Fetch user from Supabase
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // 2. Verify password with bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // 3. Issue JWT access token
    const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
      }
    const token = jwt.sign(payload,
      process.env.JWT_SIGN,
      { expiresIn: "7d" }
    );

    // 4. Return user profile without password_hash

    user.password_hash = undefined

    return res.status(200).json({
      success: true,
      token,
      user,
      message: "Logged in successfully",
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Login failed due to internal error",
    });
  }
};

/**
 * Get current user profile controller (auth.me)
 * Returns authenticated user details from req.user (attached by authenticateToken middleware)
 */
exports.getme = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      message: "User profile fetched successfully",
      data: req.user,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to fetch user profile",
    });
  }
};

/**
 * Logout controller
 */
exports.logout = async (req, res) => {
  return res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
};

 