import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: 'ONE IDP Docs',
  },
  links: [
    { text: 'App', url: '/', external: true },
    { text: 'GitLab', url: 'https://gitlab.aws.dev/sanghwa/one-idp', external: true },
  ],
};
