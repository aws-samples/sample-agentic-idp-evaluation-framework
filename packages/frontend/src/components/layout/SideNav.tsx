import SideNavigation from '@cloudscape-design/components/side-navigation';
import Badge from '@cloudscape-design/components/badge';

interface Step {
  href: string;
  text: string;
}

interface SideNavProps {
  activeStep: number;
  steps: Step[];
}

export default function SideNav({ activeStep, steps }: SideNavProps) {
  // Separate workflow steps from admin
  const workflowSteps = steps.filter((s) => s.href !== '/admin');
  const hasAdmin = steps.some((s) => s.href === '/admin');

  const workflowItems = workflowSteps.map((step, idx) => ({
    type: 'link' as const,
    text: `${idx + 1}. ${step.text}`,
    href: step.href,
    info: idx < activeStep
      ? <Badge color="green">Done</Badge>
      : idx === activeStep
        ? <Badge color="blue">Current</Badge>
        : undefined,
  }));

  const items: any[] = [...workflowItems];

  if (hasAdmin) {
    items.push({ type: 'divider' as const });
    items.push({
      type: 'link' as const,
      text: 'Admin',
      href: '/admin',
    });
  }

  return (
    <SideNavigation
      header={{ text: 'Workflow', href: '/' }}
      activeHref={steps[activeStep]?.href ?? '/'}
      items={items}
    />
  );
}
