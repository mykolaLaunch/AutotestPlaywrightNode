/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) {
      continue;
    }
    const value = argv[i + 1];
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch (err) {
    return false;
  }
}

function listLogFiles(logsPath) {
  if (!logsPath) {
    return [];
  }
  const absolute = path.resolve(process.cwd(), logsPath);
  if (isDirectory(absolute)) {
    return walkFiles(absolute).filter((file) => file.toLowerCase().endsWith('.json') || file.toLowerCase().endsWith('.jsonl'));
  }
  return [absolute];
}

function walkFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

function toRegex(patternEntry) {
  if (!patternEntry) {
    return null;
  }
  if (typeof patternEntry === 'string') {
    return new RegExp(patternEntry);
  }
  if (typeof patternEntry === 'object') {
    const pattern = patternEntry.pattern ?? '';
    const flags = patternEntry.flags ?? '';
    return new RegExp(pattern, flags);
  }
  return null;
}

function expectationsLabel(expectations) {
  if (!expectations) {
    return 'no expectations';
  }
  const parts = [];
  if (Array.isArray(expectations.mustContain) && expectations.mustContain.length) {
    parts.push(`mustContain=${JSON.stringify(expectations.mustContain)}`);
  }
  if (Array.isArray(expectations.mustMatch) && expectations.mustMatch.length) {
    const partsMatch = expectations.mustMatch
      .map((entry) => (typeof entry === 'string' ? `/${entry}/` : `/${entry.pattern}/${entry.flags ?? ''}`))
      .join(',');
    parts.push(`mustMatch=${partsMatch}`);
  }
  if (Array.isArray(expectations.mustNotContain) && expectations.mustNotContain.length) {
    parts.push(`mustNotContain=${JSON.stringify(expectations.mustNotContain)}`);
  }
  return parts.length ? parts.join(' | ') : 'no expectations';
}

function evaluateRule(answer, expectations) {
  if (!expectations) {
    return { status: 'skipped', reason: 'No expectations provided.' };
  }

  const normalized = String(answer ?? '').toLowerCase();
  const mustContain = expectations.mustContain ?? [];
  const mustNotContain = expectations.mustNotContain ?? [];
  const mustMatch = expectations.mustMatch ?? [];

  if (mustContain.length === 0 && mustNotContain.length === 0 && mustMatch.length === 0) {
    return { status: 'skipped', reason: 'No expectations provided.' };
  }

  for (const phrase of mustContain) {
    if (!normalized.includes(String(phrase).toLowerCase())) {
      return { status: 'failed', reason: `Expected answer to contain "${phrase}".` };
    }
  }

  for (const entry of mustMatch) {
    const re = toRegex(entry);
    if (re && !re.test(String(answer ?? ''))) {
      return { status: 'failed', reason: `Expected answer to match ${re}.` };
    }
  }

  for (const phrase of mustNotContain) {
    if (normalized.includes(String(phrase).toLowerCase())) {
      return { status: 'failed', reason: `Expected answer to not contain "${phrase}".` };
    }
  }

  return { status: 'passed' };
}

async function evaluateWithLlm(entry, llmConfig) {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in this Node runtime.');
  }

  if (!llmConfig.url.startsWith('https://api.openai.com/')) {
    return { status: 'failed', reason: 'EVAL_LLM_URL must point to https://api.openai.com/ for LLM evaluation.' };
  }
  if (!llmConfig.apiKey) {
    return { status: 'failed', reason: 'EVAL_LLM_API_KEY is not set for LLM evaluation.' };
  }
  if (!llmConfig.model) {
    return { status: 'failed', reason: 'EVAL_LLM_MODEL is not set for LLM evaluation.' };
  }

  const payload = {
    model: llmConfig.model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'Judge if the answer correctly addresses the question and matches expectations. Return only JSON: {"passed": boolean, "reason": string?}.'
      },
      {
        role: 'user',
        content: `Question: ${entry.question}\nAnswer: ${entry.answer}\nExpectations: ${JSON.stringify(
          entry.expectations ?? null
        )}`
      }
    ]
  };

  const headers = { 'Content-Type': 'application/json' };
  headers.Authorization = `Bearer ${llmConfig.apiKey}`;

  const response = await fetch(llmConfig.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    return { status: 'failed', reason: `LLM evaluation failed with status ${response.status}.` };
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  const parsed = safeParseJson(content);
  if (!parsed || typeof parsed.passed !== 'boolean') {
    return { status: 'failed', reason: 'LLM evaluation returned an invalid response.' };
  }

  return { status: parsed.passed ? 'passed' : 'failed', reason: parsed.reason };
}

