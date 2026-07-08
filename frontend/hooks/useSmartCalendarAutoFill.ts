import { useState, useEffect } from 'react';
import { contentCalendarAPI } from '../services/api';
import { ContentCalendarItem } from '../types';

export const useSmartCalendarAutoFill = (type?: 'post' | 'reel' | 'campaign') => {
  const [isAutoFillEnabled, setIsAutoFillEnabled] = useState(false);
  const [availableItems, setAvailableItems] = useState<ContentCalendarItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getActiveWeekNumber = (): number => {
    const day = new Date().getDate();
    if (day <= 7) return 1;
    if (day <= 14) return 2;
    if (day <= 21) return 3;
    return 4;
  };

  useEffect(() => {
    let isMounted = true;

    const fetchCalendarItems = async () => {
      setIsLoading(true);
      setError(null);
      
      try {
        const response = await contentCalendarAPI.get();
        if (response.calendar && isMounted) {
          // Use the calendar's autoGenerate setting as the source of truth
          const isAutoEnabled = Boolean(response.calendar.autoGenerate);
          setIsAutoFillEnabled(isAutoEnabled);
          
          if (!isAutoEnabled) {
            setAvailableItems([]);
            return;
          }

          const currentWeekNumber = getActiveWeekNumber();
          const currentWeek = response.calendar.weeks.find(
            (w: any) => w.weekNumber === currentWeekNumber
          );
          
          if (currentWeek && currentWeek.items && currentWeek.items.length > 0) {
            // First, filter based on the current page type
            let typeFilteredItems = currentWeek.items;
            if (type === 'post') {
              typeFilteredItems = typeFilteredItems.filter((item: ContentCalendarItem) => ['post', 'carousel', 'poster', 'image', 'story'].includes(item.format?.toLowerCase() || ''));
            } else if (type === 'reel') {
              typeFilteredItems = typeFilteredItems.filter((item: ContentCalendarItem) => ['reel', 'video', 'short'].includes(item.format?.toLowerCase() || ''));
            }

            // Then, filter out items that have already been generated or rejected
            let unusedItems = typeFilteredItems.filter(
              (item: ContentCalendarItem) => !item.generatedCampaignId && !item.generatedDraftId && item.status !== 'rejected'
            );

            setAvailableItems(unusedItems);
            
            // FIFO: Automatically select the first available item
            if (unusedItems.length > 0) {
              setSelectedItemId(unusedItems[0]._id);
            } else {
              setError('No pending Smart Calendar items available.');
            }
          } else {
            setAvailableItems([]);
            setError('No Smart Calendar content available for this week.');
          }
        }
      } catch (err: any) {
        console.error('Failed to fetch smart calendar:', err);
        if (isMounted) {
          setAvailableItems([]);
          setError('Failed to fetch Smart Calendar content.');
          setIsAutoFillEnabled(false);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchCalendarItems();

    return () => {
      isMounted = false;
    };
  }, [type]); // Refetch if type changes

  const selectedItem = availableItems.find(item => item._id === selectedItemId);

  const getMappedData = (item: ContentCalendarItem) => {
    // Determine a few common derived properties
    const combinedPrompt = `${item.creativeConcept || ''} (Style: ${item.shootType || 'Standard'}, Focus: ${item.productNeeded || 'General'})`.trim();
    const hashtags = `#${(item.contentPillar || 'Content').replace(/\s+/g, '')} #${(item.objective || 'Goal').replace(/\s+/g, '')}`;
    const keywords = `${item.contentPillar || ''}, ${item.objective || ''}`;

    return {
      title: item.headline || '',
      caption: item.creativeConcept || '',
      imagePrompt: combinedPrompt,
      videoPrompt: combinedPrompt,
      hashtags: hashtags,
      keywords: keywords,
      cta: item.cta || '',
      story: item.creativeConcept || '',
      characterDescription: item.productNeeded || 'Main subject',
      contentTheme: item.contentPillar || ''
    };
  };

  return {
    isAutoFillEnabled,
    setIsAutoFillEnabled,
    availableItems,
    selectedItemId,
    setSelectedItemId,
    selectedItem,
    isLoading,
    error,
    getMappedData
  };
};
