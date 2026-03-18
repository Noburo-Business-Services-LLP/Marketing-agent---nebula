/**
 * AWS SES Email Service
 * 
 * Handles sending campaign reminder emails via Amazon SES
 */

const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

class SESEmailService {
  constructor() {
    this.client = null;
    this.senderEmail = null;
    this.initialized = false;
  }

  /**
   * Initialize SES client with credentials
   */
  initialize() {
    const accessKeyId = process.env.SES_AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.SES_AWS_SECRET_ACCESS_KEY;
    const region = process.env.SES_AWS_REGION || 'ap-south-1';
    this.senderEmail = process.env.SES_SENDER_EMAIL;

    if (!accessKeyId || !secretAccessKey || !this.senderEmail) {
      console.log('⚠️  AWS SES not configured - email notifications disabled');
      return false;
    }

    try {
      this.client = new SESClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey
        }
      });
      this.initialized = true;
      console.log('✅ AWS SES email service initialized');
      return true;
    } catch (error) {
      console.error('❌ AWS SES initialization failed:', error.message);
      return false;
    }
  }

  /**
   * Send campaign reminder email
   * @param {Object} options - Email options
   */
  async sendCampaignReminder(options) {
    if (!this.initialized) {
      return { success: false, error: 'SES not initialized' };
    }

    const { to, campaignName, minutesBefore, scheduledTime, platforms } = options;

    const subject = `⏰ Campaign Reminder: "${campaignName}" goes live in ${minutesBefore} minutes`;
    
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #ffcc29, #ffa500); padding: 20px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { color: #000; margin: 0; font-size: 24px; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 12px 12px; }
    .alert-box { background: #fff; border-left: 4px solid #ffcc29; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .time-badge { display: inline-block; background: #ffcc29; color: #000; padding: 8px 16px; border-radius: 20px; font-weight: bold; font-size: 18px; }
    .platforms { margin: 15px 0; }
    .platform-tag { display: inline-block; background: #e0e0e0; padding: 4px 12px; border-radius: 12px; margin: 4px; font-size: 12px; text-transform: capitalize; }
    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
    .cta { display: inline-block; background: #ffcc29; color: #000; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; margin-top: 15px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⏰ Campaign Reminder</h1>
    </div>
    <div class="content">
      <div class="alert-box">
        <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Your campaign is scheduled to go live in:</p>
        <div class="time-badge">${minutesBefore} minutes</div>
      </div>
      
      <h2 style="margin: 20px 0 10px 0;">📢 ${campaignName}</h2>
      
      <p><strong>Scheduled Time:</strong> ${scheduledTime}</p>
      
      <div class="platforms">
        <strong>Platforms:</strong>
        ${platforms.map(p => `<span class="platform-tag">${p}</span>`).join('')}
      </div>
      
      <p style="margin-top: 20px;">Please ensure everything is ready for your campaign launch. Review your content and targeting settings before it goes live.</p>
      
      <div class="footer">
        <p>This is an automated reminder from Nebulaa Gravity.</p>
        <p>© ${new Date().getFullYear()} Nebulaa Gravity - Your AI Marketing Assistant</p>
      </div>
    </div>
  </div>
</body>
</html>`;

    const textBody = `
CAMPAIGN REMINDER

Your campaign "${campaignName}" goes live in ${minutesBefore} minutes!

Scheduled Time: ${scheduledTime}
Platforms: ${platforms.join(', ')}

Please ensure everything is ready for your campaign launch.

---
Nebulaa Gravity - Your AI Marketing Assistant
`;

    try {
      const command = new SendEmailCommand({
        Source: this.senderEmail,
        Destination: {
          ToAddresses: [to]
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: 'UTF-8'
          },
          Body: {
            Html: {
              Data: htmlBody,
              Charset: 'UTF-8'
            },
            Text: {
              Data: textBody,
              Charset: 'UTF-8'
            }
          }
        }
      });

      const response = await this.client.send(command);
      console.log(`✅ Campaign reminder email sent to ${to} (MessageId: ${response.MessageId})`);
      
      return { 
        success: true, 
        messageId: response.MessageId 
      };
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error.message);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Send campaign live notification
   */
  async sendCampaignLive(options) {
    if (!this.initialized) {
      return { success: false, error: 'SES not initialized' };
    }

    const { to, campaignName, platforms } = options;

    const subject = `🚀 Campaign Live: "${campaignName}" is now active!`;
    
    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #22c55e, #16a34a); padding: 20px; border-radius: 12px 12px 0 0; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 24px; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 12px 12px; }
    .success-box { background: #dcfce7; border-left: 4px solid #22c55e; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .platforms { margin: 15px 0; }
    .platform-tag { display: inline-block; background: #e0e0e0; padding: 4px 12px; border-radius: 12px; margin: 4px; font-size: 12px; text-transform: capitalize; }
    .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Campaign is Live!</h1>
    </div>
    <div class="content">
      <div class="success-box">
        <p style="margin: 0; font-weight: bold; color: #166534;">Your campaign is now active and running.</p>
      </div>
      
      <h2 style="margin: 20px 0 10px 0;">📢 ${campaignName}</h2>
      
      <div class="platforms">
        <strong>Active on:</strong>
        ${platforms.map(p => `<span class="platform-tag">${p}</span>`).join('')}
      </div>
      
      <p>Your campaign has started. Monitor your dashboard for real-time performance metrics.</p>
      
      <div class="footer">
        <p>This is an automated notification from Nebulaa Gravity.</p>
        <p>© ${new Date().getFullYear()} Nebulaa Gravity - Your AI Marketing Assistant</p>
      </div>
    </div>
  </div>
</body>
</html>`;

    try {
      const command = new SendEmailCommand({
        Source: this.senderEmail,
        Destination: {
          ToAddresses: [to]
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: 'UTF-8'
          },
          Body: {
            Html: {
              Data: htmlBody,
              Charset: 'UTF-8'
            },
            Text: {
              Data: `Your campaign "${campaignName}" is now live on ${platforms.join(', ')}!`,
              Charset: 'UTF-8'
            }
          }
        }
      });

      const response = await this.client.send(command);
      return { success: true, messageId: response.MessageId };
    } catch (error) {
      console.error(`❌ Failed to send campaign live email:`, error.message);
      return { success: false, error: error.message };
    }
  }
}

// Singleton instance
const sesEmailService = new SESEmailService();

module.exports = sesEmailService;
