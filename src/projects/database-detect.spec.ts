/**
 * The database gate blocks the user's request when it answers true, so its
 * prompt is load-bearing. These tests pin the parts that caused a real
 * incident: "remove login/signup feature" was blocked with "this feature needs
 * a database" because the old prompt listed auth as a true-trigger with no
 * notion of direction.
 */
import {
  DatabaseDetectService,
  buildDetectionUserContent,
} from './database-detect.service';
import type { LlmService, LlmMessage } from '../credits/llm.service';

function serviceWith(
  reply: string,
  captured?: { req?: { messages: LlmMessage[]; overrideModel?: string } },
): DatabaseDetectService {
  const llm = {
    chat: (req: { messages: LlmMessage[]; overrideModel?: string }) => {
      if (captured) captured.req = req;
      return Promise.resolve({ content: reply });
    },
  } as unknown as LlmService;
  return new DatabaseDetectService(llm);
}

describe('buildDetectionUserContent', () => {
  it('fences the request so it is classified, not obeyed', () => {
    const out = buildDetectionUserContent('remove login/signup feature');
    expect(out).toContain('USER REQUEST (classify ONLY this):');
    expect(out).toContain('remove login/signup feature');
  });

  it('includes app context when known, marked as context only', () => {
    const out = buildDetectionUserContent('add reviews', {
      name: 'Ember & Steam',
      idea: 'A neighbourhood coffee shop in Portland',
    });
    expect(out).toContain('EXISTING APP (context only');
    expect(out).toContain('Ember & Steam');
    expect(out).toContain('A neighbourhood coffee shop in Portland');
  });

  it('omits the context block entirely when nothing is known', () => {
    const out = buildDetectionUserContent('add login', {
      name: '  ',
      idea: null,
    });
    expect(out).not.toContain('EXISTING APP');
  });
});

describe('DatabaseDetectService', () => {
  it('instructs the model that removals never need a database', async () => {
    const captured: {
      req?: { messages: LlmMessage[]; overrideModel?: string };
    } = {};
    const service = serviceWith('{"requiresDatabase": false}', captured);
    await service.promptRequiresDatabase('remove login/signup feature');

    const system = captured.req!.messages[0].content;
    // The rule that was missing when the incident happened.
    expect(system).toMatch(/REMOVING, deleting, disabling/);
    expect(system).toContain('"remove login/signup feature" -> false');
    expect(system).toContain('"remove the auth module entirely" -> false');
    // …without losing the true cases the gate exists for.
    expect(system).toContain('"add login so users can sign up" -> true');
  });

  it('uses the stronger classifier model, since a false positive blocks work', async () => {
    const captured: {
      req?: { messages: LlmMessage[]; overrideModel?: string };
    } = {};
    const service = serviceWith('{"requiresDatabase": true}', captured);
    await service.promptRequiresDatabase('add user accounts');
    expect(captured.req!.overrideModel).toBe('gpt-4o');
  });

  it('returns true only when the model says so', async () => {
    await expect(
      serviceWith('{"requiresDatabase": true}').promptRequiresDatabase('x'),
    ).resolves.toBe(true);
    await expect(
      serviceWith('{"requiresDatabase": false}').promptRequiresDatabase('x'),
    ).resolves.toBe(false);
  });

  it('fails OPEN — an unparseable reply must not block the user', async () => {
    await expect(
      serviceWith('not json').promptRequiresDatabase('remove auth'),
    ).resolves.toBe(false);
  });
});
