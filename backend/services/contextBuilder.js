/**
 * Context Builder Service
 * 
 * Central service that constructs rich context for AI prompt generation.
 * Pulls onboarding data, lead data, and builds comprehensive prompts.
 * 
 * This is the "brain" that ensures all AI-generated outreach is personalized
 * and aligned with the company's brand, goals, and target audience.
 */

const mongoose = require('mongoose');
const OnboardingContext = require('../models/OnboardingContext');
const Lead = require('../models/Lead');
const User = require('../models/User');

class ContextBuilder {
  
  /**
   * Get complete company context for a user
   * @param {string} userId - User ID
   * @returns {Object} Company context or error
   */
  async getCompanyContext(userId) {
    try {
      // Ensure userId is an ObjectId
      const userObjectId = typeof userId === 'string' 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;
      
      // Fetch onboarding context
      const context = await OnboardingContext.findOne({ userId: userObjectId });
      
      if (!context) {
        // Try to create from user's businessProfile
        const user = await User.findById(userObjectId);
        
        if (user && user.onboardingCompleted && user.businessProfile) {
          const bp = user.businessProfile;
          
          const newContext = new OnboardingContext({
            userId: userObjectId,
            company: {
              name: bp.name || bp.companyName || user.companyName || 'Company',
              website: bp.website || '',
              industry: bp.industry || 'General',
              description: bp.niche || bp.description || bp.tagline || 'A company providing quality services'
            },
            targetCustomer: {
              description: bp.targetAudience || bp.goals || 'Business clients seeking our solutions',
              roles: [],
              companySize: 'any',
              industries: [bp.industry].filter(Boolean)
            },
            geography: {
              isGlobal: true,
              regions: [],
              countries: []
            },
            primaryGoal: 'leads',
            brandTone: bp.brandVoice?.toLowerCase() || 'professional',
            valueProposition: {
              main: bp.tagline || bp.niche || '',
              keyBenefits: [],
              differentiators: []
            },
            completionStatus: {
              isComplete: true,
              completedAt: new Date()
            }
          });
          
          await newContext.save();
          console.log('✅ Auto-created OnboardingContext from businessProfile');
          
          return this.getCompanyContext(userId); // Recurse to get the newly created context
        }
        
        return {
          success: false,
          error: 'ONBOARDING_NOT_FOUND',
          message: 'Please complete onboarding to enable AI-powered outreach.',
          missingFields: ['all']
        };
      }
      
      // Check if context is ready for outreach
      const readiness = context.isReadyForOutreach();
      
      if (!readiness.isReady) {
        return {
          success: false,
          error: 'ONBOARDING_INCOMPLETE',
          message: 'Please complete your company profile to enable AI-powered outreach.',
          missingFields: readiness.missingFields
        };
      }
      
      // Also fetch user data for additional context
      const user = await User.findById(userObjectId);
      
      return {
        success: true,
        context: {
          company: {
            name: context.company.name,
            website: context.company.website,
            industry: context.company.industry,
            description: context.company.description
          },
          targetCustomer: {
            description: context.targetCustomer.description,
            roles: context.targetCustomer.roles || [],
            companySize: context.targetCustomer.companySize,
            industries: context.targetCustomer.industries || []
          },
          geography: {
            regions: context.geography?.regions || [],
            countries: context.geography?.countries || [],
            isGlobal: context.geography?.isGlobal || false
          },
          pricing: {
            range: context.pricing?.range || '',
            model: context.pricing?.model || ''
          },
          goals: {
            primary: context.primaryGoal,
            secondary: context.secondaryGoals || []
          },
          brandTone: context.brandTone,
          valueProposition: {
            main: context.valueProposition?.main || '',
            keyBenefits: context.valueProposition?.keyBenefits || [],
            differentiators: context.valueProposition?.differentiators || []
          },
          competitors: context.competitors || [],
          outreachPreferences: context.outreachPreferences || {},
          senderInfo: {
            firstName: user?.firstName || '',
            lastName: user?.lastName || '',
            email: user?.email || '',
            companyName: user?.companyName || context.company.name
          }
        }
      };
    } catch (error) {
      console.error('ContextBuilder.getCompanyContext error:', error);
      return {
        success: false,
        error: 'CONTEXT_FETCH_ERROR',
        message: 'Failed to fetch company context.',
        details: error.message
      };
    }
  }
  
