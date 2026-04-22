import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { MethodNodeConfig, MethodFamily } from '@idp/shared';
import { METHOD_INFO } from '@idp/shared';
import Box from '@cloudscape-design/components/box';
import Badge from '@cloudscape-design/components/badge';
import Spinner from '@cloudscape-design/components/spinner';
import { getCapabilityIcon } from '../../common/icons';

interface MethodNodeData {
  config: MethodNodeConfig & { capabilities?: string[] };
  state: 'idle' | 'active' | 'complete' | 'error';
  metrics?: { latencyMs: number; cost: number };
}

const FAMILY_COLORS: Record<MethodFamily, string> = {
  bda: '#0972d3',
  'bda-llm': '#0891b2',
  claude: '#8b5cf6',
  nova: '#ec7211',
  'textract-llm': '#037f0c', embeddings: '#2563eb',
  guardrails: '#d13212',
};

export default memo(function MethodNode({ data }: { data: MethodNodeData }) {
  const config = data.config;
  const state = data.state;
  const metrics = data.metrics;
  const methodInfo = METHOD_INFO[config.method];
  const familyColor = FAMILY_COLORS[config.family];
  const capabilities = config.capabilities ?? [];

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
        minWidth: '200px',
        maxWidth: '260px',
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <Box variant="strong" fontSize="body-m">{methodInfo.shortName}</Box>
        <Badge color="blue">{config.family}</Badge>
      </div>

      <Box variant="small" fontWeight="bold">
        ~${methodInfo.estimatedCostPerPage.toFixed(3)}/page
      </Box>

      {capabilities.length > 0 && (
        <div style={{ marginTop: '8px', borderTop: '1px solid #e9ebed', paddingTop: '6px' }}>
          <Box variant="small" color="text-body-secondary" fontWeight="bold">
            {capabilities.length} capabilities:
          </Box>
          <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {capabilities.map((cap: string) => (
              <div key={cap} style={{ fontSize: '11px', color: '#414d5c', display: 'flex', alignItems: 'center', gap: '5px' }}>
                {getCapabilityIcon(cap, 13, familyColor)}
                {cap.replace(/_/g, ' ')}
              </div>
            ))}
          </div>
        </div>
      )}

      {state === 'active' && (
        <div style={{ marginTop: '8px', textAlign: 'center' }}>
          <Spinner />
          <Box variant="small" color="text-body-secondary" margin={{ top: 'xxs' }}>
            {config.family === 'bda' || config.family === 'bda-llm' ? 'Polling BDA...' :
             config.family === 'textract-llm' ? 'OCR + LLM...' :
             'Streaming...'}
          </Box>
        </div>
      )}

      {state === 'complete' && metrics && (
        <div style={{ marginTop: '8px' }}>
          <Box variant="small" color="text-status-success">
            &#10003; {metrics.latencyMs}ms &middot; ${metrics.cost.toFixed(4)}
          </Box>
        </div>
      )}

      {state === 'error' && (
        <div style={{ marginTop: '8px' }}>
          <Box variant="small" color="text-status-error">&#10007; Failed</Box>
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: familyColor }} />
    </div>
  );
});
