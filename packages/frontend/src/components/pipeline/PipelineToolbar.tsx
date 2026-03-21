import { useState, useCallback } from 'react';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Button from '@cloudscape-design/components/button';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import Toggle from '@cloudscape-design/components/toggle';
import Box from '@cloudscape-design/components/box';
import type { PipelineDefinition } from '@idp/shared';

interface PipelineToolbarProps {
  pipeline: PipelineDefinition | null;
  isGenerating: boolean;
  isExecuting: boolean;
  onGenerate: (optimizeFor: 'accuracy' | 'cost' | 'speed' | 'balanced', enableHybrid: boolean) => void;
  onExecute: () => void;
  onExport: () => void;
}

export default function PipelineToolbar({
  pipeline,
  isGenerating,
  isExecuting,
  onGenerate,
  onExecute,
  onExport,
}: PipelineToolbarProps) {
  const [optimizeFor, setOptimizeFor] = useState<'accuracy' | 'cost' | 'speed' | 'balanced'>('balanced');
  const [enableHybrid, setEnableHybrid] = useState(true);

  const handleGenerate = useCallback(() => {
    onGenerate(optimizeFor, enableHybrid);
  }, [optimizeFor, enableHybrid, onGenerate]);

  return (
    <div
      style={{
        padding: '16px',
        background: '#ffffff',
        borderRadius: '8px',
        border: '1px solid #d5dbdb',
      }}
    >
      <SpaceBetween direction="horizontal" size="l">
        <div style={{ flex: 1 }}>
          <Box variant="awsui-key-label" margin={{ bottom: 'xs' }}>
            Optimization Strategy
          </Box>
          <SegmentedControl
            selectedId={optimizeFor}
            onChange={({ detail }) =>
              setOptimizeFor(detail.selectedId as 'accuracy' | 'cost' | 'speed' | 'balanced')
            }
            options={[
              { text: 'Accuracy', id: 'accuracy' },
              { text: 'Cost', id: 'cost' },
              { text: 'Speed', id: 'speed' },
              { text: 'Balanced', id: 'balanced' },
            ]}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <Toggle
            checked={enableHybrid}
            onChange={({ detail }) => setEnableHybrid(detail.checked)}
            description="Classifies pages by content type (table, image, text, form) and routes each to the best-suited AI model. Recommended for multi-page documents with mixed content."
          >
            <Box variant="awsui-key-label">Hybrid Routing</Box>
          </Toggle>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
          <Button
            onClick={handleGenerate}
            loading={isGenerating}
            disabled={isGenerating || isExecuting}
            iconName="refresh"
          >
            Re-Generate Pipeline
          </Button>

          {pipeline && (
            <>
              <Button
                variant="primary"
                onClick={onExecute}
                loading={isExecuting}
                disabled={isGenerating || isExecuting}
                iconName="caret-right-filled"
              >
                Execute Pipeline
              </Button>

              <Button
                iconName="download"
                onClick={onExport}
                disabled={isGenerating || isExecuting}
              >
                Export
              </Button>
            </>
          )}
        </div>
      </SpaceBetween>
    </div>
  );
}