  /**
   * Get lead-specific context
   * @param {string} leadId - Lead ID
   * @returns {Object} Lead context
   */
  async getLeadContext(leadId) {
    try {
      const lead = await Lead.findById(leadId);
      
      if (!lead) {
        return {
          success: false,
          error: 'LEAD_NOT_FOUND',
          message: 'Lead not found.'
        };
      }
      
      return {
        success: true,
        context: {
          personal: {
            firstName: lead.firstName,
            lastName: lead.lastName,
            fullName: lead.getFullName(),
            email: lead.email,
            phone: lead.phone,
            linkedinUrl: lead.linkedinUrl
          },
          professional: {
            role: lead.role,
            seniority: lead.seniority,
            department: lead.department
          },
          company: {
            name: lead.company.name,
            website: lead.company.website,
            industry: lead.company.industry,
            size: lead.company.size,
            location: lead.company.location
          },
          engagement: {
            status: lead.status,
            emailsSent: lead.outreachStatus.emailsSent,
            emailsOpened: lead.outreachStatus.emailsOpened,
            emailsReplied: lead.outreachStatus.emailsReplied,
            lastContactedAt: lead.outreachStatus.lastContactedAt,
            lastResponseAt: lead.outreachStatus.lastResponseAt
          },
          personalization: {
            painPoints: lead.personalizationContext?.painPoints || [],
            interests: lead.personalizationContext?.interests || [],
            recentNews: lead.personalizationContext?.recentNews || '',
            commonConnections: lead.personalizationContext?.commonConnections || [],
            customNotes: lead.personalizationContext?.customNotes || ''
          },
          source: lead.source,
          tags: lead.tags || []
        }
      };
    } catch (error) {
      console.error('ContextBuilder.getLeadContext error:', error);
      return {
        success: false,
        error: 'LEAD_FETCH_ERROR',
        message: 'Failed to fetch lead context.',
        details: error.message
      };
    }
  }
  
  /**
   * Build a complete prompt context combining company and lead data
   * @param {string} userId - User ID
   * @param {string} leadId - Lead ID
   * @returns {Object} Combined context for AI prompt
   */
  async buildFullContext(userId, leadId) {
    const companyResult = await this.getCompanyContext(userId);
    if (!companyResult.success) {
      return companyResult;
    }
    
    const leadResult = await this.getLeadContext(leadId);
    if (!leadResult.success) {
      return leadResult;
    }
    
    return {
      success: true,
      context: {
        company: companyResult.context,
        lead: leadResult.context
      }
    };
  }
  
