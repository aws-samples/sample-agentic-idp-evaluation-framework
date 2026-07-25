/**
 * Actually compile and syntax-check the project that step 4 generates.
 *
 *   node scripts/verify-generated-code.mjs [--keep]
 *
 * Why this exists: the generated project is handed to a customer as "deployable as-is",
 * and it was not. An audit found five defects — a `const process` that shadowed Node's
 * global in a block reading `process.env` (a temporal-dead-zone ReferenceError, so
 * `cdk synth` died before emitting one resource), a Lambda importing a path that was not
 * in the ZIP, an import of this repo's internal `@idp/shared`, a dispatcher that knew 3
 * of 10 method families, and IAM ARNs built by concatenating non-Bedrock routing keys.
 * Every one of those is invisible to a unit test of the generator and obvious to `tsc`.
 *
 * So: write the real files into a temp dir with the real dependency manifests, install,
 * and run `tsc --noEmit` over them plus a Python parse of process.py. Structural checks
 * (import targets resolve, no repo-internal imports, no shadowed globals) run first
 * because they are instant and name the problem precisely.
 *
 * Exits non-zero on the first real failure, so it can gate a release.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';

const KEEP = process.argv.includes('--keep');
const ROOT = process.cwd();

/*
 * The generators are TypeScript in the frontend package and import from @idp/shared, so
 * they cannot be `import()`ed directly from a plain .mjs. Transpile the module in memory
 * with the real TypeScript compiler and evaluate it against a stub for the shared
 * constants it touches — the generators only read METHOD_INFO/CAPABILITY_INFO/PRODUCT_NAME.
 */
const ts = (await import(pathToFileURL(join(ROOT, 'node_modules/typescript/lib/typescript.js')).href)).default;
const shared = await import(pathToFileURL(join(ROOT, 'packages/shared/dist/index.js')).href);

