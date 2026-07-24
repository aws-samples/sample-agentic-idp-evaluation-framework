import SideNavigation from '@cloudscape-design/components/side-navigation';
import Badge from '@cloudscape-design/components/badge';

interface Step {
  href: string;
  text: string;
}

interface SideNavProps {
  activeStep: number;
  steps: Step[];
  /**
   * Hrefs of steps the user has actually completed. Progress cannot be inferred
   * from the current URL — deep-linking to /pipeline used to mark Upload and
   * Analyze as "Done" even with no document loaded, which is simply false.
   */
  completedHrefs?: ReadonlySet<string>;
}

const ADMIN_HREFS = new Set(['/admin', '/survey-results']);
const UTILITY_HREFS = new Set(['/runs']);

export default function SideNav({ activeStep, steps, completedHrefs }: SideNavProps) {
  // Separate workflow steps from utility and admin-only entries
  const workflowSteps = steps.filter((s) => !ADMIN_HREFS.has(s.href) && !UTILITY_HREFS.has(s.href));
  const utilitySteps = steps.filter((s) => UTILITY_HREFS.has(s.href));
  const adminSteps = steps.filter((s) => ADMIN_HREFS.has(s.href));

  const workflowItems = workflowSteps.map((step, idx) => {
    const isCurrent = idx === activeStep;
    const isDone = !isCurrent && !!completedHrefs?.has(step.href);
    return {
      type: 'link' as const,
      text: `${idx + 1}. ${step.text}`,
      href: step.href,
      info: isCurrent
        ? <Badge color="blue">Current</Badge>
        : isDone
          ? <Badge color="green">Done</Badge>
          : undefined,
    };
  });

  const items: any[] = [...workflowItems];

  if (utilitySteps.length > 0) {
    items.push({ type: 'divider' as const });
    for (const step of utilitySteps) {
      items.push({
        type: 'link' as const,
        text: step.text,
        href: step.href,
      });
    }
  }

  if (adminSteps.length > 0) {
    items.push({ type: 'divider' as const });
    for (const step of adminSteps) {
      items.push({
        type: 'link' as const,
        text: step.text,
        href: step.href,
      });
    }
  }

  return (
    <SideNavigation
      header={{ text: 'Workflow', href: '/' }}
      activeHref={steps[activeStep]?.href ?? '/'}
      items={items}
    />
  );
}