  /**
   * Build the system prompt for AI based on context
   * @param {Object} context - Full context object
   * @param {string} contentType - Type of content to generate
   * @returns {string} System prompt for AI
   */
  buildSystemPrompt(context, contentType) {
    const { company, lead } = context;
    
    const basePrompt = `You are an expert sales copywriter working for ${company.company.name}, a ${company.company.industry} company.

COMPANY CONTEXT:
- Company: ${company.company.name}
- Industry: ${company.company.industry}
- What they do: ${company.company.description}
- Website: ${company.company.website || 'Not provided'}
- Primary Goal: ${company.goals.primary}
- Brand Tone: ${company.brandTone}
${company.valueProposition.main ? `- Value Proposition: ${company.valueProposition.main}` : ''}
${company.valueProposition.keyBenefits.length > 0 ? `- Key Benefits: ${company.valueProposition.keyBenefits.join(', ')}` : ''}
${company.valueProposition.differentiators.length > 0 ? `- Differentiators: ${company.valueProposition.differentiators.join(', ')}` : ''}

TARGET CUSTOMER:
- ICP: ${company.targetCustomer.description}
${company.targetCustomer.roles.length > 0 ? `- Target Roles: ${company.targetCustomer.roles.join(', ')}` : ''}
${company.targetCustomer.industries.length > 0 ? `- Target Industries: ${company.targetCustomer.industries.join(', ')}` : ''}

SENDER INFO:
- Name: ${company.senderInfo.firstName} ${company.senderInfo.lastName}
- From: ${company.senderInfo.companyName}
${company.outreachPreferences.calendarLink ? `- Calendar Link: ${company.outreachPreferences.calendarLink}` : ''}`;

    const leadContext = lead ? `

LEAD CONTEXT:
- Name: ${lead.personal.fullName}
- Role: ${lead.professional.role || 'Unknown'}
- Seniority: ${lead.professional.seniority || 'Unknown'}
- Company: ${lead.company.name}
- Industry: ${lead.company.industry || 'Unknown'}
- Company Size: ${lead.company.size || 'Unknown'}
- Location: ${lead.company.location || 'Unknown'}
${lead.personalization.painPoints.length > 0 ? `- Known Pain Points: ${lead.personalization.painPoints.join(', ')}` : ''}
${lead.personalization.interests.length > 0 ? `- Interests: ${lead.personalization.interests.join(', ')}` : ''}
${lead.personalization.recentNews ? `- Recent News: ${lead.personalization.recentNews}` : ''}
${lead.personalization.customNotes ? `- Notes: ${lead.personalization.customNotes}` : ''}

ENGAGEMENT HISTORY:
- Status: ${lead.engagement.status}
- Emails Sent: ${lead.engagement.emailsSent}
- Emails Opened: ${lead.engagement.emailsOpened}
- Emails Replied: ${lead.engagement.emailsReplied}` : '';

    const toneGuide = this.getToneGuide(company.brandTone);

    const contentTypeInstructions = this.getContentTypeInstructions(contentType, lead?.engagement);

    return `${basePrompt}${leadContext}

TONE GUIDELINES:
${toneGuide}

${contentTypeInstructions}

CRITICAL RULES:
1. NEVER use generic phrases like "I hope this email finds you well"
2. NEVER use template-like language
3. ALWAYS personalize based on the lead's role, company, and context
4. Keep emails concise (under 150 words for cold emails)
5. Include ONE clear call-to-action
6. Reference specific, relevant value propositions
7. Match the brand tone exactly
8. Make the subject line compelling and personalized
9. Sound human, not like a sales robot`;
  }
  
  /**
   * Get tone guide based on brand tone
   * @param {string} tone - Brand tone
   * @returns {string} Tone guidelines
   */
  getToneGuide(tone) {
    const toneGuides = {
      formal: `- Use professional language and proper grammar
- Avoid contractions and casual expressions
- Maintain a respectful, business-like demeanor
- Use titles and formal greetings`,
      
      friendly: `- Use warm, approachable language
- Contractions are fine (I'm, we're, you'll)
- Be conversational but still professional
- Use the recipient's first name`,
      
      bold: `- Be direct and confident
- Use strong action verbs
- Don't hedge or use weak language
- Make bold claims backed by value`,
      
      professional: `- Balance warmth with professionalism
- Clear and concise communication
- Focus on value and outcomes
- Respectful but not overly formal`,
      
      casual: `- Very conversational tone
- Use everyday language
- Feel like a friend reaching out
- Light and easy to read`,
      
      authoritative: `- Position as an industry expert
- Share insights and expertise
- Confident but not arrogant
- Data and credibility focused`,
      
      empathetic: `- Show understanding of challenges
- Acknowledge pain points
- Supportive and helpful tone
- Focus on solving problems`,
      
      witty: `- Use clever, engaging language
- Light humor where appropriate
- Memorable and distinct voice
- Don't sacrifice clarity for cleverness`
    };
    
    return toneGuides[tone] || toneGuides.professional;
  }
  
