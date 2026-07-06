import { useState, useEffect } from 'react';
import { contentCalendarAPI } from '../services/api';
import { ContentCalendarItem } from '../types';

export const useSmartCalendarAutoFill = () => {
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
      if (!isAutoFillEnabled) return;
      
      setIsLoading(true);
      setError(null);
      
      try {
        const response = await contentCalendarAPI.get();
        if (response.calendar && isMounted) {
          const currentWeekNumber = getActiveWeekNumber();
          const currentWeek = response.calendar.weeks.find(
            (w: any) => w.weekNumber === currentWeekNumber
          );
          
          if (currentWeek && currentWeek.items && currentWeek.items.length > 0) {
            setAvailableItems(currentWeek.items);
            if (!selectedItemId) {
              setSelectedItemId(currentWeek.items[0]._id);
            }
          } else {
            setAvailableItems([]);
            setError('No Smart Calendar content available for this week.');
            setIsAutoFillEnabled(false);
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
  }, [isAutoFillEnabled, selectedItemId]);

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
