import { Test, TestingModule } from '@nestjs/testing';
import { PixGatewayService } from './pix-gateway.service';
import { PixVerificationService } from './pix-verification.service';

describe('PixVerificationService', () => {
  let service: PixVerificationService;
  const gateway = {
    resolveKey: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PixVerificationService,
        { provide: PixGatewayService, useValue: gateway },
      ],
    }).compile();
    service = module.get(PixVerificationService);
  });

  it('returns verified=true when the gateway CPF matches the user CPF', async () => {
    gateway.resolveKey.mockResolvedValue({
      pixKey:     '12345678909',
      ownerTaxId: '12345678909',
      ownerName:  'Fulano',
    });

    const result = await service.verifyPixOwnership('12345678909', '123.456.789-09');

    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.ownerTaxId).toBe('12345678909');
    }
  });

  it('returns CPF_MISMATCH when the gateway reports a different CPF', async () => {
    gateway.resolveKey.mockResolvedValue({
      pixKey:     'other:99999999999',
      ownerTaxId: '99999999999',
      ownerName:  'Terceiro',
    });

    const result = await service.verifyPixOwnership('other:99999999999', '12345678909');

    expect(result.verified).toBe(false);
    if (!result.verified) {
      expect(result.reason).toBe('CPF_MISMATCH');
    }
  });

  it('returns PIX_KEY_NOT_FOUND when the gateway cannot resolve the key', async () => {
    gateway.resolveKey.mockResolvedValue(null);

    const result = await service.verifyPixOwnership('unknown', '12345678909');

    expect(result.verified).toBe(false);
    if (!result.verified) {
      expect(result.reason).toBe('PIX_KEY_NOT_FOUND');
    }
  });
});
