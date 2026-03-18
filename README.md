# ONE IDP - Intelligent Document Processing Evaluation Platform

Evaluate, compare, and recommend the optimal AWS document processing approach for your use case.

Upload a sample document, answer a few targeted questions, and see how 11 processing methods perform across 22 capabilities — with real accuracy, cost, and speed comparisons.

## Features

- **22 Capabilities** across 5 categories: Core Extraction, Visual Analysis, Document Intelligence, Compliance & Security, Industry-Specific
- **11 Processing Methods** across 4 families: BDA, Claude (Sonnet 4.6 / Haiku 4.5 / Opus 4.6), Nova (2 Lite / 2 Pro), Textract+LLM
- **5 Document Types**: PDF, Image, Word, PowerPoint, Excel
- **Pipeline Builder**: Visual node-based editor for custom processing pipelines
- **Real-time Streaming**: SSE-based live progress for all processing methods
- **Architecture Recommendations**: Best-practice architecture with cost projections at scale

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env
# Edit .env with your AWS credentials and S3 bucket

# Build shared types
npm run build:shared

# Start development servers (backend :3001 + frontend :5173)
npm run dev
```

Open http://localhost:5173

## Project Structure

```
one-idp/
├── packages/
│   ├── shared/          # Shared types, constants, capability/method definitions
│   ├── backend/         # Express + AWS SDK (Bedrock, Textract, BDA, S3)
│   └── frontend/        # React + Vite + Cloudscape Design + ReactFlow
├── reference/           # Existing IDP project references (7 projects)
├── assets/              # Logo, design assets
├── .omc/                # Design specs and plans
├── package.json         # npm workspace root
└── tsconfig.base.json   # Shared TypeScript config
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, Cloudscape Design, ReactFlow, Lucide Icons |
| Backend | Node.js, Express, TypeScript |
| AI/ML | Amazon Bedrock (Claude, Nova), BDA, Amazon Textract |
| Agent | Strands Agents TypeScript SDK |
| Auth | AWS Midway (internal) |
| Deploy | Amazon Bedrock AgentCore Runtime |

## Processing Methods

| Family | Models | Pricing |
|--------|--------|---------|
| **BDA** | Standard, Custom Blueprint | $0.01 - $0.04 / page |
| **Claude** | Sonnet 4.6, Haiku 4.5, Opus 4.6 | $1 - $5 / 1M input tokens |
| **Nova** | 2 Lite (GA), 2 Pro (Preview) | $0.30 - $1.25 / 1M input tokens |
| **Textract+LLM** | +Sonnet, +Haiku, +Nova Lite, +Nova Pro | Textract $0.0015/pg + LLM tokens |

## Environment Variables

See [.env.example](.env.example) for all configuration options.

## License

MIT-0. See [LICENSE](LICENSE).
