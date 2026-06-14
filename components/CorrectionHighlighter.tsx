import React from 'react';

interface Change {
  type?: 'added' | 'removed' | 'modified';
  oldContent?: string;
  newContent?: string;
  line?: number;
}

interface CorrectionHighlighterProps {
  changes: Change[];
}

const CorrectionHighlighter = ({ changes }: CorrectionHighlighterProps) => {
  if (!changes || changes.length === 0) {
    return <p>No hay cambios que mostrar.</p>;
  }

  // Lógica para mapear y renderizar el diff línea por línea.
  // Esto debe usar el marcado CSS adecuado para resaltar la adición/eliminación.
  return (
    <div className="highlight-container">
      {/* Ejemplo de renderizado de un cambio de línea */}
      {changes.map((change, index) => (
        <div key={index} className={`line-diff ${change.type || 'added'}'`}>
          {/* Renderizar la línea original (tachada) y la nueva línea */} 
          <span className="removed">{change.oldContent}</span>
          <span className="added">{change.newContent}</span>
        </div>
      ))}
    </div>
  );
};

export default CorrectionHighlighter;
