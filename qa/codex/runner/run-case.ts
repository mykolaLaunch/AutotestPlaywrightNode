import path from 'path';
import { loadEnvOnce } from '../../../src/testing/utils/envLoader';
import { CodexCase, CodexRunBundle, CodexRunContext } from '../types';
import { askChat } from '../steps/askChat';
import { saveBundle } from '../steps/saveBundle';
import { sendGmail } from '../steps/sendGmail';
import { waitIngest } from '../steps/waitIngest';
import { dateStamp, getArgValue, readJsonFile, writeJsonFile } from '../utils/io';

const DEFAULT_STEPS_BY_TYPE: Record<string, string[]> = {
  'gmail-chat': ['sendGmail', 'waitIngest', 'askChat', 'saveBundle']
};

async function runStep(stepName: string, context: CodexRunContext): Promise<void> {
  switch (stepName) {
    case 'sendGmail':
      return sendGmail(context);
    case 'waitIngest':
      return waitIngest(context);
    case 'askChat':
      return askChat(context);
    case 'saveBundle':
      return saveBundle(context);
    default:
      throw new Error(`Unknown step: ${stepName}`);
  }
}

function buildInitialBundle(caseData: CodexCase, caseFilePath: string, runId: string): CodexRunBundle {
  return {
    runId,
    caseId: caseData.id,
    caseFile: caseFilePath,
    case: {
      id: caseData.id,
      type: caseData.type,
      subject: (caseData as { subject?: string }).subject,
      body: (caseData as { body?: string }).body,
      question: (caseData as { question?: string }).question,
      command: caseData.command ?? null
    },
    email: {
      from: '',
      to: '',
      messageId: null,
      threadId: null,
      sentAt: null
    },
    ingest: {
      found: false,
      attempts: [],
      matchedRowsCount: 0
    },
    chat: {
      apiBaseUrl: process.env.API_BASE_URL ?? 'https://localhost:5199',
      payload: null,
      status: null,
      errors: [],
      answer: null,
      citations: null,
      answerLog: null
    },
    timestamps: {
      startedAt: new Date().toISOString(),
      finishedAt: null
    },
    failureReason: null
  };
}

async function main(): Promise<void> {
  loadEnvOnce();

  const caseFileArg = getArgValue('--case-file');
  if (!caseFileArg) {
    throw new Error('Missing required argument: --case-file <path>');
  }

  const caseFilePath = path.resolve(process.cwd(), caseFileArg);
  const caseData = await readJsonFile<CodexCase>(caseFilePath);

  const runId = `run-${Date.now()}`;
  const bundlePath = path.join(
    process.cwd(),
    'qa',
    'logs',
    dateStamp(),
    caseData.id,
    `${runId}.json`
  );

  const bundle = buildInitialBundle(caseData, caseFilePath, runId);
  const context: CodexRunContext = {
    caseFilePath,
    runId,
    startedAt: bundle.timestamps.startedAt,
    bundlePath,
    caseData,
    bundle
  };

  try {
    console.info(`--- Codex case start: ${caseData.id}`);
    console.info(`Case file: ${caseFilePath}`);

    const steps =
      Array.isArray(caseData.steps) && caseData.steps.length > 0
        ? caseData.steps
        : DEFAULT_STEPS_BY_TYPE[caseData.type] ?? [];

    if (steps.length === 0) {
      throw new Error(`No steps configured for type ${caseData.type}`);
    }

    for (const stepName of steps) {
      await runStep(stepName, context);
    }

    context.bundle.timestamps.finishedAt = new Date().toISOString();
    if (!steps.includes('saveBundle')) {
      await writeJsonFile(context.bundlePath, context.bundle);
      console.info(`Bundle saved: ${context.bundlePath}`);
    }

    console.info(`--- Codex case end: ${caseData.id}`);
    console.info(
      `Manual verdict required: review bundle ${context.bundlePath} and report PASS/FAIL with rationale.`
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    context.bundle.failureReason = reason;
    context.bundle.timestamps.finishedAt = new Date().toISOString();
    await writeJsonFile(context.bundlePath, context.bundle);
    console.error(`FAILED: ${reason}`);
    console.error(`Bundle saved: ${context.bundlePath}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
