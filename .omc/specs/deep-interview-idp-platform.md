# Deep Interview Spec: IDP Unified Platform (idp.sanghwa.people.aws.dev)

## Metadata
- Interview ID: idp-platform-2026-03-17
- Rounds: 6
- Final Ambiguity Score: 18.2%
- Type: brownfield
- Generated: 2026-03-17
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.92 | 40% | 0.368 |
| Constraint Clarity | 0.75 | 30% | 0.225 |
| Success Criteria | 0.75 | 30% | 0.225 |
| **Total Clarity** | | | **0.818** |
| **Ambiguity** | | | **18.2%** |

## Goal
Build a unified IDP (Intelligent Document Processing) platform at `idp.sanghwa.people.aws.dev` that:
1. Asks users Socratic questions to understand their document processing needs
2. Recommends optimal capability combinations from 5 core capabilities
3. Processes uploaded sample documents through multiple methods (BDA Standard/Custom, Claude, Nova, Textract+LLM)
4. Displays real-time comparison dashboard (accuracy, cost, speed) via streaming
5. Outputs best-practice architecture recommendation for the selected approach

The platform consolidates learnings from 6 existing IDP projects (reference only, not ported directly) into a clean monorepo.

## Core Flow
```
User uploads PDF → Question Flow (Strands Agent asks targeted questions)
→ Capability combination recommended → User confirms
→ Document processed through multiple methods in parallel (BDA, Claude, Nova, etc.)
→ Real-time streaming results displayed in comparison dashboard
→ Best practice architecture output (diagram + explanation)
→ [Future] One-click deploy via AgentCore
```

## 5 MVP Capabilities
1. **Table Extraction** - including nested tables, table-to-HTML/CSV
2. **Key-Value Pair Extraction** - structured field extraction from forms
3. **Image/Chart Description** - visual content understanding and description
4. **Bounding Box Detection** - element detection with coordinates (Nova 2 Pro)
5. **Free-form Text Extraction** - unstructured text, handwritten text

Each capability is evaluated across multiple methods:
- BDA Standard ($0.01/page)
- BDA Custom Blueprint ($0.04/page)
- Claude (Sonnet/Haiku) direct
- Nova (2 Lite/Pro) direct
- Textract + LLM hybrid
- [Future] Third-party OCR (Mistral OCR, PaddleOCR, etc.)

## Tech Stack
- **Agent Framework**: Strands Agents TypeScript SDK (v0.6.0+)
- **Frontend**: React + Vite + Cloudscape Design Components + Cloudscape GenAI patterns
- **Backend**: Node.js (unified), real-time streaming
- **Deployment**: Amazon Bedrock AgentCore Runtime + Gateway
- **Infrastructure**: AgentCore MCP server for development workflow
- **UI Quality**: Production-level, fancy, polished design

## Constraints
- Existing subdirectory projects are **reference only** - code snippets and ideas only, not ported
- Monorepo structure with clean separation
- Cloudscape GenAI pattern compliance
- Real-time streaming for all processing results
- Node.js unified (no Python backend, Strands TS only)
- Timeline: ~3/31 build complete, 4/7-8 internal demo

## Non-Goals
- Full production deploy pipeline (post-MVP)
- 100 prebuilt patterns (long-term; MVP = 5 capability combinations)
- TDM initiative / POC-to-Production checklist (separate workstream)
- Event registration pages / Gather setup (project management, not code)
- Service team outreach / one-pagers (organizational, not code)
- Wrick framework direct integration (reference only for MVP)

## Acceptance Criteria
- [ ] User can upload a PDF document through the UI
- [ ] Strands Agent asks targeted questions about document processing needs (streaming)
- [ ] System recommends capability combination based on answers
- [ ] Document is processed through at least 3 methods (BDA, Claude, Nova) in parallel
- [ ] Real-time streaming shows processing progress for each method
- [ ] Comparison dashboard displays results side-by-side with accuracy/cost/speed metrics
- [ ] Best practice architecture recommendation is generated and displayed
- [ ] UI uses Cloudscape Design Components with GenAI patterns
- [ ] All 5 capabilities (table, KV, image, bbox, text) are functional
- [ ] Backend runs on Node.js with Strands Agents TS SDK
- [ ] Application is deployable to AgentCore Runtime

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| Need 100 prebuilt patterns for MVP | Contrarian: 5 capabilities = max 32 combos | MVP uses 5 capability combos, 100 is long-term |
| Existing projects should be ported | User clarified | Reference only, clean rebuild |
| Python backend needed for ML | User specified Node.js | Strands TS SDK + Node.js unified, AWS services handle ML |
| Full deploy pipeline needed | Simplifier would ask | Deploy is post-MVP, architecture output only |
| Wrick framework must be integrated | User clarified | Reference only for ideas |

