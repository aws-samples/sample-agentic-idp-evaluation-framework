import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { CapabilityNodeConfig } from '@idp/shared';
import { CAPABILITY_INFO, CATEGORY_INFO } from '@idp/shared';
import Box from '@cloudscape-design/components/box';
import ProgressBar from '@cloudscape-design/components/progress-bar';

interface CapabilityNodeData {
  config: CapabilityNodeConfig & {
    assignedMethod?: string;
    assignedMethodName?: string;
    assignedMethodFamily?: string;
  };
  description?: string;
  state: 'idle' | 'active' | 'complete' | 'error';
  progress?: number;
}

const FAMILY_COLORS: Record<string, string> = {
  claude: '#7b61ff',
  nova: '#ff9900',
  'textract-llm': '#0972d3',
  bda: '#037f0c',
  textract: '#0972d3',
};

export default memo(function CapabilityNode({ data }: { data: CapabilityNodeData }) {
  const config = data.config;
  const state = data.state;
  const progress = data.progress;
  const capInfo = CAPABILITY_INFO[config.capability];
  const categoryInfo = CATEGORY_INFO[capInfo.category];

  const getBorderColor = () => {
    switch (state) {
      case 'active': return '#0972d3';
      case 'complete': return '#037f0c';
      case 'error': return '#d91515';
      default: return '#d5dbdb';
    }
  };

  const familyColor = config.assignedMethodFamily
    ? FAMILY_COLORS[config.assignedMethodFamily] ?? '#5f6b7a'
    : '#5f6b7a';

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: '8px',
        border: `2px solid ${getBorderColor()}`,
        background: '#ffffff',
        width: '180px',
        boxShadow: state === 'active' ? '0 0 8px rgba(9,114,211,0.4)' : '0 1px 3px rgba(0,0,0,0.08)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: categoryInfo.color }} />

      <div style={{ marginBottom: '4px' }}>
        <Box variant="strong" fontSize="body-s">{capInfo.name}</Box>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        marginBottom: '4px',
      }}>
        <span style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: categoryInfo.color,
        }} />
        <span style={{ fontSize: '11px', color: '#5f6b7a' }}>
          {categoryInfo.name}
        </span>
      </div>

      {config.assignedMethodName && (
        <div style={{
          marginTop: '4px',
          padding: '3px 8px',
          borderRadius: '4px',
          background: `${familyColor}12`,
          border: `1px solid ${familyColor}30`,
          fontSize: '11px',
          fontWeight: 500,
          color: familyColor,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>{config.assignedMethodName}</span>
          {(config as any).assignedMethod && (
            <span style={{ fontSize: '10px', opacity: 0.8 }}>
              {(() => {
                // Display cost from description if available
                const match = data.description?.match(/\$[\d.]+\/page/);
                return match ? match[0] : '';
              })()}
            </span>
          )}
        </div>
      )}

      {state === 'active' && progress !== undefined && (
        <div style={{ marginTop: '6px' }}>
          <ProgressBar value={progress} />
        </div>
      )}

      {state === 'complete' && (
        <div style={{ marginTop: '4px', fontSize: '11px', color: '#037f0c', fontWeight: 600 }}>
          Complete
        </div>
      )}

      {state === 'error' && (
        <div style={{ marginTop: '4px', fontSize: '11px', color: '#d91515', fontWeight: 600 }}>
          Failed
        </div>
      )}

      <Handle type="source" position={Position.Right} style={{ background: categoryInfo.color }} />
    </div>
  );
});
