import { GmailRepository } from '../../../src/testing/repositories/GmailRepository';
import { loadEnvOnce } from '../../../src/testing/utils/envLoader';
import { CodexRunContext, GmailChatCase } from '../types';
import { safeString } from '../utils/io';

export async function sendGmail(context: CodexRunContext): Promise<void> {
  loadEnvOnce();
  const caseData = context.caseData as GmailChatCase;
  const fromAddress =
    safeString(process.env.GMAIL_TEST_ADDRESS) || safeString(process.env.GMAIL_TEST_FROM);
  const toAddress = safeString(process.env.GMAIL_TEST_TO) || fromAddress;

  if (!fromAddress || !toAddress) {
    throw new Error('GMAIL_TEST_ADDRESS (or GMAIL_TEST_FROM) is required.');
  }

  const gmailRepository = new GmailRepository();

  console.info('Step 1: Sending email...');
  const sendResult = await gmailRepository.sendMessage('me', {
    from: fromAddress,
    to: toAddress,
    subject: caseData.subject,
    body: caseData.body
  });

  if (sendResult.errors.length > 0) {
    throw new Error(`Gmail send errors: ${sendResult.errors.join('; ')}`);
  }
  if (!sendResult.id) {
    throw new Error('Gmail send did not return message id.');
  }

  const detailsResult = await gmailRepository.getMessageDetails('me', [sendResult.id], 1);
  if (detailsResult.errors.length > 0) {
    throw new Error(`Gmail message details errors: ${detailsResult.errors.join('; ')}`);
  }
  const messageDetails = detailsResult.details[0];
  if (!messageDetails) {
    throw new Error('Gmail message details not found for sent message.');
  }
  console.info(`Gmail message subject: ${messageDetails.subject}`);
  console.info(`Gmail message date: ${messageDetails.date}`);

  context.bundle.email = {
    from: fromAddress,
    to: toAddress,
    messageId: sendResult.id,
    threadId: sendResult.threadId ?? null,
    sentAt: new Date().toISOString()
  };

  console.info(`Sent message id: ${sendResult.id}`);
}