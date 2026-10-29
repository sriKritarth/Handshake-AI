const zod = require("zod");

exports.validate_email = function (email) {
    try {
        const emailValidator = zod.string().email();
        const validate = emailValidator.parse(email);
        return {
            data: validate,
            success: true,
        };
    } catch (err) {
        return {
            data: err,
            success: false,
        };
    }
};

/**
 * Validate password strength and complexity:
 * - Minimum 8 characters, maximum 128 characters
 * - At least one uppercase letter ([A-Z])
 * - At least one lowercase letter ([a-z])
 * - At least one numeric digit ([0-9])
 * - At least one special character (!@#$%^&*...)
 */
exports.validate_password = function (password) {
    if (typeof password !== "string") {
        return {
            success: false,
            message: "Password must be a valid string",
        };
    }

    if (password.length < 8) {
        return {
            success: false,
            message: "Password must be at least 8 characters long",
        };
    }

    if (password.length > 128) {
        return {
            success: false,
            message: "Password must not exceed 128 characters",
        };
    }

    if (!/[A-Z]/.test(password)) {
        return {
            success: false,
            message: "Password must contain at least one uppercase letter",
        };
    }

    if (!/[a-z]/.test(password)) {
        return {
            success: false,
            message: "Password must contain at least one lowercase letter",
        };
    }

    if (!/[0-9]/.test(password)) {
        return {
            success: false,
            message: "Password must contain at least one number",
        };
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
        return {
            success: false,
            message: "Password must contain at least one special character",
        };
    }

    return {
        success: true,
        message: "Password is valid",
    };
};
