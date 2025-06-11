import React, { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

export interface ProgressStep {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  detail?: string;
  subSteps?: ProgressSubStep[];
  startTime?: number;
  endTime?: number;
}

export interface ProgressSubStep {
  id: string;
  name: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  detail?: string;
  current?: number;
  total?: number;
}

interface ProgressContextType {
  isActive: boolean;
  steps: ProgressStep[];
  currentStepId: string | null;
  startProgress: () => void;
  addStep: (step: Omit<ProgressStep, 'status'>) => void;
  updateStep: (stepId: string, updates: Partial<ProgressStep>) => void;
  addSubStep: (stepId: string, subStep: Omit<ProgressSubStep, 'status'>) => void;
  updateSubStep: (stepId: string, subStepId: string, updates: Partial<ProgressSubStep>) => void;
  completeStep: (stepId: string, detail?: string) => void;
  errorStep: (stepId: string, error: string) => void;
  completeProgress: () => void;
  resetProgress: () => void;
}

const ProgressContext = createContext<ProgressContextType | undefined>(undefined);

export function useProgress() {
  const context = useContext(ProgressContext);
  if (context === undefined) {
    throw new Error('useProgress must be used within a ProgressProvider');
  }
  return context;
}

interface ProgressProviderProps {
  children: ReactNode;
}

export function ProgressProvider({ children }: ProgressProviderProps) {
  const [isActive, setIsActive] = useState(false);
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [currentStepId, setCurrentStepId] = useState<string | null>(null);

  const startProgress = () => {
    setIsActive(true);
    setSteps([]);
    setCurrentStepId(null);
  };

  const addStep = (step: Omit<ProgressStep, 'status'>) => {
    const newStep: ProgressStep = {
      ...step,
      status: 'pending',
      startTime: Date.now(),
    };
    setSteps(prev => [...prev, newStep]);
    setCurrentStepId(step.id);
  };

  const updateStep = (stepId: string, updates: Partial<ProgressStep>) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId 
        ? { ...step, ...updates }
        : step
    ));
    if (updates.status === 'in-progress') {
      setCurrentStepId(stepId);
    }
  };

  const addSubStep = (stepId: string, subStep: Omit<ProgressSubStep, 'status'>) => {
    setSteps(prev => prev.map(step => {
      if (step.id === stepId) {
        const newSubStep: ProgressSubStep = {
          ...subStep,
          status: 'pending',
        };
        const updatedSubSteps = [...(step.subSteps || []), newSubStep];
        return { ...step, subSteps: updatedSubSteps };
      }
      return step;
    }));
  };

  const updateSubStep = (stepId: string, subStepId: string, updates: Partial<ProgressSubStep>) => {
    setSteps(prev => prev.map(step => {
      if (step.id === stepId) {
        const updatedSubSteps = step.subSteps?.map(subStep =>
          subStep.id === subStepId 
            ? { ...subStep, ...updates }
            : subStep
        ) || [];
        return { ...step, subSteps: updatedSubSteps };
      }
      return step;
    }));
  };

  const completeStep = (stepId: string, detail?: string) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId 
        ? { 
            ...step, 
            status: 'completed' as const, 
            detail, 
            endTime: Date.now() 
          }
        : step
    ));
  };

  const errorStep = (stepId: string, error: string) => {
    setSteps(prev => prev.map(step => 
      step.id === stepId 
        ? { 
            ...step, 
            status: 'error' as const, 
            detail: error, 
            endTime: Date.now() 
          }
        : step
    ));
  };

  const completeProgress = () => {
    setIsActive(false);
    setCurrentStepId(null);
  };

  const resetProgress = () => {
    setIsActive(false);
    setSteps([]);
    setCurrentStepId(null);
  };

  return (
    <ProgressContext.Provider
      value={{
        isActive,
        steps,
        currentStepId,
        startProgress,
        addStep,
        updateStep,
        addSubStep,
        updateSubStep,
        completeStep,
        errorStep,
        completeProgress,
        resetProgress,
      }}
    >
      {children}
    </ProgressContext.Provider>
  );
} 