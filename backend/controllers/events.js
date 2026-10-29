const EventEmitter = require("events");
const { sendWelcomeEmail, sendPasswordResetEmail } = require("../config/mailer");

const useEvents = new EventEmitter();

// Hook listener: runs asynchronously whenever 'user:signed_up' is fired
useEvents.on("user:signed_up", async (userData) => {
  try {
    const info = await sendWelcomeEmail(userData.email , userData.firstName , userData.role);
    console.log(`✉️ Post-signup email sent to ${userData.email} (Message ID: ${info?.messageId})`);
  } catch (error) {
    // Log error without crashing or rolling back the user account
    console.error(`❌ Failed to send welcome email to ${userData.email}:`, error.message);
  }
});

// Hook listener: runs asynchronously whenever 'user:forgot_password' is fired
useEvents.on("user:forgot_password", async (resetData) => {
  try {
    const info = await sendPasswordResetEmail(resetData.email, resetData.resetLink, resetData.firstName);
    console.log(`✉️ Password reset email sent to ${resetData.email} (Message ID: ${info?.messageId})`);
  } catch (error) {
    console.error(`❌ Failed to send password reset email to ${resetData.email}:`, error.message);
  }
});

module.exports = { useEvents };