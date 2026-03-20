import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { DocumentInputConfig } from '@idp/shared';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import { getPipelineIcon } from '../../common/icons';

interface DocumentInputData {
  config: DocumentInputConfig;
  state: 'idle' | 'active' | 'complete' | 'error';
  fileName?: string;
}

export default memo(function DocumentInputNode({ data }: { data: DocumentInputData }) {
  const config = data.config;
  const state = data.state;
  const fileName = data.fileName;

  const getBorderColor = () => {
    switch (state) {
      case 'active': return '#0972d3';
      case 'complete': return '#037f0c';
      case 'error': return '#d91515';
      default: return '#7d8998';
    }
  };

  return (
    <div
      style={{
        padding: '12px',
        borderRadius: '8px',
        border: `2px solid ${getBorderColor()}`,
        background: '#ffffff',
        width: '180px',
        boxShadow: state === 'active' ? '0 0 10px rgba(9, 114, 211, 0.5)' : '0 2px 4px rgba(0,0,0,0.1)',
        animation: state === 'active' ? 'pulse 2s infinite' : 'none',
      }}
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 10px rgba(9, 114, 211, 0.5); }
          50% { box-shadow: 0 0 20px rgba(9, 114, 211, 0.8); }
        }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        {getPipelineIcon('document-input', 20, '#0972d3')}
        <Box variant="strong" fontSize="body-m">Document Input</Box>
      </div>

      <Box variant="small" color="text-body-secondary" margin={{ bottom: 'xs' }}>
        {config.acceptedTypes.join(', ')}
      </Box>

      {fileName && (
        <Badge color="green">{fileName}</Badge>
      )}

      {state === 'complete' && (
        <div style={{ marginTop: '8px' }}>
          <span style={{ color: '#037f0c', fontSize: '18px' }}>✓</span>
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: '#0972d3' }} />
    </div>
  );
});
