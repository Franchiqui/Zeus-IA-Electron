'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

type AutonomyLevel = 'manual' | 'assisted' | 'full';

interface AutonomyContextType {
  autonomyLevel: AutonomyLevel;
  setAutonomyLevel: (level: AutonomyLevel) => void;
}

const AutonomyContext = createContext<AutonomyContextType | undefined>(undefined);

export function AutonomyProvider({ children }: { children: ReactNode }) {
  const [autonomyLevel, setAutonomyLevel] = useState<AutonomyLevel>('assisted');
  return (
    <AutonomyContext.Provider value={{ autonomyLevel, setAutonomyLevel }}>
      {children}
    </AutonomyContext.Provider>
  );
}

export function useAutonomy(): AutonomyContextType {
  const context = useContext(AutonomyContext);
  if (!context) {
    return { autonomyLevel: 'assisted', setAutonomyLevel: () => {} };
  }
  return context;
}