const srcPath = join(ROOT, 'packages/frontend/src/pages/architectureTemplates.ts');
const { readFileSync } = await import('fs');
const tsSource = readFileSync(srcPath, 'utf-8');
const js = ts.transpileModule(tsSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

// Evaluate with a require() that serves the shared package and nothing else.
const module_ = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('exports', 'require', 'module', js)(
  module_.exports,
  (id) => {
    if (id === '@idp/shared') return shared;
    throw new Error(`generated-code verifier: unexpected import ${id}`);
  },
  module_,
);
const T = module_.exports;

/**
 * A representative pipeline. Deliberately spans several FAMILIES, because the dispatcher
 * bug only appeared for families outside claude/nova/gpt — a single-method fixture would
 * have passed while nine methods were broken.
 */
const capabilities = ['text_extraction', 'table_extraction', 'kv_extraction'];
const processingResults = [
  { method: 'claude-haiku', status: 'complete', results: {}, metrics: { latencyMs: 1200, cost: 0.004 } },
  { method: 'textract-claude-haiku', status: 'complete', results: {}, metrics: { latencyMs: 2400, cost: 0.006 } },
  { method: 'bda-standard', status: 'complete', results: {}, metrics: { latencyMs: 5000, cost: 0.01 } },
];
const comparison = { methods: processingResults, recommendation: 'claude-haiku', capabilityMatrix: {} };
const executedPipeline = {
  name: 'Balanced-Optimized Pipeline',
  nodes: [
    { id: 'm1', type: 'method', config: { method: 'claude-haiku', family: 'claude', capabilities } },
  ],
  edges: [],
  estimatedCostPerPage: 0.0067,
  estimatedLatencyMs: 5000,
};

const args = [capabilities, processingResults, comparison, executedPipeline];

// Mirrors ZIP_PATHS + ZIP_EXTRA_COPIES in ArchitecturePage.tsx.
const FILES = {
  'README.md': T.generateReadme(...args),
  'process.py': T.generatePythonCode(...args),
  'requirements.txt': T.generatePythonRequirements(...args),
  'process.ts': T.generateTypeScriptCode(...args),
  'package.json': T.generateTypeScriptPackageJson(...args),
  'cdk/lib/idp-stack.ts': T.generateCdkStack(...args),
  'cdk/lambda/processor.ts': T.generateCdkLambdaHandler(...args),
  'cdk/bin/idp.ts': T.generateCdkAppEntry(...args),
  'cdk/package.json': T.generateCdkPackageJson(...args),
  'cdk/cdk.json': T.generateCdkJson(...args),
  'cdk/tsconfig.json': T.generateCdkTsConfig(),
  /*
   * The Lambda does `import ... from '../process.js'`, which resolves to cdk/process.ts.
   * Generated with cli:false — the CLI shim is ESM-only and this copy compiles as
   * CommonJS. Mirrors ZIP_COPY_OVERRIDES in ArchitecturePage.tsx.
   */
  'cdk/process.ts': T.generateTypeScriptCode(...args, { cli: false }),
};

const dir = mkdtempSync(join(tmpdir(), 'idp-gen-'));
for (const [rel, content] of Object.entries(FILES)) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
console.log(`generated ${Object.keys(FILES).length} files into ${dir}\n`);

const problems = [];
const fail = (what, detail) => { problems.push({ what, detail }); console.log(`  FAIL ${what}\n       ${detail}`); };
const pass = (what) => console.log(`  ok   ${what}`);

// ─── Structural checks ─────────────────────────────────────────────────────────
console.log('structural checks');

// 1. No import of this repo's internal workspace packages.
for (const [rel, body] of Object.entries(FILES)) {
  if (!/\.(ts|py)$/.test(rel)) continue;
  const bad = body.match(/from ['"](@idp\/[^'"]+)['"]|require\(['"](@idp\/[^'"]+)['"]\)/);
  if (bad) fail(`${rel} imports a repo-internal package`, bad[0]);
}
if (!problems.length) pass('no @idp/* imports in generated code');

// 2. Every relative import resolves to a file that is actually in the bundle.
const written = new Set(Object.keys(FILES));
for (const [rel, body] of Object.entries(FILES)) {
  if (!rel.endsWith('.ts')) continue;
  for (const m of body.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
    // Accept both a `.js` specifier (ESM style) and an extensionless one (CommonJS),
    // since the root project and the cdk/ project use different module systems.
    const spec = m[1].replace(/\.js$/, '.ts');
    const resolved = join(dirname(rel), spec).replace(/\\/g, '/');
    if (!written.has(resolved) && !written.has(`${resolved}.ts`)) {
      fail(`${rel} imports a file not in the bundle`, `${m[1]} -> ${resolved}`);
    }
  }
}

/*
 * 3. No local binding shadows a global that the same file reads. This is the
 *    `const process = api.root.addResource('process')` class of bug.
 *
 *    Comments are stripped first: the generated stack now carries a comment EXPLAINING
 *    the old bug, and matching the words inside it reported the fixed file as broken.
 *    A checker that flags its own documentation is worse than no checker — it trains you
 *    to ignore the output.
 */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, '');
for (const [rel, body] of Object.entries(FILES)) {
  if (!rel.endsWith('.ts')) continue;
  const code = stripComments(body);
  for (const g of ['process', 'console', 'Buffer', 'globalThis']) {
    const declares = new RegExp(`\\b(?:const|let|var)\\s+${g}\\b`).test(code);
    const uses = new RegExp(`\\b${g}\\.\\w`).test(code);
    if (declares && uses) fail(`${rel} shadows the global \`${g}\` while also using it`, 'temporal dead zone at runtime');
  }
}

