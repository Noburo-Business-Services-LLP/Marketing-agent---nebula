/** Choices and small rules for the business profile form. Everything now comes from the shared question definition. */
export {
  INDUSTRIES as INDUSTRY_CHOICES, industryValueFor, isOtherIndustry, reachFromOld, reachAreasOf,
  COMPANY_SIZES, SALES_CYCLES, VOICES as VOICE_CHOICES, GOALS as GOAL_CHOICES, sellsToBusinesses, toggleIn, voiceList,
} from '../constants/businessQuestions.ts';

/** Audience gender is optional and never asked of a business that only sells to businesses. */
export const showGenderChoice = (type?: string) => type !== 'B2B';
