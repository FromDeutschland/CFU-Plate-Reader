import { useState, useCallback, useEffect } from 'react';
import type { TrainingSession, ColonyFeatures, DetectionParams } from '../types';
import { DEFAULT_PARAMS } from '../types';
import { refineParams } from '../utils/colonyDetection';

const STORAGE_KEY = 'cfu-training-v1';

function loadSession(): TrainingSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as TrainingSession;
  } catch { /* ignore */ }
  return {
    accepted: [],
    rejected: [],
    learnedParams: {},
    sessionCount: 0,
    lastUpdated: new Date().toISOString(),
  };
}

function saveSession(session: TrainingSession) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch { /* storage full — silently skip */ }
}

export function useTrainingData() {
  const [session, setSession] = useState<TrainingSession>(loadSession);

  useEffect(() => {
    saveSession(session);
  }, [session]);

  const recordAccepted = useCallback((features: ColonyFeatures[]) => {
    setSession(prev => {
      const next: TrainingSession = {
        ...prev,
        accepted: [...prev.accepted, ...features].slice(-500),
        sessionCount: prev.sessionCount + 1,
        lastUpdated: new Date().toISOString(),
      };
      next.learnedParams = refineParams(
        { ...DEFAULT_PARAMS, ...prev.learnedParams },
        next.accepted,
        next.rejected
      );
      return next;
    });
  }, []);

  const recordRejected = useCallback((features: ColonyFeatures[]) => {
    setSession(prev => {
      const next: TrainingSession = {
        ...prev,
        rejected: [...prev.rejected, ...features].slice(-500),
        lastUpdated: new Date().toISOString(),
      };
      next.learnedParams = refineParams(
        { ...DEFAULT_PARAMS, ...prev.learnedParams },
        next.accepted,
        next.rejected
      );
      return next;
    });
  }, []);

  const getLearnedParams = useCallback(
    (base: DetectionParams): DetectionParams => {
      const merged: DetectionParams = {
        ...base,
        ...session.learnedParams,
      };
      if (base.calibration) {
        merged.calibration = base.calibration;
        merged.threshold = base.threshold;
        merged.invertImage = base.invertImage;
      }
      return merged;
    },
    [session.learnedParams]
  );

  const resetTraining = useCallback(() => {
    const fresh: TrainingSession = {
      accepted: [],
      rejected: [],
      learnedParams: {},
      sessionCount: 0,
      lastUpdated: new Date().toISOString(),
    };
    setSession(fresh);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    session,
    recordAccepted,
    recordRejected,
    getLearnedParams,
    resetTraining,
    totalSamples: session.accepted.length + session.rejected.length,
  };
}
