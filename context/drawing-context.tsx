'use client';

import React, { createContext, useContext, useReducer, ReactNode } from 'react';

interface DrawingState {
  isDrawing: boolean;
  currentTool: 'pen' | 'eraser' | 'select';
  strokeWidth: number;
  strokeColor: string;
  canvasData: any[];
}

type DrawingAction =
  | { type: 'START_DRAWING' }
  | { type: 'STOP_DRAWING' }
  | { type: 'SET_TOOL'; tool: 'pen' | 'eraser' | 'select' }
  | { type: 'SET_STROKE_WIDTH'; width: number }
  | { type: 'SET_STROKE_COLOR'; color: string }
  | { type: 'ADD_STROKE'; stroke: any }
  | { type: 'CLEAR_CANVAS' }
  | { type: 'UNDO' };

const initialState: DrawingState = {
  isDrawing: false,
  currentTool: 'pen',
  strokeWidth: 2,
  strokeColor: '#000000',
  canvasData: [],
};

function drawingReducer(state: DrawingState, action: DrawingAction): DrawingState {
  switch (action.type) {
    case 'START_DRAWING':
      return { ...state, isDrawing: true };
    case 'STOP_DRAWING':
      return { ...state, isDrawing: false };
    case 'SET_TOOL':
      return { ...state, currentTool: action.tool };
    case 'SET_STROKE_WIDTH':
      return { ...state, strokeWidth: action.width };
    case 'SET_STROKE_COLOR':
      return { ...state, strokeColor: action.color };
    case 'ADD_STROKE':
      return { ...state, canvasData: [...state.canvasData, action.stroke] };
    case 'CLEAR_CANVAS':
      return { ...state, canvasData: [] };
    case 'UNDO':
      return { ...state, canvasData: state.canvasData.slice(0, -1) };
    default:
      return state;
  }
}

const DrawingContext = createContext<{
  state: DrawingState;
  dispatch: React.Dispatch<DrawingAction>;
} | null>(null);

export function DrawingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(drawingReducer, initialState);

  return (
    <DrawingContext.Provider value={{ state, dispatch }}>
      {children}
    </DrawingContext.Provider>
  );
}

export function useDrawing() {
  const context = useContext(DrawingContext);
  if (!context) {
    throw new Error('useDrawing must be used within a DrawingProvider');
  }
  return context;
}
