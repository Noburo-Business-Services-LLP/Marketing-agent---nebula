export interface SuggestedCampaign {
  id: string;
  title: string;
  caption: string;
  imageUrl: string;
  platform: string;
  objective: string;
  hashtags: string[];
  bestTime: string;
  estimatedReach: string;
}

export function generatePersonalizedFallback(profile: any, seed: number = 0): SuggestedCampaign[] {
  const {
    name = 'Your Brand',
    industry = 'Business',
    niche = '',
    businessType = 'B2C',
    targetAudience = 'customers',
    brandVoice = 'Professional',
    marketingGoals = ['Awareness']
  } = profile || {};

  const industryImages: Record<string, string[]> = {
    Startup: [
      'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1559136555-9303baea8ebd?w=800&h=600&fit=crop'
    ],
    Fitness: [
      'https://images.unsplash.com/photo-1579758629938-03607ccdbaba?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1549576490-b0b4831ef60a?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&h=600&fit=crop'
    ],
    Healthcare: [
      'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1551076805-e1869033e561?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1584515933487-779824d29309?w=800&h=600&fit=crop'
    ],
    Education: [
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1513258496099-48168024aec0?w=800&h=600&fit=crop'
    ],
    Restaurant: [
      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=800&h=600&fit=crop'
    ],
    Beauty: [
      'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1526045478516-99145907023c?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1512496015851-a90fb38ba796?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&h=600&fit=crop'
    ],
    RealEstate: [
      'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1565402170291-8491f14678db?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&h=600&fit=crop'
    ],
    Finance: [
      'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1559526324-593bc073d938?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1565514020179-026b92b84bb6?w=800&h=600&fit=crop'
    ],
    Travel: [
      'https://images.unsplash.com/photo-1504609773096-104ff2c73ba4?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=800&h=600&fit=crop'
    ],
    Food: [
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1499028344343-cd173ffc68a9?w=800&h=600&fit=crop'
    ],
    Marketing: [
      'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1556761175-b413da4baf72?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=800&h=600&fit=crop'
    ],
    Edtech: [
      'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop'
    ],
    Ecommerce: [
      'https://images.unsplash.com/photo-1472851294608-062f824d29cc?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=800&h=600&fit=crop'
    ],
    SaaS: [
      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1504868584819-f8e8b4b6d7e3?w=800&h=600&fit=crop'
    ],
    Service: [
      'https://images.unsplash.com/photo-1521737711867-e3b97375f902?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1556761175-b413da4baf72?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop'
    ],
    Technology: [
      'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1488229297570-58520851e868?w=800&h=600&fit=crop'
    ],
    default: [
      'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
      'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=800&h=600&fit=crop'
    ]
  };

  const nicheLC = (niche || '').toLowerCase();
  const isStartupAccelerator =
    nicheLC.includes('startup') ||
    nicheLC.includes('accelerator') ||
    nicheLC.includes('incubator') ||
    nicheLC.includes('entrepreneurship') ||
    nicheLC.includes('bootcamp');

  const images = isStartupAccelerator ? industryImages.Startup : (industryImages[industry] || industryImages.default);

  const voiceTones: Record<string, { emoji: string; style: string }> = {
    Professional: { emoji: '??', style: 'formal and trustworthy' },
    Witty: { emoji: '??', style: 'fun and clever' },
    Empathetic: { emoji: '??', style: 'warm and caring' },
    Bold: { emoji: '??', style: 'confident and direct' },
    Educational: { emoji: '??', style: 'informative and helpful' }
  };

  const voice = voiceTones[brandVoice] || voiceTones.Professional;
  const isB2B = businessType === 'B2B';

  const allCampaigns: SuggestedCampaign[] = [
    {
      id: 'fb-1',
      title: `${name} Brand Story`,
      caption: `${voice.emoji} What makes ${name} different?\n\nWe're not just another ${industry.toLowerCase()} company. We're here to ${
        niche ? `help with ${niche}` : 'make a real difference for ' + targetAudience
      }.\n\n?? Tell us what brought you here!`,
      imageUrl: images[0],
      platform: 'Instagram',
      objective: 'Awareness',
      hashtags: [`#${name.replace(/\s+/g, '')}`, `#${industry}`, '#BrandStory', '#AboutUs'],
      bestTime: '10:00 AM',
      estimatedReach: '10K - 20K'
    },
    {
      id: 'fb-2',
      title: `Value for ${targetAudience}`,
      caption: isB2B
        ? `?? 3 ways ${name} helps businesses grow:\n\n1?? Streamlined operations\n2?? Data-driven insights\n3?? Expert support\n\n?? See real results -Â¯-â€šÃ‚Â¿-â€šÃ‚Â½ link in bio!`
        : `? Why ${targetAudience || 'our customers'} love ${name}:\n\n?? Quality you can trust\n?? Service that cares\n?? Results that show\n\n?? Share your experience!`,
      imageUrl: images[1],
      platform: isB2B ? 'LinkedIn' : 'Instagram',
      objective: marketingGoals.includes('Sales') ? 'Sales' : 'Engagement',
      hashtags: isB2B
        ? ['#B2B', '#BusinessGrowth', '#Success', '#Enterprise']
        : ['#CustomerLove', '#Reviews', '#Community', '#Testimonial'],
      bestTime: isB2B ? '9:00 AM' : '7:00 PM',
      estimatedReach: isB2B ? '5K - 12K' : '12K - 25K'
    },
    {
      id: 'fb-3',
      title: `Behind the Scenes at ${name}`,
      caption: `?? Ever wonder what happens behind the scenes?\n\nHere's a sneak peek into how we ${
        niche || 'create value for you'
      }!\n\n${voice.emoji} Our team works hard to bring you the best in ${industry.toLowerCase()}.\n\n?? Drop a comment if you want to see more!`,
      imageUrl: images[2] || images[0],
      platform: 'YouTube',
      objective: 'Engagement',
      hashtags: ['#BehindTheScenes', '#BTS', `#${industry}Life`, '#TeamWork'],
      bestTime: '12:00 PM',
      estimatedReach: '15K - 30K'
    },
    {
      id: 'fb-4',
      title: `${industry} Tips & Insights`,
      caption: `?? PRO TIP: 3 things every ${targetAudience || 'person'} should know about ${industry.toLowerCase()}:\n\n1?? Quality matters more than price\n2?? Research before you commit\n3?? Trust proven expertise (like ${name}!)\n\n?? Save this for later!`,
      imageUrl: industryImages.default[2],
      platform: isB2B ? 'LinkedIn' : 'Twitter',
      objective: 'Authority',
      hashtags: [`#${industry}Tips`, '#ProTip', '#ExpertAdvice', '#KnowledgeIsPower'],
      bestTime: '8:00 AM',
      estimatedReach: '8K - 15K'
    },
    {
      id: 'fb-5',
      title: 'Limited Time Offer',
      caption: `?? SPECIAL OFFER for our amazing ${targetAudience || 'followers'}!\n\n${voice.emoji} For a limited time, get exclusive access to our best ${industry.toLowerCase()} solutions.\n\n? Don't wait -Â¯-â€šÃ‚Â¿-â€šÃ‚Â½ this won't last long!\n\n?? Link in bio`,
      imageUrl: 'https://images.unsplash.com/photo-1607082350899-7e105aa886ae?w=800&h=600&fit=crop',
      platform: 'Instagram',
      objective: 'Sales',
      hashtags: ['#LimitedOffer', '#SpecialDeal', '#DontMissOut', `#${name.replace(/\s+/g, '')}`],
      bestTime: '6:00 PM',
      estimatedReach: '20K - 35K'
    },
    {
      id: 'fb-6',
      title: 'Community Question',
      caption: `?? We want to hear from YOU!\n\nWhat's your biggest challenge when it comes to ${
        niche || industry.toLowerCase()
      }?\n\nA) Finding the right solution\nB) Budget constraints\nC) Time management\nD) Something else (tell us!)\n\n?? Vote below!`,
      imageUrl: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&h=600&fit=crop',
      platform: 'Twitter',
      objective: 'Engagement',
      hashtags: ['#Poll', '#Community', '#WeWantToKnow', `#${industry}`],
      bestTime: '3:00 PM',
      estimatedReach: '10K - 18K'
    },
    {
      id: 'fb-7',
      title: 'Meet the Team',
      caption: `?? Meet the faces behind ${name}!\n\nOur passionate team is dedicated to delivering the best ${industry.toLowerCase()} experience for ${targetAudience}.\n\n?? Every success starts with great people.\n\n?? Who would you like to know more about?`,
      imageUrl: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&h=600&fit=crop',
      platform: 'LinkedIn',
      objective: 'Trust',
      hashtags: ['#MeetTheTeam', '#TeamSpotlight', `#${name.replace(/\s+/g, '')}Team`, '#WeAreFamily'],
      bestTime: '11:00 AM',
      estimatedReach: '12K - 22K'
    },
    {
      id: 'fb-8',
      title: `${name} Milestone`,
      caption: `?? Big news! ${name} has just hit an amazing milestone!\n\n${voice.emoji} Thank you to everyone who made this possible -Â¯-â€šÃ‚Â¿-â€šÃ‚Â½ our incredible ${targetAudience} and our dedicated team.\n\nHere's to even bigger things ahead! ??\n\n#Grateful`,
      imageUrl: 'https://images.unsplash.com/photo-1533750349088-cd871a92f312?w=800&h=600&fit=crop',
      platform: 'Instagram',
      objective: 'Engagement',
      hashtags: ['#Milestone', '#Celebration', `#${name.replace(/\s+/g, '')}`, '#ThankYou'],
      bestTime: '2:00 PM',
      estimatedReach: '18K - 30K'
    },
    {
      id: 'fb-9',
      title: 'How It Works',
      caption: `?? Ever wondered how ${name} works?\n\nStep 1??: ${isB2B ? 'Contact us' : 'Browse our offerings'}\nStep 2??: ${
        isB2B ? 'Get a custom solution' : 'Choose what fits you'
      }\nStep 3??: ${isB2B ? 'See measurable results' : 'Enjoy the experience!'}\n\n?? Ready to start? Link in bio!`,
      imageUrl: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&h=600&fit=crop',
      platform: isB2B ? 'LinkedIn' : 'Instagram',
      objective: 'Traffic',
      hashtags: ['#HowItWorks', '#Tutorial', `#${industry}`, '#GetStarted'],
      bestTime: '10:00 AM',
      estimatedReach: '14K - 25K'
    },
    {
      id: 'fb-10',
      title: 'Weekend Special',
      caption: `?? Weekend vibes + Special deals = Perfect combo!\n\nTreat yourself this weekend with exclusive offers from ${name}.\n\n??? Use code WEEKEND${new Date().getDate()} for a special surprise!\n\n? Valid through Sunday!`,
      imageUrl: 'https://images.unsplash.com/photo-1557821552-17105176677c?w=800&h=600&fit=crop',
      platform: 'Instagram',
      objective: 'Sales',
      hashtags: ['#WeekendDeal', '#WeekendVibes', '#TreatYourself', `#${name.replace(/\s+/g, '')}`],
      bestTime: '5:00 PM',
      estimatedReach: '25K - 40K'
    },
    {
      id: 'fb-11',
      title: 'Customer Spotlight',
      caption: `?? CUSTOMER SPOTLIGHT ??\n\n"${name} has completely transformed how I approach ${
        niche || industry.toLowerCase()
      }!" - Happy Customer\n\n?? Want to be featured? Share your story with us!\n\n#CustomerSuccess`,
      imageUrl: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&h=600&fit=crop',
      platform: 'Facebook',
      objective: 'Trust',
      hashtags: ['#CustomerSpotlight', '#Testimonial', '#RealStories', `#${name.replace(/\s+/g, '')}Love`],
      bestTime: '1:00 PM',
      estimatedReach: '9K - 16K'
    },
    {
      id: 'fb-12',
      title: 'Did You Know?',
      caption: `?? Did you know?\n\n${
        industry === 'Technology'
          ? 'The average person checks their phone 96 times a day!'
          : industry === 'Ecommerce'
            ? '70% of shopping carts are abandoned before checkout!'
            : `Most ${targetAudience} make decisions in under 7 seconds!`
      }\n\nThat's why ${name} focuses on ${niche || 'making things simple for you'}.\n\n?? Drop a ?? if this surprised you!`,
      imageUrl: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&h=600&fit=crop',
      platform: 'Twitter',
      objective: 'Engagement',
      hashtags: ['#DidYouKnow', '#FunFact', `#${industry}Facts`, '#LearnSomethingNew'],
      bestTime: '4:00 PM',
      estimatedReach: '11K - 19K'
    }
  ];

  const shuffled = [...allCampaigns].sort(() => {
    const rand = Math.sin(seed * 9999) * 10000;
    return rand - Math.floor(rand);
  });

  return shuffled.slice(0, 6).map((camp, idx) => ({
    ...camp,
    id: `${camp.id}-${seed}-${idx}`
  }));
}
