import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface ImageEditorState {
  // Image state
  originalImage: string | null;
  modifiedImage: string | null;
  isProcessing: boolean;
  
  // Editor settings
  brightness: number;
  contrast: number;
  saturation: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  
  // Actions
  setOriginalImage: (image: string) => void;
  setModifiedImage: (image: string) => void;
  updateEditorSetting: (setting: Partial<Omit<ImageEditorState, 'originalImage' | 'modifiedImage' | 'setOriginalImage' | 'setModifiedImage' | 'updateEditorSetting' | 'resetEditor'>>) => void;
  resetEditor: () => void;
}

export const useImageEditorStore = create<ImageEditorState>()(
  devtools(
    (set) => ({
      originalImage: null,
      modifiedImage: null,
      isProcessing: false,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      rotation: 0,
      flipX: false,
      flipY: false,
      
      setOriginalImage: (image) => set({ originalImage: image, modifiedImage: image }),
      setModifiedImage: (image) => set({ modifiedImage: image }),
      
      updateEditorSetting: (settings) => set((state) => ({
        ...settings,
        isProcessing: true
      }), false, 'updateEditorSetting'),
      
      resetEditor: () => set({
        modifiedImage: null,
        brightness: 100,
        contrast: 100,
        saturation: 100,
        rotation: 0,
        flipX: false,
        flipY: false,
        isProcessing: false
      }, false, 'resetEditor')
    }),
    {
      name: 'image-editor-store',
    }
  )
);

// Utility function to get image data from file
export const getImageData = (file: File): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.readAsDataURL(file);
  });
};

// Export utility functions
export const imageEditorUtils = {
  loadImage: async (file: File): Promise<string> => {
    return await getImageData(file);
  },
  
  applyFilters: (image: HTMLImageElement, settings: Partial<ImageEditorState>): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    
    // Set canvas dimensions
    canvas.width = image.width;
    canvas.height = image.height;
    
    // Apply transformations
    ctx.save();
    
    // Apply flip
    if (settings.flipX || settings.flipY) {
      ctx.translate(
        settings.flipX ? canvas.width : 0,
        settings.flipY ? canvas.height : 0
      );
      ctx.scale(
        settings.flipX ? -1 : 1,
        settings.flipY ? -1 : 1
      );
    }
    
    // Apply rotation
    if (settings.rotation) {
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((settings.rotation * Math.PI) / 180);
      ctx.translate(-canvas.width / 2, -canvas.height / 2);
    }
    
    // Draw the image
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    
    // Apply filters
    const brightnessValue = settings.brightness !== undefined ? settings.brightness / 100 : 1;
    const contrastValue = settings.contrast !== undefined ? settings.contrast : 100;
    const saturationValue = settings.saturation !== undefined ? settings.saturation : 100;
    
    if (brightnessValue !== 1 || contrastValue !== 100 || saturationValue !== 100) {
      const filter = `brightness(${brightnessValue}) contrast(${contrastValue}%) saturate(${saturationValue}%)`;
      ctx.filter = filter;
      ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
    }
    
    ctx.restore();
    return canvas;
  }
};
