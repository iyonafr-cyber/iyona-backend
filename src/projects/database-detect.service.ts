import { Injectable, Logger } from '@nestjs/common';
import { LlmMessage, LlmService } from '../credits/llm.service';

/**
 * The gate in front of the Cursor agent: answering `true` BLOCKS the user's
 * request and asks them to connect Supabase.
 *
 * WHY THIS PROMPT IS SHAPED LIKE THIS: the original version was a keyword list
 * ("answer true when the request implies … user authentication (login, sign
 * up, accounts, profiles)"). It had no notion of DIRECTION, so "remove
 * login/signup feature" matched the auth bullet and got blocked with "this
 * feature needs a database" — for a change that deletes code and needs nothing.
 * A carve-out for questions had already been bolted on for the same class of
 * bug. The fix is to lead with the actual test (does the app, AFTER the change,
 * need server-side persistence it lacks today?) and to make removals, questions
 * and UI work explicit false cases with examples, because a false positive
 * stops work the builder could do with no database at all.
 */
const SYSTEM_PROMPT = `You are a gate in front of an AI app builder. Decide whether fulfilling the user's request REQUIRES a persistent database (Supabase).

Answering true BLOCKS the request and tells the user to go connect a database. A wrong "true" is expensive: it stops work the builder could have completed with no database at all. When genuinely unsure, answer false — the builder can ask for a database later.

THE TEST: after this change is made, will the app need to READ OR WRITE data on a server that it cannot today? Only then is a database required. Merely MENTIONING a feature is not the same as building it.

Answer {"requiresDatabase": false} when the request is:
  - REMOVING, deleting, disabling, hiding, reverting or simplifying a feature — including auth, accounts, checkout, uploads. Taking something OUT never needs a database, even when the thing removed is authentication.
  - A QUESTION about the existing app ("does this have login?", "is there a database?", "how does checkout work?"). Asking whether a feature exists is not a request to build it.
  - Visual / UI / layout / styling / copy / navigation / animation work.
  - Anything explicitly on mock, sample, demo, static or localStorage data.
  - A bug report or fix that adds no new persistence.

Answer {"requiresDatabase": true} only when the request ADDS real persistence or CONVERTS mock data to real data:
  - Adding authentication that actually signs real users in / real accounts or profiles
  - Saving or loading data that must survive across sessions, devices or users
  - Making existing mock data real ("make the form actually save", "connect this to a backend")
  - File uploads that must be stored
  - Real-time features backed by a server (live updates, chat, notifications)

DIRECTION MATTERS MORE THAN KEYWORDS:
  "add login so users can sign up" -> true
  "remove login/signup feature" -> false
  "remove the auth module entirely" -> false
  "hide the sign-up button" -> false
  "get rid of user accounts" -> false
  "does the app have accounts?" -> false
  "change the login page button colour" -> false
  "delete the admin panel" -> false
  "make the contact form actually save submissions" -> true
  "let customers upload and store photos" -> true

Respond with ONLY a JSON object of the form {"requiresDatabase": boolean}.`;

/** What the app is, so the classifier judges the request in context. */
export interface DetectAppContext {
  /** Project name. */
  name?: string | null;
  /** The original app idea the project was generated from. */
  idea?: string | null;
}

/**
 * Compose the user turn: the app context (when known) followed by the request,
 * clearly fenced so the request is never read as instructions to the gate.
 * Exported for tests.
 */
export function buildDetectionUserContent(
  prompt: string,
  context?: DetectAppContext,
): string {
  const name = context?.name?.trim();
  const idea = context?.idea?.trim();
  const lines: string[] = [];
  if (name || idea) {
    lines.push('EXISTING APP (context only — do not classify this):');
    if (name) lines.push(`  Name: ${name.slice(0, 200)}`);
    if (idea) lines.push(`  About: ${idea.slice(0, 800)}`);
    lines.push('');
  }
  lines.push('USER REQUEST (classify ONLY this):', prompt.trim());
  return lines.join('\n');
}

@Injectable()
export class DatabaseDetectService {
  private readonly logger = new Logger(DatabaseDetectService.name);

  constructor(private readonly llm: LlmService) {}

  async promptRequiresDatabase(
    prompt: string,
    context?: DetectAppContext,
  ): Promise<boolean> {
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildDetectionUserContent(prompt, context) },
    ];

    try {
      const res = await this.llm.chat({
        task: 'classify',
        messages,
        temperature: 0,
        jsonMode: true,
        maxOutputTokens: 50,
        // This one call decides whether the user is allowed to proceed, so it
        // is worth a stronger model than the mini default: a false positive
        // blocks the request outright. Still pennies at ~50 output tokens.
        overrideModel: 'gpt-4o',
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