function loadJsonLines(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const trimmed = content.trim();
  if (filePath.toLowerCase().endsWith('.json') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  }
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function getSpecCases(spec) {
  if (Array.isArray(spec)) {
    return spec;
  }
  if (Array.isArray(spec.cases)) {
    return spec.cases;
  }
  return [];
}

function findExpectationsForCase(cases, caseId) {
  const match = cases.find((item) => item.id === caseId);
  return match ? match.expectations : undefined;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncateText(str, maxLen) {
  if (str.length <= maxLen) {
    return str;
  }
  return `${str.slice(0, maxLen)}...`;
}

function safeParseJson(content) {
  try {
    return JSON.parse(content);
  } catch (err) {
    return null;
  }
}

function buildHtmlReport(summary, reportMeta) {
  const rows = summary.tests
    .map((t) => {
      const statusIcon = t.status === 'passed' ? 'OK' : t.status === 'failed' ? 'FAIL' : 'SKIP';
      const rowColor = t.status === 'passed' ? '#f0fff0' : t.status === 'failed' ? '#fff0f0' : '#fffbe6';
      const reason = t.reason ? `<div style="color:#a00;">${escapeHtml(t.reason)}</div>` : '';
      const answerDisplay = escapeHtml(truncateText(t.answer ?? '', 600));
      const expectations = escapeHtml(t.expectationsLabel ?? 'no expectations');
      const evalMode = escapeHtml(t.evaluationMode ?? 'unknown');
      return `
        <tr style="background:${rowColor};">
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(t.caseId)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(t.question)}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${expectations}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${evalMode}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;">${answerDisplay}${reason}</td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center;">${statusIcon}</td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(reportMeta.title)}</title>
</head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#222;">
  <h2 style="margin-bottom:4px;">Chat Evaluation Report</h2>
  <p style="margin:0 0 16px;">
    Passed: <b>${summary.totals.passed}</b> &nbsp;|&nbsp;
    Failed: <b style="color:#cc0000;">${summary.totals.failed}</b> &nbsp;|&nbsp;
    Skipped: <b>${summary.totals.skipped}</b> &nbsp;|&nbsp;
    Total: <b>${summary.totals.total}</b>
    &nbsp;&nbsp;<span style="color:#888;font-size:12px;">${escapeHtml(summary.generatedAt)}</span>
  </p>
  <p style="margin:0 0 12px;color:#666;">
    Spec: <b>${escapeHtml(reportMeta.specId)}</b> &nbsp;|&nbsp; Mode: <b>${escapeHtml(reportMeta.mode)}</b>
  </p>
  <table style="border-collapse:collapse;width:100%;max-width:1200px;">
    <thead>
      <tr style="background:#f5f5f5;">
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;">Case</th>
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;">Question</th>
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;">Expectations</th>
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;">Eval Mode</th>
        <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #ddd;">Answer / Reason</th>
        <th style="padding:8px 10px;text-align:center;border-bottom:2px solid #ddd;">Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function dateStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function inferSpecId(logs, filePath) {
  const entrySpecId = logs.find((entry) => entry && entry.specId)?.specId;
  if (entrySpecId) return entrySpecId;
  const parts = filePath.split(path.sep);
  const idx = parts.findIndex((p) => p === 'chat-logs');
  if (idx !== -1 && parts[idx + 2]) {
    return parts[idx + 2];
  }
  return null;
}

function resolveSpecPath(specId, specPathOverride) {
  if (specPathOverride) {
    return specPathOverride;
  }
  return path.resolve(process.cwd(), 'testCases', `${specId}.json`);
}

function loadSpecById(specId, specPathOverride) {
  const specPath = resolveSpecPath(specId, specPathOverride);
  if (!fs.existsSync(specPath)) {
    return { spec: null, specPath };
  }
  return { spec: loadJson(specPath), specPath };
}

async function main() {
  const args = parseArgs(process.argv);
  const logsPath = args.logs;
  const mode = (args.mode ?? 'rule').toLowerCase();

  if (!logsPath) {
    console.error(
      'Usage: node scripts/evaluate-chat-logs.js --logs <logs.json|logs.jsonl|dir> [--spec <spec.json>] --mode rule|llm'
    );
    process.exit(2);
  }

  const llmConfig = {
    url: process.env.EVAL_LLM_URL ?? 'https://api.openai.com/v1/chat/completions',
    apiKey: process.env.EVAL_LLM_API_KEY,
    model: process.env.EVAL_LLM_MODEL
  };

  const files = listLogFiles(logsPath);
  if (files.length === 0) {
    console.error('No log files found.');
    process.exit(2);
  }

  for (const filePath of files) {
    const logs = loadJsonLines(filePath);
    if (!logs.length) {
      console.warn(`Skipping empty log: ${filePath}`);
      continue;
    }

    const specId = inferSpecId(logs, filePath);
    if (!specId) {
      console.warn(`Skipping log without specId: ${filePath}`);
      continue;
    }

    const { spec, specPath } = loadSpecById(specId, args.spec);
    if (!spec) {
      console.warn(`Spec not found for ${specId}. Expected at ${specPath}. Skipping ${filePath}`);
      continue;
    }

    const cases = getSpecCases(spec);
    const reportDir = path.resolve(process.cwd(), 'test-results', 'reports', dateStamp(), specId);
    fs.mkdirSync(reportDir, { recursive: true });

    const tests = [];
    for (const entry of logs) {
      if (entry.specId !== specId) {
        continue;
      }
      const expectations = findExpectationsForCase(cases, entry.caseId) ?? entry.expectations;
      const ruleResult = evaluateRule(entry.answer, expectations);
      let result = ruleResult;
      if (mode === 'llm' && ruleResult.status === 'failed') {
        const llmResult = await evaluateWithLlm({ ...entry, expectations }, llmConfig);
        if (llmResult.status === 'failed') {
          const combinedReason = [ruleResult.reason, llmResult.reason].filter(Boolean).join(' ');
          result = { status: 'failed', reason: combinedReason || llmResult.reason || ruleResult.reason };
        } else {
          result = llmResult;
        }
      }

      tests.push({
        caseId: entry.caseId,
        stepId: entry.stepId,
        question: entry.question,
        answer: entry.answer,
        expectationsLabel: expectationsLabel(expectations),
        evaluationMode: entry.evaluationMode,
        status: result.status,
        reason: result.reason,
        citationsCount: entry.citationsCount,
        retrieval: entry.retrieval,
        sessionId: entry.sessionId,
        timestamp: entry.timestamp
      });
    }

    const totals = {
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status === 'failed').length,
      skipped: tests.filter((t) => t.status === 'skipped').length
    };

    const summary = {
      totals: {
        ...totals,
        total: tests.length
      },
      tests,
      generatedAt: new Date().toISOString()
    };

    const verdictPath = path.join(reportDir, 'verdict.json');
    const summaryPath = path.join(reportDir, 'summary.json');
    fs.writeFileSync(verdictPath, JSON.stringify(tests, null, 2), 'utf8');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    const reportHtml = buildHtmlReport(summary, { specId, mode, title: `Report - ${specId}` });
    const reportPath = path.join(reportDir, 'report.html');
    fs.writeFileSync(reportPath, reportHtml, 'utf8');

    console.log(`Report written: ${reportPath}`);
    console.log(`Summary written: ${summaryPath}`);
    console.log(`Verdict written: ${verdictPath}`);

    fs.unlinkSync(filePath);
    console.log(`Log deleted: ${filePath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
