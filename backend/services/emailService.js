/**
 * Email Service
 * 
 * Handles sending emails via multiple providers:
 * - SendGrid (recommended for production)
 * - Nodemailer with SMTP (Gmail, Outlook, etc.)
 * 
 * Supports bulk sending with rate limiting and tracking.
 */

const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = null;
    this.provider = null;
    this.initialized = false;
  }

  /**
   * Initialize email service with user's credentials
   * @param {Object} config - Email configuration
   */
  async initialize(config) {
    const { provider, ...credentials } = config;
    
    try {
      if (provider === 'sendgrid') {
        // SendGrid via SMTP
        this.transporter = nodemailer.createTransport({
          host: 'smtp.sendgrid.net',
          port: 587,
          secure: false,
          auth: {
            user: 'apikey',
            pass: credentials.apiKey
          }
        });
        this.provider = 'sendgrid';
      } else if (provider === 'gmail') {
        // Gmail with App Password
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: credentials.email,
            pass: credentials.appPassword
          }
        });
        this.provider = 'gmail';
      } else if (provider === 'outlook') {
        // Outlook/Microsoft 365
        this.transporter = nodemailer.createTransport({
          host: 'smtp-mail.outlook.com',
          port: 587,
          secure: false,
          auth: {
            user: credentials.email,
            pass: credentials.password
          },
          tls: {
            ciphers: 'SSLv3'
          }
        });
        this.provider = 'outlook';
      } else if (provider === 'smtp') {
        // Custom SMTP
        this.transporter = nodemailer.createTransport({
          host: credentials.host,
          port: credentials.port || 587,
          secure: credentials.secure || false,
          auth: {
            user: credentials.user,
            pass: credentials.password
          }
        });
        this.provider = 'smtp';
      } else {
        throw new Error(`Unknown email provider: ${provider}`);
      }

      // Verify connection
      await this.transporter.verify();
      this.initialized = true;
      
      console.log(`✅ Email service initialized with ${provider}`);
      return { success: true, provider };
      
    } catch (error) {
      console.error('Email service initialization failed:', error);
      return { 
        success: false, 
        error: error.message,
        hint: this._getErrorHint(provider, error)
      };
    }
  }

  /**
   * Send a single email
   * @param {Object} options - Email options
   */
  async sendEmail(options) {
    if (!this.initialized) {
      return { success: false, error: 'Email service not initialized' };
    }

    const { to, from, subject, body, html, replyTo } = options;

    try {
      const mailOptions = {
        from: from,
        to: to,
        subject: subject,
        text: body,
        html: html || this._textToHtml(body),
        replyTo: replyTo || from
      };

      const result = await this.transporter.sendMail(mailOptions);
      
      return {
        success: true,
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected
      };
      
    } catch (error) {
      console.error('Failed to send email:', error);
      return {
        success: false,
        error: error.message,
        to: to
      };
    }
  }

  /**
   * Send bulk emails with rate limiting
   * @param {Array} emails - Array of email objects
   * @param {Object} options - Bulk options
   */
  async sendBulkEmails(emails, options = {}) {
    if (!this.initialized) {
      return { success: false, error: 'Email service not initialized' };
    }

    const {
      rateLimit = 14, // emails per second (SendGrid free tier is 100/day)
      delayBetween = 100, // ms between emails
      onProgress = () => {}
    } = options;

    const results = {
      total: emails.length,
      sent: 0,
      failed: 0,
      details: []
    };

    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];
      
      try {
        const result = await this.sendEmail(email);
        
        if (result.success) {
          results.sent++;
          results.details.push({
            to: email.to,
            success: true,
            messageId: result.messageId
          });
        } else {
          results.failed++;
          results.details.push({
            to: email.to,
            success: false,
            error: result.error
          });
        }
        
      } catch (error) {
        results.failed++;
        results.details.push({
          to: email.to,
          success: false,
          error: error.message
        });
      }

      // Report progress
      onProgress({
        current: i + 1,
        total: emails.length,
        sent: results.sent,
        failed: results.failed
      });

      // Rate limiting delay
      if (i < emails.length - 1) {
        await this._delay(delayBetween);
      }
    }

    return {
      success: results.failed === 0,
      ...results
    };
  }

  /**
   * Personalize email content with lead data
   * @param {Object} template - Email template with placeholders
   * @param {Object} lead - Lead data
   */
  personalizeEmail(template, lead) {
    let { subject, body } = template;
    
    const replacements = {
      '{{firstName}}': lead.firstName || '',
      '{{lastName}}': lead.lastName || '',
      '{{fullName}}': `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
      '{{email}}': lead.email || '',
      '{{companyName}}': lead.company?.name || lead.companyName || '',
      '{{role}}': lead.role || '',
      '{{industry}}': lead.company?.industry || ''
    };

    for (const [placeholder, value] of Object.entries(replacements)) {
      subject = subject.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
      body = body.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    return { subject, body };
  }

  /**
   * Prepare bulk emails from campaign data
   * @param {Object} campaign - Campaign with messages and recipients
   * @param {string} stage - Which stage to send
   */
  prepareBulkFromCampaign(campaign, stage = 'initial') {
    const message = campaign.messages.find(m => m.stage === stage);
    if (!message) {
      return { success: false, error: `No message found for stage: ${stage}` };
    }

    const emails = campaign.recipients
      .filter(r => r.status === 'active' && r.currentStage === 'pending')
      .map(recipient => {
        const personalized = this.personalizeEmail(
          { subject: message.subject, body: message.body },
          recipient
        );
        
        return {
          to: recipient.email,
          from: campaign.sender.email,
          subject: personalized.subject,
          body: personalized.body,
          replyTo: campaign.sender.replyTo || campaign.sender.email,
          leadId: recipient.leadId,
          recipientId: recipient._id
        };
      });

    return {
      success: true,
      emails,
      count: emails.length
    };
  }

  /**
   * Test email configuration by sending a test email
   * @param {string} to - Test recipient email
   */
  async sendTestEmail(to) {
    return this.sendEmail({
      to,
      from: to,
      subject: 'Test Email from Nebulaa Gravity',
      body: `This is a test email to verify your email configuration is working correctly.

If you received this, your email setup is complete!

Sent at: ${new Date().toISOString()}`,
    });
  }

  // Helper methods
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _textToHtml(text) {
    return text
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }

  _getErrorHint(provider, error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('authentication') || message.includes('auth')) {
      if (provider === 'gmail') {
        return 'For Gmail, you need to use an App Password. Go to Google Account > Security > 2-Step Verification > App Passwords';
      }
      return 'Please check your email credentials.';
    }
    
    if (message.includes('self signed certificate')) {
      return 'SSL certificate issue. Try setting secure: false in SMTP config.';
    }
    
    return 'Check your email provider settings and credentials.';
  }
}

module.exports = new EmailService();
