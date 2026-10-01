const nodemailer = require("nodemailer");

const transporter  =  nodemailer.createTransport({
        service : 'gmail',
        auth : {user : process.env.USER_EMAIL , pass : process.env.USER_PASSWORD},
        secure : true
});


async function sendWelcomeEmail(email, firstName, role) {
    
  const formattedRole = role ? role.toUpperCase() : "MEMBER";

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #2563eb; margin-top: 0;">Welcome to Handshake AI, ${firstName}! 🤝</h2>
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
    subject: `Welcome to Handshake AI — Your ${formattedRole} Account is Ready!`,
    text: `Hello ${firstName}, welcome to Handshake AI! Your ${formattedRole} account is now active.`,
    html: htmlContent,
  });
}

module.exports = { sendWelcomeEmail };





        