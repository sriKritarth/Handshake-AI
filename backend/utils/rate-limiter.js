const { rateLimit } = require("express-rate-limit")


const auth_limiter = rateLimit({

    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 5, // Limit each IP to 5 requests per windowMs
    message: {
        status: 429,
        message: 'Too many login attempts. Please try again after 15 minutes.'
    },
    standardHeaders: 'draft-8',
    legacyHeaders: false

});

const api_limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    limit: 30, // Limit each IP to 60 requests per minute
    message: {
        status: 429,
        message: 'Too many requests. Please slow down.'
    },
    standardHeaders: 'draft-8',
    legacyHeaders: false,

});

const auto_negotiate = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    limit: 8, // Limit each IP to 60 requests per minute
    message: {
        status: 429,
        message: 'Too many requests. Please slow down.'
    },
    standardHeaders: 'draft-8',
    legacyHeaders: false,

});

module.exports = {auth_limiter , api_limiter , auto_negotiate};