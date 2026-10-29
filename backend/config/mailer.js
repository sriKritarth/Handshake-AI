const nodemailer = require("nodemailer");
const { escapeHtml } = require("../utils/sanitize");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.USER_EMAIL, pass: process.env.USER_PASSWORD },
  secure: true,
});

async function sendWelcomeEmail(email, firstName, role) {
  const safeFirstName = escapeHtml(firstName);
  const formattedRole = role ? role.toUpperCase() : "MEMBER";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #2563eb; margin-top: 0;">Welcome to Handshake AI, ${safeFirstName}! 🤝</h2>
      <p>Your account has been successfully created with the role: <span style="display: inline-block; background-color: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; font-weight: bold;">${formattedRole}</span>.</p>
      
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">
        If you did not create an account on Handshake AI, please disregard this email.
      </p>
    </div>
  `;

  return transporter.sendMail({
    from: process.env.USER_EMAIL,
    to: email,
    subject: `Welcome to Handshake AI: Your ${formattedRole} Account is Ready!`,
    text: `Hello ${firstName}, welcome to Handshake AI! Your ${formattedRole} account is now active.`,
    html: htmlContent,
  });
}

async function sendPasswordResetEmail(email, resetLink, firstName = "Valued Client") {
  const safeFirstName = escapeHtml(firstName);
  const safeResetLink = escapeHtml(resetLink);

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #2563eb; margin-top: 0;">Password Reset Request 🔐</h2>
      <p>Hello ${safeFirstName},</p>
      <p>We received a request to reset your password for your Handshake AI account.</p>
      <p>Click the button below to reset your password. This link is valid for <strong>15 minutes</strong>:</p>
      
      <div style="margin: 28px 0; text-align: center;">
        <a href="${safeResetLink}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
          Reset Password
        </a>
      </div>
      
      <p style="font-size: 13px; color: #64748b;">
        If the button doesn't work, copy and paste this link into your browser:<br />
        <a href="${safeResetLink}" style="color: #2563eb;">${safeResetLink}</a>
      </p>
      
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">
        If you did not request a password reset, please ignore this email. Your password will remain unchanged.
      </p>
    </div>
  `;

  return transporter.sendMail({
    from: process.env.USER_EMAIL,
    to: email,
    subject: "Reset Your Handshake AI Password",
    text: `Hello ${firstName}, reset your password here: ${resetLink}. This link expires in 15 minutes.`,
    html: htmlContent,
  });
}

module.exports = { sendWelcomeEmail, sendPasswordResetEmail };
