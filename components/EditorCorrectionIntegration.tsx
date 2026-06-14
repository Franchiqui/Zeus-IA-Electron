import React, { useState } from 'react';
import CorrectionHighlighter from './CorrectionHighlighter';

interface CorrectionChange {
  type?: 'added' | 'removed' | 'modified';
  oldContent?: string;
  newContent?: string;
  line?: number;
}

interface CorrectionProposal {
  file: string;
  changes: CorrectionChange[];
}

interface EditorCorrectionIntegrationProps {
  proposal: CorrectionProposal;
  onClose: (accepted: boolean) => void;
}

const EditorCorrectionIntegration = ({ proposal, onClose }: EditorCorrectionIntegrationProps) => {
  const [view, setView] = useState('diff'); // 'diff' o 'preview'

  if (!proposal) return null;

  // Handler para aceptar la corrección
  const handleAccept = () => {
    // Lógica para aplicar los cambios en el estado global del editor
    console.log("Aceptando corrección:", proposal.changes);
    // Aquí se llamaría a la función del editor principal para actualizar el contenido.
    onClose(true); // Cierra la integración llamando al callback con éxito
  };

  // Handler para cancelar la corrección
  const handleCancel = () => {
    console.log("Cancelando corrección propuesta.");
    onClose(false); // Cierra la integración llamando al callback con fallo
  };

  return (
    <div className="correction-modal">
      <h3>Corrección detectada en {proposal.file}</h3>
      <div className="diff-viewer">
        <CorrectionHighlighter changes={proposal.changes} />
      </div>
      <div className="action-buttons">
        <button onClick={handleAccept} className="btn-accept">Aceptar Cambios</button>
        <button onClick={handleCancel} className="btn-cancel">Cancelar</button>
      </div>
    </div>
  );
};

export default EditorCorrectionIntegration;
