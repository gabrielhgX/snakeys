import { IsString, IsUUID } from 'class-validator';

/**
 * Payload for the **dev-only** deposit simulation endpoint.
 *
 * In production the endpoint is disabled (returns 404), so this DTO only
 * runs during local development / e2e tests.
 */
export class SimulateDepositDto {
  @IsString()
  @IsUUID()
  transactionId: string;
}
