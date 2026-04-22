import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { SequentialComposerConfig } from '@idp/shared';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import { getPipelineIcon } from '../../common/icons';

interface SequentialComposerNodeData {
  config: SequentialComposerConfig;
  state: 'idle' | 'active' | 'complete' | 'error';
  metrics?: { latencyMs: number; cost: number };
}

export default memo(function SequentialComposerNode({ data }: { data: SequentialComposerNodeData }) {
  const config = data.config;
  const state = data.state;

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
        width: '160px',
        boxShadow: state === 'active'
          ? '0 0 10px rgba(9, 114, 211, 0.5)'
          : '0 2px 4px rgba(0,0,0,0.1)',
        animation: state === 'active' ? 'pulse 2s infinite' : 'none',
      }}
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 10px rgba(9, 114, 211, 0.5); }
          50% { box-shadow: 0 0 20px rgba(9, 114, 211, 0.8); }
        }
      `}</style>

      <Handle type="target" position={Position.Left} style={{ background: '#0972d3' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        {getPipelineIcon('sequential-composer', 20, '#0972d3')}
        <Box variant="strong" fontSize="body-m">Sequential</Box>
      </div>

      <Badge color="blue">{config.stages.length} stage{config.stages.length === 1 ? '' : 's'}</Badge>

      <Box variant="small" margin={{ top: 'xs' }} color="text-body-secondary">
        Extract → Redact
      </Box>

      {state === 'complete' && (
        <div style={{ marginTop: '8px' }}>
          <Box variant="small" color="text-status-success">
            ✓ Chained
          </Box>
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: '#0972d3' }} />
    </div>
  );
});
