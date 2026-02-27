import { test } from '@playwright/test';
import { AdminInstancesRepository } from '../../src/api/repositories/AdminInstancesRepository';
import { AdminInstancesValidator } from '../../src/api/validators/AdminInstancesValidator';
import {RawItemRepository} from "../../src/db/repositories/RawItemRepository";
import {ChatRepository} from "../../src/api/repositories/ChatRepository";
import {ChatValidator} from "../../src/api/validators/ChatValidator";
import {ChatRequestPayload} from "../../src/api/models/chat";

test('Chat Test', async ({ request }) => {




    const repository = new AdminInstancesRepository(
        request,
        process.env.API_BASE_URL ?? 'https://localhost:5199'
    );

    const response = await repository.getAdminInstancesRaw();
    const json = await repository.getPreparedJson();
    const ravRepo = new RawItemRepository();
    const chatValidator = new ChatValidator();
    const chatRepo = new ChatRepository(request,
        process.env.API_BASE_URL ?? 'https://localhost:5199'
    );
    const ask = {
        "query": "I have mails from uewek87@gmail.com   ?",
        "session": 14,
        "model": "string",
        "attachmentIds": [
            0
        ],
        "includeAnswerLog": true
    };
    const answer = await chatRepo.sendChat(ask);

    await chatValidator.validateSourceUsage(answer, { source: 'gmail', externalIds: ['19c8c0b2f79f6627', '19c96bd97dc637ce'], });
    // const rawItems = await ravRepo.getBySourceAccount('mykola@launchnyc.io');
    //
    //
    // const validator = new AdminInstancesValidator();
    // await validator.checkConnectorItems(json,'gmail',361);
});