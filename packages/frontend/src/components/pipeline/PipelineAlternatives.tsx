import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import type { PipelineDefinition } from '@idp/shared';

interface PipelineAlternativesProps {
  alternatives: PipelineDefinition[];
  currentPipeline: PipelineDefinition | null;
  onSwitch: (pipeline: PipelineDefinition) => void;
  disabled?: boolean;
}

export default function PipelineAlternatives({
  alternatives,
  currentPipeline,
  onSwitch,
  disabled,
}: PipelineAlternativesProps) {
  if (alternatives.length === 0) {
    return null;
  }

  return (
    <Container
      header={
        <Header variant="h2" description="Alternative pipeline configurations">
          Alternative Pipelines
        </Header>
      }
    >
      <SpaceBetween size="m">
        {alternatives.map((alt) => {
          const isActive = currentPipeline?.id === alt.id;

          return (
            <div
              key={alt.id}
              style={{
                padding: '12px',
                border: `2px solid ${isActive ? '#0972d3' : '#d5dbdb'}`,
                borderRadius: '8px',
                background: isActive ? '#f0f8ff' : '#ffffff',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
              }}
              onClick={() => !disabled && !isActive && onSwitch(alt)}
            >
              <SpaceBetween size="xs">
                <Box variant="strong" fontSize="heading-s">
                  {alt.name}
                </Box>

                <Box variant="small" color="text-body-secondary">
                  {alt.description}
                </Box>

                <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                  <div>
                    <Box variant="small" color="text-label">
                      Est. Cost
                    </Box>
                    <Box variant="strong" color="text-status-info">
                      ${alt.estimatedCostPerPage.toFixed(3)}/page
                    </Box>
                  </div>

                  <div>
                    <Box variant="small" color="text-label">
                      Est. Latency
                    </Box>
                    <Box variant="strong" color="text-status-info">
                      {alt.estimatedLatencyMs}ms
                    </Box>
                  </div>

                  <div>
                    <Box variant="small" color="text-label">
                      Nodes
                    </Box>
                    <Box variant="strong" color="text-status-info">
                      {alt.nodes.length}
                    </Box>
                  </div>
                </div>

                {!isActive && (
                  <Button
                    variant="normal"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!disabled) onSwitch(alt);
                    }}
                    disabled={disabled}
                  >
                    Switch to this pipeline
                  </Button>
                )}

                {isActive && (
                  <Box color="text-status-info" variant="strong">
                    ✓ Currently Active
                  </Box>
                )}
              </SpaceBetween>
            </div>
          );
        })}
      </SpaceBetween>
    </Container>
  );
}
