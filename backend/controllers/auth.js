const supabase = require("../config/db");
const { validate_email, validate_password } = require("../config/validation");
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
      role,
    } = req.body;

    // 1. Check mandatory fields
    if (!first_name || !last_name || !email_id || !password || !confirm_password) {
      return res.status(422).json({
        success: false,
        message: "First name, last name, email_id, password, and confirm_password are required",
      });
    }

    // Type aur length check
    if (
      typeof first_name !== "string" || first_name.trim().length > 50 ||
      typeof last_name !== "string" || last_name.trim().length > 50
    ) {
      return res.status(400).json({
        success: false,
        message: "First name and last name must be strings under 50 characters",
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

    // 3. Password strength and complexity validation
    const passwordValidation = validate_password(password);
    if (!passwordValidation.success) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      });
    }

    // 4. Email format validation
    const emailValidation = validate_email(email);
    if (!emailValidation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // 5. Role normalization & validation
    if (typeof role !== "string" || role.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No role provided for sign - up",
      });
    }
    const normalizedRole = role.toLowerCase();
    const roles = ["buyer", "merchant"];
    if (!roles.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: "Role must be either 'buyer' or 'merchant'",
      });
    }

    // 6. Check if user already exists
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

    // 7. Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 8. Insert new user into Supabase
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

    // 9. Emit post-signup event (Nodemailer hook in background)
    useEvents.emit("user:signed_up", {
      email: data.email,
      firstName: data.first_name,
      lastName: data.last_name,
      role: data.role,
    });

    // 10. Generate JWT access token
    const payload = {
      id: data.id,
      email: data.email,
      role: data.role,
      first_name: data.first_name,
      last_name: data.last_name,
    };
    const token = jwt.sign(
      payload,
      process.env.JWT_SIGN,
      { expiresIn: "1d" }
    );

    // 11. Sanitized user response (strip password_hash)
    data.password_hash = undefined;

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
    };
    const token = jwt.sign(
      payload,
      process.env.JWT_SIGN,
      { expiresIn: "7d" }
    );

    // 4. Return user profile without password_hash
    user.password_hash = undefined;

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

/**
 * Forgot Password controller
 * Generates signed reset token and emits Nodemailer hook to send email
 * POST /api/v1/auth/forgot-password
 */
exports.forgot_password = async (req, res) => {
  try {
    const { email } = req.body;
    const targetEmail = email.trim().toLowerCase();

    if (!targetEmail) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const emailValidation = validate_email(targetEmail);
    if (!emailValidation.success) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // 1. Fetch user from Supabase
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, email, first_name, role")
      .eq("email", targetEmail)
      .maybeSingle();

    if (userError) {
      console.error("Supabase error during forgot password lookup:", userError.message);
    }

    // 2. Generic success response (prevents user enumeration)
    if (!user) {
      return res.status(200).json({
        success: true,
        message: "If an account exists with this email, a password reset link has been sent.",
      });
    }

    // 3. Generate signed reset token valid for 15 minutes
    const secret = process.env.RESET_TOKEN;
    const resetToken = jwt.sign(
      {
        id: user.id,
        email: user.email,
        type: "password_reset",
      },
      secret,
      { expiresIn: "15m" }
    );

    // 4. Construct reset link
    const clientBaseUrl = process.env.FRONTEND_URL ;
    const resetLink = `${clientBaseUrl.replace(/\/+$/, "")}/reset-password?token=${resetToken}`;

    // 5. Fire Nodemailer hook asynchronously
    useEvents.emit("user:forgot_password", {
      email: user.email,
      resetLink,
      firstName: user.first_name,
    });

    return res.status(200).json({
      success: true,
      message: "If an account exists with this email, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process forgot password request",
    });
  }
};

/**
 * Reset Password controller
 * Validates reset token and updates password in Supabase
 * POST /api/v1/auth/reset-password
 */
exports.reset_password = async (req, res) => {
  try {
    const { token, new_password, confirm_password } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Reset token is required",
      });
    }

    if (!new_password || !confirm_password) {
      return res.status(400).json({
        success: false,
        message: "New password and confirm password are required",
      });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    // Password strength and complexity validation
    const passwordValidation = validate_password(new_password);
    if (!passwordValidation.success) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message,
      });
    }

    // 1. Verify reset token
    const secret = process.env.RESET_TOKEN;
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(400).json({
          success: false,
          message: "Password reset link has expired. Please request a new one.",
        });
      }
      return res.status(400).json({
        success: false,
        message: "Invalid or malformed password reset link.",
      });
    }

    if (decoded.type !== "password_reset") {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token type.",
      });
    }

    // 2. Hash new password
    const hashedPassword = await bcrypt.hash(new_password, SALT_ROUNDS);

    // 3. Update password in Supabase users table
    const { error: updateError } = await supabase
      .from("users")
      .update({ password_hash: hashedPassword })
      .eq("id", decoded.id);

    if (updateError) {
      return res.status(500).json({
        success: false,
        message: updateError.message || "Failed to update password",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Password has been successfully reset. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to reset password",
    });
  }
};
