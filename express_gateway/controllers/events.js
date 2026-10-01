const EventEmitter = require("events");
const { sendWelcomeEmail } = require("../config/mailer");

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

module.exports = { useEvents };