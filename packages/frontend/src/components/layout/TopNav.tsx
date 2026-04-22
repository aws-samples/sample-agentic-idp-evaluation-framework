import TopNavigation from '@cloudscape-design/components/top-navigation';
import type { AuthUser } from '../../services/api';
import { clearToken } from '../../services/midway';

interface TopNavProps {
  user: AuthUser | null;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
}

const APP_TITLE = import.meta.env.VITE_APP_TITLE || 'ONE IDP Framework';

// External links (GitLab, Slack) are safe on AWS-internal hostnames
// (Midway-protected) and local dev. They stay hidden on public deployments.
// Decision is at runtime (hostname) rather than build-time so one artifact
// serves both internal and public cognito-auth deploys.
function isInternalHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.endsWith('.people.aws.dev') ||
    h.endsWith('.amazon.com') ||
    h.endsWith('.aws.dev')
  );
}
const SHOW_LINKS =
  import.meta.env.DEV ||
  import.meta.env.VITE_SHOW_LINKS === 'true' ||
  isInternalHost();

// Defaults point at the internal GitLab + Slack channel. Override via env if
// you fork the deployment.
const REPO_URL = SHOW_LINKS
  ? (import.meta.env.VITE_REPO_URL || 'https://gitlab.aws.dev/sanghwa/one-idp')
  : '';
const REPO_LABEL = import.meta.env.VITE_REPO_LABEL || 'GitLab';
const CHAT_URL = SHOW_LINKS
  ? (import.meta.env.VITE_CHAT_URL || 'https://amazon.enterprise.slack.com/archives/C0ATLG1TX1U')
  : '';
const CHAT_LABEL = import.meta.env.VITE_CHAT_LABEL || 'Slack';

function externalLink(text: string, href: string) {
  return {
    type: 'button' as const,
    text,
    href,
    external: true,
    externalIconAriaLabel: '(opens in new tab)',
  };
}

export default function TopNav({ user, darkMode, onToggleDarkMode }: TopNavProps) {
  return (
    <TopNavigation
      identity={{
        href: '/',
        title: APP_TITLE,
        logo: {
          src: '/logo-dark.svg',
          alt: APP_TITLE,
        },
      }}
      utilities={[
        {
          type: 'button',
          text: 'Docs',
          href: '/docs',
        },
        // GitLab + Slack sit right after Docs — easier to find from the nav.
        ...(REPO_URL ? [externalLink(REPO_LABEL, REPO_URL)] : []),
        ...(CHAT_URL ? [externalLink(CHAT_LABEL, CHAT_URL)] : []),
        {
          type: 'button',
          iconName: darkMode ? 'status-positive' : 'status-stopped',
          text: darkMode ? 'Light Mode' : 'Dark Mode',
          onClick: onToggleDarkMode,
        },
        ...(user
          ? [
              {
                type: 'menu-dropdown' as const,
                text: user.alias,
                description: user.email,
                iconName: 'user-profile' as const,
                items: [
                  { id: 'profile', text: `Signed in as ${user.alias}` },
                  { id: 'signout', text: 'Sign out' },
                ],
                onItemClick: ({ detail }: { detail: { id: string } }) => {
                  if (detail.id === 'signout') {
                    clearToken();
                    window.location.reload();
                  }
                },
              },
            ]
          : []),
      ]}
    />
  );
}
