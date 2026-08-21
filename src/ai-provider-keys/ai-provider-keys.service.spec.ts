import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { AiProviderKeysService } from './ai-provider-keys.service';
import { AiProviderKey } from './entities/ai-provider-key.entity';
import { AiProviderHealthService } from './ai-provider-health.service';
import type { IEncryptionService } from '../encryption/interface/encryption.interface.service';

describe('AiProviderKeysService', () => {
  const encryption: IEncryptionService = {
    encrypt: (s: string) => `enc:${s}`,
    decrypt: (s: string) => s.replace(/^enc:/, ''),
  };

  const mockHealth = {
    recordSuccess: jest.fn().mockResolvedValue(undefined),
    applyProbeFailure: jest.fn().mockResolvedValue(undefined),
  };

  const mockModel = {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    }),
  };

  it('loadRoutingSnapshot returns empty when no keys', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiProviderKeysService,
        { provide: 'IEncryptionService', useValue: encryption },
        { provide: getModelToken(AiProviderKey.name), useValue: mockModel },
        { provide: AiProviderHealthService, useValue: mockHealth },
      ],
    }).compile();

    const svc = moduleRef.get(AiProviderKeysService);
    const snap = await svc.loadRoutingSnapshot();
    expect(snap.keys).toEqual([]);
    expect(snap.supportedByKeyId.size).toBe(0);
  });
});
