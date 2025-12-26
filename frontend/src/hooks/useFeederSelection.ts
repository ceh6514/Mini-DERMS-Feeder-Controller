import { useCallback, useEffect, useState } from 'react';
import { fetchFeeders } from '../api/client';
import { FeederInfo } from '../api/types';

export interface FeederSelectionState {
  feeders: FeederInfo[];
  selectedFeederId: string | null;
  setSelectedFeederId: (feederId: string | null) => void;
  toast: string | null;
  setToast: (message: string | null) => void;
}

export const useFeederSelection = (): FeederSelectionState => {
  const [feeders, setFeeders] = useState<FeederInfo[]>([]);
  const [selectedFeederId, setSelectedFeederId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleFeederChange = useCallback((feederId: string | null) => {
    setSelectedFeederId(feederId);
  }, []);

  useEffect(() => {
    fetchFeeders()
      .then((result) => {
        setFeeders(result);
        setSelectedFeederId((current) => current ?? result[0]?.feederId ?? null);
      })
      .catch((err) => setToast(err instanceof Error ? err.message : 'Failed to load feeders'));
  }, []);

  return {
    feeders,
    selectedFeederId,
    setSelectedFeederId: handleFeederChange,
    toast,
    setToast,
  };
};
