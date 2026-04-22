import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  basePath: '/docs',
  // basePath stays blank when BASE_PATH=''; useful for local `next start` sanity.
  ...(process.env.BASE_PATH === '' ? { basePath: '' } : {}),
  images: { unoptimized: true },
  trailingSlash: true,
};

export default withMDX(config);
