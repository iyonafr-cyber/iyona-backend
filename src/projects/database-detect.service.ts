import { Injectable, Logger } from '@nestjs/common';
import { LlmMessage, LlmService } from '../credits/llm.service';

const SYSTEM_PROMPT = `You decide whether a user's request (a new app description or an edit to an existing app) requires a persistent database.

Answer {"requiresDatabase": true} when the request implies ANY of:
  - Saving/loading data that persists across sessions or users
  - User authentication (login, sign up, accounts, profiles)
  - CRUD operations on real data (not just UI mock data)
  - Real-time features (live updates, notifications, chat)
  - File uploads or storage
  - API endpoints, backend logic, server-side operations
  - Any mention of "database", "save to DB", "store data", "persist", "backend"

Answer {"requiresDatabase": false} for purely visual/UI changes, mock data, layout, styling, or navigation.

Answer {"requiresDatabase": false} when the message is a QUESTION about the existing app rather than a request to build or change something — for example "does this app have login?", "is there a database?", "how does checkout work?", "which pages exist?". Asking whether a feature exists is not a request to build it, even when the question names accounts, storage, or a backend. Only a request to add, change, or fix something can require a database.

Respond with ONLY a JSON object.`;

@Injectable()
export class DatabaseDetectService {
  private readonly logger = new Logger(DatabaseDetectService.name);

  constructor(private readonly llm: LlmService) {}

  async promptRequiresDatabase(prompt: string): Promise<boolean> {
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    try {
      const res = await this.llm.chat({
        task: 'classify',
        messages,
        temperature: 0,
        jsonMode: true,
        maxOutputTokens: 50,
        overrideModel: 'gpt-4o-mini',
      });

      const parsed = JSON.parse(res.content);
      this.logger.log(
        `DB detection: requiresDatabase=${parsed.requiresDatabase}`,
      );
      return parsed.requiresDatabase === true;
    } catch (error) {
      this.logger.warn(`DB detection failed, defaulting to false: ${error}`);
      return false;
    }
  }
}
