import React, { createContext, useContext, useState } from 'react';

interface FileContextType {
  files: File[];
  addFile: (file: File) => void;
  removeFile: (fileName: string) => void;
  // Add more file management methods as needed
}

const FileContext = createContext<FileContextType | undefined>(undefined);

export function FileProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<File[]>([]);

  const addFile = (file: File) => {
    setFiles(prev => [...prev, file]);
  };

  const removeFile = (fileName: string) => {
    setFiles(prev => prev.filter(file => file.name !== fileName));
  };

  const value = {
    files,
    addFile,
    removeFile,
  };

  return (
    <FileContext.Provider value={value}>
      {children}
    </FileContext.Provider>
  );
}

export function useFile() {
  const context = useContext(FileContext);
  if (context === undefined) {
    throw new Error('useFile must be used within a FileProvider');
  }
  return context;
}