  /**
   * Get content type specific instructions
   * @param {string} contentType - Type of content
   * @param {Object} engagement - Lead engagement data
   * @returns {string} Content-specific instructions
   */
  getContentTypeInstructions(contentType, engagement) {
    const instructions = {
      cold_email: `TASK: Write a cold email.
FORMAT: Return JSON with "subject" and "body" fields.
- This is the FIRST contact with this lead
- Hook them in the first line with something relevant to THEM
- Establish credibility quickly
- Present ONE clear value proposition
- End with a low-friction CTA (quick call, reply, etc.)`,

      follow_up: `TASK: Write a follow-up email.
FORMAT: Return JSON with "subject" and "body" fields.
- This is follow-up #${(engagement?.emailsSent || 0) + 1}
- Reference the previous outreach subtly
- Provide NEW value or angle
- Keep it shorter than the original
- Don't be pushy or desperate`,

      breakup: `TASK: Write a "breakup" email (final attempt).
FORMAT: Return JSON with "subject" and "body" fields.
- This is the last email in the sequence
- Be respectful of their time
- Leave the door open for future contact
- Provide one last compelling reason
- Make it easy to say "not now" vs "never"`,

      value_add: `TASK: Write a value-add email.
FORMAT: Return JSON with "subject" and "body" fields.
- Share something genuinely valuable (insight, resource, idea)
- Don't ask for anything in return
- Position yourself as helpful, not salesy
- Build relationship, not pressure`,

      meeting_request: `TASK: Write a meeting request email.
FORMAT: Return JSON with "subject" and "body" fields.
- Be specific about meeting purpose and value
- Suggest specific times or use calendar link
- Keep it brief and action-oriented
- Make it easy to say yes`,

      call_script: `TASK: Write a cold call script.
FORMAT: Return JSON with "opener", "pitch", "objectionHandling", and "close" fields.
- Opener: First 10 seconds to earn attention
- Pitch: 30-second value proposition
- Objection Handling: Common objections and responses
- Close: How to secure next step`,

      linkedin_connection: `TASK: Write a LinkedIn connection request message.
FORMAT: Return JSON with "message" field.
- MAX 300 characters
- Find common ground or mutual connection
- Be genuine, not salesy
- Don't pitch in the connection request`,

      linkedin_message: `TASK: Write a LinkedIn direct message.
FORMAT: Return JSON with "message" field.
- More conversational than email
- Reference something from their profile
- Shorter format (under 100 words)
- One clear purpose`,

      objection_response: `TASK: Write responses to common objections.
FORMAT: Return JSON with "objections" array, each having "objection" and "response" fields.
- Address the real concern behind the objection
- Be empathetic first, then provide value
- Use social proof where relevant
- Guide toward next steps`
    };
    
    return instructions[contentType] || instructions.cold_email;
  }
  
  /**
   * Build a user prompt for specific content generation
   * @param {Object} context - Full context
   * @param {string} contentType - Type of content
   * @param {Object} options - Additional options
   * @returns {string} User prompt
   */
  buildUserPrompt(context, contentType, options = {}) {
    const { company, lead } = context;
    
    let prompt = `Generate a ${contentType.replace('_', ' ')} for ${lead.personal.fullName} at ${lead.company.name}.`;
    
    if (options.customInstructions) {
      prompt += `\n\nAdditional instructions: ${options.customInstructions}`;
    }
    
    if (options.focusPoints && options.focusPoints.length > 0) {
      prompt += `\n\nFocus on these points: ${options.focusPoints.join(', ')}`;
    }
    
    if (options.avoidTopics && options.avoidTopics.length > 0) {
      prompt += `\n\nAvoid mentioning: ${options.avoidTopics.join(', ')}`;
    }
    
    prompt += '\n\nReturn the response as valid JSON.';
    
    return prompt;
  }
}

module.exports = new ContextBuilder();
