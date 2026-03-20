import SideNavigation from '@cloudscape-design/components/side-navigation';
import Badge from '@cloudscape-design/components/badge';
// Badge still used for Done/Current indicators

interface Step {
  href: string;
  text: string;
}

interface SideNavProps {
  activeStep: number;
  steps: Step[];
}

export default function SideNav({ activeStep, steps }: SideNavProps) {
  const stepDescriptions: Record<string, string> = {
    'Upload': 'Upload your document',
    'Analyze & Preview': 'AI analysis + method comparison',
    'Pipeline': 'Build processing pipeline',
    'Architecture & Code': 'Get production-ready code',
  };

  const items = steps.map((step, idx) => ({
    type: 'link' as const,
    text: `${idx + 1}. ${step.text}`,
    href: step.href,
    info: idx < activeStep
      ? <Badge color="green">Done</Badge>
      : idx === activeStep
        ? <Badge color="blue">Current</Badge>
        : undefined,
  }));

  return (
    <SideNavigation
      header={{ text: 'Workflow', href: '/' }}
      activeHref={steps[activeStep]?.href ?? '/'}
      items={items}
    />
  );
}
