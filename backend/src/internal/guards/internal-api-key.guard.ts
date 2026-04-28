import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const apiKey = process.env.INTERNAL_API_KEY;

    if (!apiKey) {
      throw new InternalServerErrorException('INTERNAL_API_KEY not configured');
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const provided = request.headers['x-internal-key'];

    if (!provided || !this.secureCompare(provided, apiKey)) {
      throw new ForbiddenException('Invalid or missing internal API key');
    }

    return true;
  }

  // SHA-256 normalizes both sides to 32 bytes before timingSafeEqual,
  // avoiding the length-mismatch throw while keeping constant-time guarantees.
  private secureCompare(a: string, b: string): boolean {
    const hashA = createHash('sha256').update(a).digest();
    const hashB = createHash('sha256').update(b).digest();
    return timingSafeEqual(hashA, hashB);
  }
}
