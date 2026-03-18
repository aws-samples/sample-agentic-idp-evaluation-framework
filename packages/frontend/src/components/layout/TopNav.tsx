import TopNavigation from '@cloudscape-design/components/top-navigation';
import type { AuthUser } from '../../services/api';

interface TopNavProps {
  user: AuthUser | null;
}

export default function TopNav({ user }: TopNavProps) {
  return (
    <TopNavigation
      identity={{
        href: '/',
        title: 'ONE IDP',
        logo: {
          src: '/logo.svg',
          alt: 'ONE IDP',
        },
      }}
      utilities={[
        {
          type: 'button',
          text: 'GitHub',
          href: 'https://github.com/aws-samples/one-idp',
          external: true,
          externalIconAriaLabel: '(opens in new tab)',
        },
        {
          type: 'menu-dropdown',
          iconName: 'settings',
          ariaLabel: 'Settings',
          title: 'Settings',
          items: [
            { id: 'settings', text: 'Settings' },
            { id: 'about', text: 'About ONE IDP' },
          ],
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
              },
            ]
          : []),
      ]}
    />
  );
}
