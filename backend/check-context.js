const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const OnboardingContext = require('./models/OnboardingContext');
  const User = require('./models/User');
  
  const userId = '6946b2899757eed617fe355b';
  
  // Check user's businessProfile
  const user = await User.findById(userId);
  console.log('=== User ===');
  console.log('Email:', user?.email);
  console.log('Onboarding completed:', user?.onboardingCompleted);
  console.log('Has businessProfile:', !!user?.businessProfile);
  
  // Check OnboardingContext
  let context = await OnboardingContext.findOne({ userId: new mongoose.Types.ObjectId(userId) });
  console.log('\n=== OnboardingContext ===');
  console.log('Context found:', !!context);
  
  if (!context && user?.onboardingCompleted && user?.businessProfile) {
    console.log('\nCreating OnboardingContext from businessProfile...');
    
    const bp = user.businessProfile;
    
    context = new OnboardingContext({
      userId: user._id,
      company: {
        name: bp.name || 'Company',
        website: bp.website || '',
        industry: bp.industry || 'General',
        description: bp.niche || bp.description || 'A company'
      },
      targetCustomer: {
        description: bp.targetAudience || 'Business clients',
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
    
    await context.save();
    console.log('OnboardingContext created!');
  }
  
  if (context) {
    console.log('\nContext details:');
    console.log('  Company:', context.company?.name);
    console.log('  Industry:', context.company?.industry);
    console.log('  Description:', context.company?.description?.substring(0, 80));
    console.log('  Target:', context.targetCustomer?.description?.substring(0, 80));
    console.log('  Goal:', context.primaryGoal);
    console.log('  Tone:', context.brandTone);
    
    const readiness = context.isReadyForOutreach();
    console.log('\nReadiness check:');
    console.log('  Is ready:', readiness.isReady);
    console.log('  Missing:', readiness.missingFields);
  }
  
  await mongoose.disconnect();
}

check().catch(console.error);
