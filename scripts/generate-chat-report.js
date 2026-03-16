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

function isDirectory(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch (err) {
    return false;
  }
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

function listLogFiles(logsPath) {
  if (!logsPath) {
    return [];
  }
  const absolute = path.resolve(process.cwd(), logsPath);
  if (isDirectory(absolute)) {
    return walkFiles(absolute).filter(
      (file) => file.toLowerCase().endsWith('.json') || file.toLowerCase().endsWith('.jsonl')
    );
  }
  return [absolute];
}

function loadLogs(filePath) {
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

function dateStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeRow(entry) {
  return {
    caseId: entry.caseId,
    stepId: entry.stepId,
    question: entry.question,
    answer: entry.answer,
    evaluationPassed: typeof entry.evaluationPassed === 'boolean' ? entry.evaluationPassed : null,
    evaluationReason: entry.evaluationReason ?? null,
    failureReason: entry.failureReason ?? null,
    evaluationMode: entry.evaluationMode ?? 'unknown',
    expectations: entry.expectations ?? null,
    citationsCount: entry.citationsCount,
    retrieval: entry.retrieval,
    sessionId: entry.sessionId,
    timestamp: entry.timestamp
  };
}

function normalizeExpectationValue(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const pattern = value.pattern ? String(value.pattern) : '';
    const flags = value.flags ? String(value.flags) : '';
    if (pattern || flags) {
      return `${pattern}${flags ? ` /${flags}` : ''}`;
    }
  }
  return String(value);
}

function formatExpectations(expectations) {
  if (!expectations || typeof expectations !== 'object') return '-';
  const lines = [];
  if (Array.isArray(expectations.mustContain) && expectations.mustContain.length) {
    lines.push(`mustContain: ${expectations.mustContain.map(String).join(', ')}`);
  }
  if (Array.isArray(expectations.mustMatch) && expectations.mustMatch.length) {
    lines.push(
      `mustMatch: ${expectations.mustMatch.map((entry) => normalizeExpectationValue(entry)).join(', ')}`
    );
  }
  if (Array.isArray(expectations.mustNotContain) && expectations.mustNotContain.length) {
    lines.push(`mustNotContain: ${expectations.mustNotContain.map(String).join(', ')}`);
  }
  if (!lines.length) return '-';
  return lines.join('\n');
}

function buildHtmlReport(summary, reportMeta) {
  const rows = summary.tests
    .map((t, idx) => {
      const mode = t.evaluationMode ?? 'unknown';
      const modeBadge =
        mode === 'rule-only'
          ? 'mode-ok'
          : mode === 'llm-used'
          ? 'mode-llm'
          : mode === 'llm-skipped'
          ? 'mode-warn'
          : 'mode-unk';
      const answerDisplay = escapeHtml(truncateText(t.answer ?? '', 600));
      const questionDisplay = escapeHtml(truncateText(t.question ?? '', 180));
      const ts = t.timestamp ? new Date(t.timestamp).toLocaleString() : '-';
      const status =
        t.evaluationPassed === true
          ? 'passed'
          : t.evaluationPassed === false || t.failureReason
          ? 'failed'
          : 'unknown';
      const statusBadge =
        status === 'passed'
          ? 'status-ok'
          : status === 'failed'
          ? 'status-fail'
          : 'status-unk';
      const reason = t.failureReason || t.evaluationReason || '';
      const expectations = formatExpectations(t.expectations);
      return `
        <tr>
          <td>${idx + 1}</td>
          <td>${escapeHtml(String(t.caseId ?? '-'))}</td>
          <td><span class="badge ${statusBadge}">${escapeHtml(status)}</span></td>
          <td><span class="badge ${modeBadge}">${escapeHtml(mode)}</span></td>
          <td>${questionDisplay}</td>
          <td>${answerDisplay}</td>
          <td>${escapeHtml(truncateText(reason, 220) || '-')}</td>
          <td><pre class="expectations">${escapeHtml(expectations)}</pre></td>
          <td>${escapeHtml(String(t.citationsCount ?? 0))}</td>
          <td>${escapeHtml(String(t.retrieval?.totalDataItems ?? 0))}</td>
          <td>${escapeHtml(String(t.retrieval?.totalChunks ?? 0))}</td>
          <td>${escapeHtml(ts)}</td>
        </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(reportMeta.title)}</title>
  <style>
    :root {
      --bg: #0b0f1a;
      --panel: #111827;
      --panel-2: #0f172a;
      --text: #e5e7eb;
      --muted: #9ca3af;
      --accent: #22d3ee;
      --ok: #10b981;
      --warn: #f59e0b;
      --llm: #6366f1;
      --danger: #ef4444;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      background: radial-gradient(1200px 800px at 10% 10%, #0f172a, #0b0f1a);
      color: var(--text);
      padding: 32px;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    h1 {
      font-size: 22px;
      margin: 0;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
      margin: 16px 0 24px;
    }
    .card {
      background: linear-gradient(135deg, var(--panel), var(--panel-2));
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 14px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    }
    .card .label { color: var(--muted); font-size: 12px; }
    .card .value { font-size: 20px; margin-top: 6px; }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #0f172a;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
    }
    thead th {
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      color: var(--muted);
      padding: 12px;
      background: #111827;
      border-bottom: 1px solid #1f2937;
    }
    tbody td {
      padding: 10px 12px;
      border-bottom: 1px solid #1f2937;
      vertical-align: top;
      font-size: 13px;
    }
    tbody tr:hover {
      background: rgba(34, 211, 238, 0.06);
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
    }
    .mode-ok { background: rgba(16,185,129,0.2); color: #34d399; border: 1px solid rgba(16,185,129,0.35); }
    .mode-llm { background: rgba(99,102,241,0.2); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.35); }
    .mode-warn { background: rgba(245,158,11,0.2); color: #fbbf24; border: 1px solid rgba(245,158,11,0.35); }
    .mode-unk { background: rgba(148,163,184,0.2); color: #cbd5f5; border: 1px solid rgba(148,163,184,0.35); }
    .status-ok { background: rgba(16,185,129,0.2); color: #34d399; border: 1px solid rgba(16,185,129,0.35); }
    .status-fail { background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid rgba(239,68,68,0.35); }
    .status-unk { background: rgba(148,163,184,0.2); color: #cbd5f5; border: 1px solid rgba(148,163,184,0.35); }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(34, 211, 238, 0.15);
      border: 1px solid rgba(34, 211, 238, 0.3);
      color: var(--accent);
      font-size: 12px;
    }
    .expectations {
      margin: 0;
      white-space: pre-wrap;
      font-family: "Consolas", "Courier New", monospace;
      font-size: 12px;
      color: #e2e8f0;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(reportMeta.title)}</h1>
      <div class="meta">Spec: ${escapeHtml(reportMeta.specId)} • Generated: ${escapeHtml(summary.generatedAt)}</div>
    </div>
    <div class="pill">Logs-only report</div>
  </header>
  <section class="grid">
    <div class="card"><div class="label">Total Cases</div><div class="value">${summary.totals.total}</div></div>
    <div class="card"><div class="label">Passed</div><div class="value">${summary.totals.passed ?? 0}</div></div>
    <div class="card"><div class="label">Failed</div><div class="value">${summary.totals.failed ?? 0}</div></div>
    <div class="card"><div class="label">Rule-only</div><div class="value">${summary.totals.ruleOnly}</div></div>
    <div class="card"><div class="label">LLM Used</div><div class="value">${summary.totals.llmUsed}</div></div>
    <div class="card"><div class="label">LLM Skipped</div><div class="value">${summary.totals.llmSkipped}</div></div>
  </section>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Case</th>
        <th>Status</th>
        <th>Eval Mode</th>
        <th>Question</th>
        <th>Answer (truncated)</th>
        <th>Reason</th>
        <th>Expectations</th>
        <th>Citations</th>
        <th>Retrieval Items</th>
        <th>Retrieval Chunks</th>
        <th>Time</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv);
  const logsPath = args.logs;
  const deleteAfter = (args.delete ?? 'true').toLowerCase() !== 'false';

  if (!logsPath) {
    console.error('Usage: node scripts/generate-chat-report.js --logs <logs.json|logs.jsonl|dir> [--delete true|false]');
    process.exit(2);
  }

  const files = listLogFiles(logsPath);
  if (files.length === 0) {
    console.error('No log files found.');
    process.exit(2);
  }

  const indexEntries = [];
  const reportsRoot = path.resolve(process.cwd(), 'test-results', 'reports', dateStamp());

  const grouped = new Map();
  for (const filePath of files) {
    const logs = loadLogs(filePath);
    if (!logs.length) {
      console.warn(`Skipping empty log: ${filePath}`);
      continue;
    }
    const specId = inferSpecId(logs, filePath);
    if (!specId) {
      console.warn(`Skipping log without specId: ${filePath}`);
      continue;
    }
    const entry = grouped.get(specId) ?? { logs: [], files: [] };
    entry.logs.push(...logs);
    entry.files.push(filePath);
    grouped.set(specId, entry);
  }

  for (const [specId, entry] of grouped.entries()) {
    const reportDir = path.resolve(reportsRoot, specId);
    fs.mkdirSync(reportDir, { recursive: true });

    const tests = entry.logs.map(normalizeRow);
    tests.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return ta - tb;
    });

    const totals = {
      total: tests.length,
      ruleOnly: tests.filter((t) => t.evaluationMode === 'rule-only').length,
      llmUsed: tests.filter((t) => t.evaluationMode === 'llm-used').length,
      llmSkipped: tests.filter((t) => t.evaluationMode === 'llm-skipped').length,
      passed: tests.filter((t) => t.evaluationPassed === true).length,
      failed: tests.filter((t) => t.evaluationPassed === false || t.failureReason).length
    };

    const summary = {
      totals,
      tests,
      generatedAt: new Date().toISOString()
    };

    const verdictPath = path.join(reportDir, 'verdict.json');
    const summaryPath = path.join(reportDir, 'summary.json');
    fs.writeFileSync(verdictPath, JSON.stringify(tests, null, 2), 'utf8');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

    const reportHtml = buildHtmlReport(summary, { specId, title: `Chat Report - ${specId}` });
    const reportPath = path.join(reportDir, 'report.html');
    fs.writeFileSync(reportPath, reportHtml, 'utf8');

    console.log(`Report written: ${reportPath}`);
    console.log(`Summary written: ${summaryPath}`);
    console.log(`Verdict written: ${verdictPath}`);

    indexEntries.push({
      specId,
      reportPath,
      summaryPath,
      verdictPath,
      total: totals.total,
      passed: totals.passed,
      failed: totals.failed,
      ruleOnly: totals.ruleOnly,
      llmUsed: totals.llmUsed,
      llmSkipped: totals.llmSkipped
    });

    if (deleteAfter) {
      for (const filePath of entry.files) {
        fs.unlinkSync(filePath);
        console.log(`Log deleted: ${filePath}`);
      }
    }
  }

  if (indexEntries.length) {
    const indexPath = path.join(reportsRoot, 'index.html');
    const rows = indexEntries
      .map((entry) => {
        const relReport = path.relative(path.dirname(indexPath), entry.reportPath).replace(/\\/g, '/');
        const relSummary = path.relative(path.dirname(indexPath), entry.summaryPath).replace(/\\/g, '/');
        const relVerdict = path.relative(path.dirname(indexPath), entry.verdictPath).replace(/\\/g, '/');
        return `
          <tr>
            <td>${escapeHtml(entry.specId)}</td>
            <td>${entry.total}</td>
            <td>${entry.passed}</td>
            <td>${entry.failed}</td>
            <td>${entry.ruleOnly}</td>
            <td>${entry.llmUsed}</td>
            <td>${entry.llmSkipped}</td>
            <td><a href="${relReport}">report</a></td>
            <td><a href="${relSummary}">summary</a></td>
            <td><a href="${relVerdict}">verdict</a></td>
          </tr>`;
      })
      .join('');

    const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Chat Reports Index</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 24px; background: #0b0f1a; color: #e5e7eb; }
    h1 { margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; background: #111827; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #1f2937; text-align: left; }
    th { color: #9ca3af; font-size: 12px; letter-spacing: 0.02em; }
    a { color: #22d3ee; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Chat Reports Index (${escapeHtml(dateStamp())})</h1>
  <table>
    <thead>
      <tr>
        <th>Spec</th>
        <th>Total</th>
        <th>Passed</th>
        <th>Failed</th>
        <th>Rule-only</th>
        <th>LLM Used</th>
        <th>LLM Skipped</th>
        <th>Report</th>
        <th>Summary</th>
        <th>Verdict</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
    fs.writeFileSync(indexPath, indexHtml, 'utf8');
    console.log(`Index written: ${indexPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
