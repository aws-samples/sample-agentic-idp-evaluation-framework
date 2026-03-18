import Cards from '@cloudscape-design/components/cards';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Box from '@cloudscape-design/components/box';
import Toggle from '@cloudscape-design/components/toggle';
import ProgressBar from '@cloudscape-design/components/progress-bar';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Badge from '@cloudscape-design/components/badge';
import type { CapabilityRecommendation, Capability, CapabilityCategory } from '@idp/shared';
import { CAPABILITY_INFO, CAPABILITY_CATEGORIES, CATEGORY_INFO } from '@idp/shared';

interface CapabilityCardsProps {
  recommendations: CapabilityRecommendation[];
  selected: Capability[];
  onToggle: (capability: Capability, enabled: boolean) => void;
}

export default function CapabilityCards({
  recommendations,
  selected,
  onToggle,
}: CapabilityCardsProps) {
  // Group recommendations by category
  const groupedByCategory: Record<CapabilityCategory, CapabilityRecommendation[]> = {} as Record<CapabilityCategory, CapabilityRecommendation[]>;

  for (const category of CAPABILITY_CATEGORIES) {
    groupedByCategory[category] = [];
  }

  for (const rec of recommendations) {
    const info = CAPABILITY_INFO[rec.capability];
    if (info) {
      groupedByCategory[info.category].push(rec);
    }
  }

  return (
    <SpaceBetween size="l">
      <Header
        variant="h2"
        description="Based on your document analysis, these capabilities are recommended"
        counter={`(${selected.length} selected)`}
      >
        Recommended Capabilities
      </Header>

      {CAPABILITY_CATEGORIES.map((category) => {
        const items = groupedByCategory[category];
        if (items.length === 0) return null;

        const categoryInfo = CATEGORY_INFO[category];
        const categorySelected = items.filter(item => selected.includes(item.capability)).length;

        return (
          <ExpandableSection
            key={category}
            defaultExpanded
            headerText={
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  display: 'inline-block',
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  backgroundColor: categoryInfo.color
                }} />
                <Box variant="h3">{categoryInfo.name}</Box>
                <Badge color={categorySelected > 0 ? 'green' : 'grey'}>
                  {categorySelected}/{items.length} selected
                </Badge>
              </div>
            }
            headerDescription={categoryInfo.description}
          >
            <Cards
              cardDefinition={{
                header: (item) => {
                  const info = CAPABILITY_INFO[item.capability];
                  return (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box variant="h3">{info?.name ?? item.capability}</Box>
                      <Toggle
                        checked={selected.includes(item.capability)}
                        onChange={({ detail }) => onToggle(item.capability, detail.checked)}
                      />
                    </div>
                  );
                },
                sections: [
                  {
                    id: 'description',
                    content: (item) => {
                      const info = CAPABILITY_INFO[item.capability];
                      return (
                        <Box color="text-body-secondary">
                          {info?.description ?? ''}
                        </Box>
                      );
                    },
                  },
                  {
                    id: 'tags',
                    content: (item) => {
                      const info = CAPABILITY_INFO[item.capability];
                      return (
                        <SpaceBetween size="xs" direction="horizontal">
                          {info?.tags.slice(0, 4).map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                        </SpaceBetween>
                      );
                    },
                  },
                  {
                    id: 'relevance',
                    header: 'Relevance Score',
                    content: (item) => (
                      <ProgressBar
                        value={item.relevance * 100}
                        status="in-progress"
                        resultText={`${Math.round(item.relevance * 100)}%`}
                      />
                    ),
                  },
                  {
                    id: 'rationale',
                    header: 'Rationale',
                    content: (item) => (
                      <Box variant="small" color="text-body-secondary">
                        {item.rationale}
                      </Box>
                    ),
                  },
                ],
              }}
              items={items}
              cardsPerRow={[{ cards: 1 }, { minWidth: 500, cards: 2 }, { minWidth: 1000, cards: 3 }]}
            />
          </ExpandableSection>
        );
      })}

      {recommendations.length === 0 && (
        <SpaceBetween size="m" alignItems="center">
          <Box textAlign="center" color="text-body-secondary">
            No recommendations yet. Chat with the assistant to analyze your document.
          </Box>
        </SpaceBetween>
      )}
    </SpaceBetween>
  );
}
