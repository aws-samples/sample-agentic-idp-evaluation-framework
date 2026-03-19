import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { MethodNodeConfig, MethodFamily } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import Spinner from '@cloudscape-design/components/spinner';

interface MethodNodeData {
  config: MethodNodeConfig;
  state: 'idle' | 'active' | 'complete' | 'error';
  metrics?: { latencyMs: number; cost: number };
}

const FAMILY_COLORS: Record<MethodFamily, string> = {
  bda: '#0972d3',
  'bda-llm': '#0891b2',
  claude: '#8b5cf6',
  nova: '#ec7211',
  'textract-llm': '#037f0c', embeddings: '#2563eb',
};

export default memo(function MethodNode({ data }: { data: MethodNodeData }) {
  const config = data.config;
  const state = data.state;
  const metrics = data.metrics;
  const methodInfo = METHOD_INFO[config.method];
  const familyColor = FAMILY_COLORS[config.family];

  const getBorderColor = () => {
    switch (state) {
      case 'active': return familyColor;
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
        boxShadow: state === 'active' ? `0 0 10px ${familyColor}80` : '0 2px 4px rgba(0,0,0,0.1)',
        animation: state === 'active' ? 'pulse 2s infinite' : 'none',
      }}
    >
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 10px ${familyColor}80; }
          50% { box-shadow: 0 0 20px ${familyColor}cc; }
        }
      `}</style>

      <Handle type="target" position={Position.Left} style={{ background: familyColor }} />

      <div style={{ marginBottom: '8px' }}>
        <Box variant="strong" fontSize="body-m">{methodInfo.shortName}</Box>
      </div>

      <Badge color="blue">{config.family}</Badge>

      <Box variant="small" color="text-body-secondary" margin={{ top: 'xs' }}>
        {methodInfo.modelId}
      </Box>

      <Box variant="small" fontWeight="bold" margin={{ top: 'xs' }}>
        ~${methodInfo.estimatedCostPerPage.toFixed(3)}/page*
      </Box>

      <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
        {methodInfo.strengths.slice(0, 2).map((strength: string, idx: number) => (
          <Badge key={idx} color="green">{strength}</Badge>
        ))}
      </div>

      {state === 'active' && (
        <div style={{ marginTop: '8px', textAlign: 'center' }}>
          <Spinner />
        </div>
      )}

      {state === 'complete' && metrics && (
        <div style={{ marginTop: '8px' }}>
          <Box variant="small" color="text-status-success">
            ✓ {metrics.latencyMs}ms · ${metrics.cost.toFixed(4)}
          </Box>
        </div>
      )}

      {state === 'error' && (
        <div style={{ marginTop: '8px' }}>
          <span style={{ color: '#d91515', fontSize: '18px' }}>✗</span>
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: familyColor }} />
    </div>
  );
});
