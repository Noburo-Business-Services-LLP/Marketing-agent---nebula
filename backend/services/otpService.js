/**
 * OTP Email Service using Resend
 * Sends OTP verification codes via email
 */
const { Resend } = require('resend');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

class OTPService {
  constructor() {
    this.resend = null;
    this.fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@nebulaa.ai';
  }

  initialize() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ RESEND_API_KEY not set — OTP emails will not be sent');
      return false;
    }
    this.resend = new Resend(apiKey);
    console.log('✅ Resend OTP service initialized');
    return true;
  }

  /**
   * Generate a 6-digit OTP code
   */
  generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
  }

  /**
   * Hash OTP before storing in DB
   */
  async hashOTP(otp) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(otp, salt);
  }

  /**
   * Verify OTP against stored hash
   */
  async verifyOTP(plainOtp, hashedOtp) {
    return bcrypt.compare(plainOtp, hashedOtp);
  }

  /**
   * Send OTP email to user
   */
  async sendOTP(email, otp, firstName = '') {
    if (!this.resend) {
      this.initialize();
    }

    if (!this.resend) {
      throw new Error('Email service not configured');
    }

    const { data, error } = await this.resend.emails.send({
      from: `Nebulaa Gravity <${this.fromEmail}>`,
      to: [email],
      subject: `${otp} — Your Verification Code`,
      html: this._buildEmailTemplate(otp, firstName),
    });

    if (error) {
      console.error('❌ Resend OTP error:', error);
      throw new Error('Failed to send verification email');
    }

    console.log(`📧 OTP sent to ${email} (ID: ${data?.id})`);
    return data;
  }

  /**
   * Build a branded HTML email template
   */
  _buildEmailTemplate(otp, firstName) {
    const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
    
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#070A12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#070A12;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:460px;background-color:#0d1117;border-radius:16px;border:1px solid rgba(255,204,41,0.15);overflow:hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#ffcc29,#e6b825);padding:32px;text-align:center;">
              <h1 style="margin:0;font-size:24px;font-weight:800;color:#070A12;letter-spacing:-0.5px;">Nebulaa Gravity</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#070A12;opacity:0.7;">Email Verification</p>
            </td>
          </tr>
          
          <!-- Body -->
          <tr>
            <td style="padding:36px 32px;">
              <p style="margin:0 0 20px;font-size:15px;color:#ededed;line-height:1.6;">
                ${greeting}
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#ededed;line-height:1.6;">
                Enter this code to verify your email and activate your account:
              </p>
              
              <!-- OTP Code -->
              <div style="background:#070A12;border:2px solid rgba(255,204,41,0.3);border-radius:12px;padding:24px;text-align:center;margin:0 0 28px;">
                <span style="font-size:36px;font-weight:800;letter-spacing:12px;color:#ffcc29;font-family:'Courier New',monospace;">
                  ${otp}
                </span>
              </div>
              
              <p style="margin:0 0 8px;font-size:13px;color:#8b949e;line-height:1.5;">
                This code expires in <strong style="color:#ededed;">10 minutes</strong>.
              </p>
              <p style="margin:0;font-size:13px;color:#8b949e;line-height:1.5;">
                If you didn't create an account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid rgba(139,148,158,0.15);text-align:center;">
              <p style="margin:0;font-size:11px;color:#484f58;">
                &copy; ${new Date().getFullYear()} Nebulaa Gravity &mdash; Marketing Agent & Growth Engine
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}

module.exports = new OTPService();