// 4. Bedrock foundation-model ARNs must not be built from non-Bedrock routing keys.
const stack = FILES['cdk/lib/idp-stack.ts'];
for (const m of stack.matchAll(/foundation-model\/([^`'"\s,]+)/g)) {
  if (m[1].includes(':') && !/-v\d+:\d+$/.test(m[1])) {
    fail('generated IAM builds a malformed foundation-model ARN', m[0]);
  }
  if (/^(sagemaker|bedrock-guardrails|us\.data-automation)/.test(m[1])) {
    fail('generated IAM treats a non-Bedrock routing key as a model id', m[0]);
  }
}

// 5. The dispatcher must know every family it can be handed.
const tsCode = FILES['process.ts'];
const familiesInPipeline = new Set(processingResults.map((r) => shared.METHOD_INFO[r.method].family));
for (const fam of familiesInPipeline) {
  if (!tsCode.includes(`"${fam}"`) && !tsCode.includes(`'${fam}'`)) {
    fail('generated dispatcher does not mention a family it will receive', fam);
  }
}
if (problems.length === 0) pass('structural checks all clean');

// ─── Python syntax ─────────────────────────────────────────────────────────────
console.log('\npython');
try {
  execFileSync('python3', ['-m', 'py_compile', join(dir, 'process.py')], { stdio: 'pipe' });
  pass('process.py compiles');
} catch (e) {
  fail('process.py does not compile', String(e.stderr || e.message).split('\n').slice(0, 6).join('\n       '));
}

// ─── TypeScript compile ────────────────────────────────────────────────────────
console.log('\ntypescript (installing real deps, this takes a minute)');
/*
 * No tsconfig is written here on purpose: the bundle now ships its own
 * (generateCdkTsConfig), and inventing one would verify a configuration the customer
 * never receives — which is how the missing-tsconfig bug survived in the first place.
 */
if (!existsSync(join(dir, 'cdk/tsconfig.json'))) {
  fail('the generated CDK bundle ships no tsconfig.json', 'npm run build and cdk.json both need one');
}

try {
  execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund'], {
    cwd: join(dir, 'cdk'), stdio: 'pipe', timeout: 300_000,
  });
  pass('cdk/ npm install');
  try {
    execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['--noEmit', '-p', 'tsconfig.json'], {
      cwd: join(dir, 'cdk'), stdio: 'pipe',
    });
    pass('cdk/ tsc --noEmit');
  } catch (e) {
    const out = String(e.stdout || e.stderr || '').split('\n').filter(Boolean).slice(0, 12);
    fail('generated CDK project does not typecheck', out.join('\n       '));
  }
} catch (e) {
  console.log(`  skip cdk install/typecheck (${String(e.message).slice(0, 80)})`);
}

// ─── cdk synth: does it actually produce a template? ───────────────────────────
/*
 * The strongest check available offline. `tsc` proves the stack COMPILES; synth proves it
 * EVALUATES — which is what the `const process` shadowing broke. That bug typechecked
 * perfectly and then threw at synth time before emitting a single resource, so a
 * compile-only gate would have shipped it.
 *
 * No AWS credentials or network needed: synth renders CloudFormation locally.
 */
console.log('\ncdk synth');
if (problems.length === 0) {
  try {
    execFileSync('npx', ['cdk', 'synth', '--quiet'], {
      cwd: join(dir, 'cdk'),
      stdio: 'pipe',
      timeout: 300_000,
      env: { ...process.env, CDK_DEFAULT_ACCOUNT: '000000000000', CDK_DEFAULT_REGION: 'us-west-2' },
    });
    const out = join(dir, 'cdk/cdk.out');
    const templates = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith('.template.json')) : [];
    if (templates.length === 0) {
      fail('cdk synth produced no CloudFormation template', `nothing matching *.template.json in ${out}`);
    } else {
      const tpl = JSON.parse(readFileSync(join(out, templates[0]), 'utf-8'));
      const types = Object.values(tpl.Resources ?? {}).map((r) => r.Type);
      // A template with no Lambda and no bucket synthesised but built nothing useful.
      const need = ['AWS::Lambda::Function', 'AWS::S3::Bucket', 'AWS::DynamoDB::Table'];
      const missing = need.filter((t) => !types.includes(t));
      if (missing.length) fail('synthesised template is missing core resources', missing.join(', '));
      else pass(`cdk synth -> ${Object.keys(tpl.Resources).length} resources (${templates[0]})`);
    }
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    fail('cdk synth failed', out.split('\n').filter(Boolean).slice(-10).join('\n       '));
  }
} else {
  console.log('  skip (earlier failures would mask the cause)');
}

// ─── Report ────────────────────────────────────────────────────────────────────
console.log(`\n${problems.length === 0 ? 'PASS' : `FAIL — ${problems.length} problem(s)`}`);
if (KEEP) console.log(`kept: ${dir}`);
else if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
process.exit(problems.length === 0 ? 0 : 1);
