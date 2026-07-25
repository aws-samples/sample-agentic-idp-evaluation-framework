import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { PageClassifierConfig } from '@idp/shared';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import { getPipelineIcon } from '../../common/icons';
import { nodeBorderColor, nodeDivider, NODE_STATUS_COLORS } from './node-style';
import { token } from '../../../theme/tokens';

interface PageClassifierData {
  config: PageClassifierConfig;
  state: 'idle' | 'active' | 'complete' | 'error';
}

export default memo(function PageClassifierNode({ data }: { data: PageClassifierData }) {
  const config = data.config;
  const state = data.state;


  return (
    <div
      style={{
        padding: '12px',
        borderRadius: '8px',
        border: `2px solid ${nodeBorderColor(state)}`,
        background: token.surface,
        color: token.text,
        width: '200px',
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

      <Handle type="target" position={Position.Left} style={{ background: NODE_STATUS_COLORS.active }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        {getPipelineIcon('page-classifier', 20, '#0972d3')}
        <Box variant="strong" fontSize="body-m">Page Classifier</Box>
      </div>

      <Box variant="small" color="text-body-secondary" margin={{ bottom: 'xs' }}>
        {config.classifyBy}
      </Box>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' }}>
        {config.contentTypes.map((type: string) => (
          <Badge key={type} color="blue">{type}</Badge>
        ))}
      </div>

      {state === 'complete' && (
        <div style={{ marginTop: '8px' }}>
          <span style={{ color: '#037f0c', fontSize: '18px' }}>✓</span>
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: NODE_STATUS_COLORS.active }} />
    </div>
  );
});
