/**
 * The "Test key" probe must never fail because of OUR model choice.
 *
 * Three real incidents, each a different way of getting this wrong:
 *   1. a pinned `gemini-2.0-flash` → 404 long after the key was fine;
 *   2. a single live-discovered pick → 404 again, because Google still
 *      *lists* `gemini-2.5-flash` while telling this account it is "no longer
 *      available to new users". Listed != callable;
 *   3. `max_completion_tokens: 1` → reasoning models burn the budget on
 *      reasoning and never emit output.
 *
 * So: candidates are discovered, ordered, and walked until one answers.
 */
import axios from 'axios';
import { Types } from 'mongoose';
import { AiProviderKeysService } from './ai-provider-keys.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const KEY_ID = new Types.ObjectId().toHexString();

function listing(names: string[]) {
  return {
    data: {
      models: names.map((n) => ({
        name: `models/${n}`,
        supportedGenerationMethods: ['generateContent'],
      })),
    },
  };
}

function notFound(model: string) {
  return {
    isAxiosError: true,
    message: 'Request failed with status code 404',
    response: {
      status: 404,
      data: {
        error: {
          code: 404,
          message: `This model models/${model} is no longer available to new users.`,
          status: 'NOT_FOUND',
        },
      },
    },
  };
}

function highDemand(model: string) {
  return {
    isAxiosError: true,
    message: 'Request failed with status code 503',
    response: {
      status: 503,
      data: {
        error: {
          code: 503,
          message:
            'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
          status: 'UNAVAILABLE',
        },
      },
    },
  };
}

function modalitiesRejected(model: string) {
  return {
    isAxiosError: true,
    message: 'Request failed with status code 400',
    response: {
      status: 400,
      data: {
        error: {
          code: 400,
          message: `The requested combination of response modalities (TEXT) is not supported by the model. models/${model} accepts the following combination of response modalities:\n* AUDIO\n`,
          status: 'INVALID_ARGUMENT',
        },
      },
    },
  };
}

function buildService(supportedModels: string[]) {
  const health = {
    // Real semantics from AiProviderHealthService.
    isModelScopedFailure: (status: number | undefined, msg: string) =>
      status === 404 ||
      /not_found/i.test(msg) ||
      /response modalities/i.test(msg),
    recordSuccess: jest.fn(),
    applyProbeFailure: jest.fn(),
  };
  const service = new AiProviderKeysService(
    {
      findById: () => ({
        lean: () =>
          Promise.resolve({
            _id: KEY_ID,
            provider: 'google',
            supportedModels,
            apiKeyEnc: 'enc',
          }),
      }),
    } as never,
    { decrypt: () => 'gk-test' } as never,
    health as never,
  );
  return { service, health };
}

describe('Provider key probe', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockedAxios as unknown as { isAxiosError: unknown }).isAxiosError = (
      e: unknown,
    ) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError);
  });

  it('moves past a listed-but-unavailable model instead of failing the key', async () => {
    // Google lists the retired model, so a single pick would stop here.
    (mockedAxios.get as jest.Mock).mockResolvedValue(
      listing(['gemini-2.5-flash', 'gemini-3.6-flash']),
    );
    (mockedAxios.post as jest.Mock).mockImplementation((url: string) =>
      url.includes('gemini-2.5-flash')
        ? Promise.reject(notFound('gemini-2.5-flash'))
        : Promise.resolve({ data: {} }),
    );

    const { service, health } = buildService(['gemini-2.5-flash']);
    const result = await service.testKey(KEY_ID);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('gemini-3.6-flash');
    expect(health.recordSuccess).toHaveBeenCalled();
    expect(health.applyProbeFailure).not.toHaveBeenCalled();
  });

  it('skips Gemini TTS models listed under generateContent', async () => {
    // Live failure: cheap-first sort picked gemini-2.5-flash-preview-tts
    // after gemini-2.5-flash 404'd. TTS rejects TEXT with HTTP 400.
    (mockedAxios.get as jest.Mock).mockResolvedValue(
      listing([
        'gemini-2.5-flash',
        'gemini-2.5-flash-preview-tts',
        'gemini-3.6-flash',
      ]),
    );
    (mockedAxios.post as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('preview-tts')) {
        return Promise.reject(
          modalitiesRejected('gemini-2.5-flash-preview-tts'),
        );
      }
      if (url.includes('gemini-2.5-flash')) {
        return Promise.reject(notFound('gemini-2.5-flash'));
      }
      return Promise.resolve({ data: {} });
    });

    const { service, health } = buildService(['gemini-2.5-flash']);
    const result = await service.testKey(KEY_ID);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('gemini-3.6-flash');
    const probed = (mockedAxios.post as jest.Mock).mock.calls.map(
      (c: [string]) => c[0],
    ) as string[];
    expect(probed.some((u) => u.includes('preview-tts'))).toBe(false);
    expect(health.recordSuccess).toHaveBeenCalled();
  });

  it('walks past a 503 high-demand flash model onto a different family', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue(
      listing(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-3.6-pro']),
    );
    (mockedAxios.post as jest.Mock).mockImplementation((url: string) =>
      url.includes('flash')
        ? Promise.reject(highDemand('flash'))
        : Promise.resolve({ data: {} }),
    );

    const { service, health } = buildService([]);
    const result = await service.testKey(KEY_ID);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('gemini-3.6-pro');
    expect(health.recordSuccess).toHaveBeenCalled();
    expect(health.applyProbeFailure).not.toHaveBeenCalled();
  });

  it('stops on a credential failure rather than trying every model', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue(
      listing(['gemini-3.6-flash', 'gemini-3.6-pro']),
    );
    (mockedAxios.post as jest.Mock).mockRejectedValue({
      isAxiosError: true,
      message: 'Request failed with status code 401',
      response: {
        status: 401,
        data: { error: { message: 'API key invalid' } },
      },
    });

    const { service, health } = buildService([]);
    const result = await service.testKey(KEY_ID);

    expect(result.ok).toBe(false);
    // One attempt only — a bad key must not fan out into N provider calls.
    expect((mockedAxios.post as jest.Mock).mock.calls).toHaveLength(1);
    expect(health.applyProbeFailure).toHaveBeenCalled();
  });

  it('reports what it tried when every candidate is gone', async () => {
    (mockedAxios.get as jest.Mock).mockResolvedValue(
      listing(['gemini-2.5-flash']),
    );
    (mockedAxios.post as jest.Mock).mockImplementation(() =>
      Promise.reject(notFound('gemini-2.5-flash')),
    );

    const { service } = buildService(['gemini-2.5-flash']);
    const result = await service.testKey(KEY_ID);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('tried:');
  });

  it('still probes when discovery fails, using the configured models', async () => {
    (mockedAxios.get as jest.Mock).mockRejectedValue(new Error('network'));
    (mockedAxios.post as jest.Mock).mockResolvedValue({ data: {} });

    const { service } = buildService(['gemini-3.6-flash']);
    const result = await service.testKey(KEY_ID);

    expect(result.ok).toBe(true);
    expect(result.message).toContain('gemini-3.6-flash');
  });
});