## Technical Context (Brownfield)
### Existing Projects (Reference Only)
| Project | Key Learnings to Reference |
|---------|---------------------------|
| `sample-document-splitting-with-amazon-bedrock-data-automation` | BDA API integration, doc splitting logic, CloudFormation patterns |
| `sample-fraud-detection-check-with-bda-and-textract` | BDA vs Textract comparison logic, cost calculation, React UI patterns |
| `sample-servrx` | Insurance/Rx document processing, similar comparison UI |
| `sample-timecards-processing-with-amazon-bedrock` | Timecard extraction patterns, Flask backend (don't use Flask) |
| `intelligent-document-processing-workbench-framework` | Wrick's Value Score Analysis, batch processing, model selector UI, Cloudscape-like components |
| `bda-minor-detection` | BDA blueprint schema patterns |
| `nova-classmate-yearbook-boundingboxes` | Nova 2 Pro/Lite bounding box detection, prompt caching |

### Key Technology References
- Strands Agents TS: https://strandsagents.com/llms.txt (streaming, multi-agent, tools, AgentCore deploy)
- AgentCore MCP Server: For development workflow acceleration
- Cloudscape Design: AWS design system for consistent UI
- Cloudscape GenAI Patterns: Specific patterns for AI/ML interfaces

## Ontology (Key Entities)

| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| IDP Platform | core domain | name, url, version | hosts Capabilities, runs Strands Agents |
| Document | core domain | file, pages[], contentTypes[], size | processed by Capabilities |
| Capability | core domain | name, type (table/KV/image/bbox/text), methods[] | belongs to Platform, processes Documents |
| Evaluation Flow | core domain | documentId, capabilities[], methods[], results[] | evaluates Document using Capabilities |
| Question Flow | core domain | questions[], answers[], recommendedCapabilities[] | guides user to Capability selection |
| Routing Engine | supporting | rules[], capabilityScores[] | maps Question answers to Capabilities |
| Comparison Dashboard | supporting | metrics (accuracy, cost, speed), charts[] | displays Evaluation results |
| Architecture Output | supporting | diagram, components[], bestPractices[] | generated from Evaluation results |
| Strands Agent | infrastructure | model, tools[], systemPrompt | powers Question Flow and processing |
| FM/LLM | external system | provider, model, pricing | used by Capabilities for processing |
| BDA | external system | type (standard/custom), blueprintSchema | used by Capabilities for processing |
| AgentCore Runtime | infrastructure | endpoint, version | hosts backend agents |
| AgentCore Gateway | infrastructure | tools[], endpoints[] | connects agents to AWS services |
| Cloudscape UI | infrastructure | components[], patterns[] | renders frontend |

## Ontology Convergence

| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 7 | 7 | - | - | N/A |
| 2 | 10 | 3 | 0 | 7 | 70% |
| 3 | 12 | 2 | 0 | 10 | 83% |
| 4 | 14 | 2 | 0 | 12 | 86% |
| 5 | 13 | 0 | 1 | 12 | 93% |
| 6 | 14 | 1 | 0 | 13 | 93% |

## Interview Transcript
<details>
<summary>Full Q&A (6 rounds)</summary>

### Round 1
**Q:** 이번 deep interview에서 코드로 실제 빌드할 핵심 대상이 뭔가요?
**A:** IDP 통합 플랫폼 (추천) - idp.sanghwa.people.aws.dev에 기존 파편들 통합
**Ambiguity:** 75.5% (Goal: 0.35, Constraints: 0.20, Criteria: 0.15)

### Round 2
**Q:** (User provided detailed vision unprompted)
**A:** Question flow로 물어보고, capability-level patterns으로 나누고, prebuilt 100개 중 routing, sample doc 올리면 dynamic framework에서 결과 비교
**Ambiguity:** 58.5% (Goal: 0.70, Constraints: 0.20, Criteria: 0.25)

### Round 3
**Q:** "Pattern"이라고 했을 때, 구체적으로 하나의 pattern이 뭘 포함하는 거예요?
**A:** Capability 레벨 (generic) - "table extraction", "image description" 등 기능 단위
**Ambiguity:** 53.8% (Goal: 0.78, Constraints: 0.20, Criteria: 0.30)
**Tech stack clarified:** Strands Agents TS v0.6.0+, Node.js unified, React+Vite+Cloudscape, AgentCore 배포

### Round 4 [Contrarian Mode]
**Q:** MVP에 반드시 들어가야 할 capability를 골라주세요
**A:** 5개: Table + KV + Image + BBox + Text
**Ambiguity:** 31.5% (Goal: 0.85, Constraints: 0.70, Criteria: 0.45)

### Round 5 [Contrarian Challenge]
**Q:** 100개 pattern이 아니라 5 capability 조합이 MVP 핵심 맞죠?
**A:** 맞아, MVP는 5 capability 조합. 100개는 장기 목표.
**Ambiguity:** 27.4% (Goal: 0.90, Constraints: 0.72, Criteria: 0.50)

### Round 6
**Q:** 데모 성공 기준을 구체적으로 정의해보면?
**A:** 전체 플로우 end-to-end. PDF 업로드 → 질문 → 추천 → 실제 처리 → 결과 비교 대시보드까지 전부 동작. streaming 실시간. Best practice architecture 출력 (추후 deploy).
**Ambiguity:** 18.2% (Goal: 0.92, Constraints: 0.75, Criteria: 0.75)

</details>
