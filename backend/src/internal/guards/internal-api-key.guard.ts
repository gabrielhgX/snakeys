import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const apiKey = process.env.INTERNAL_API_KEY;

    // Fail-closed: if key is not configured, deny everything
    if (!apiKey) {
      throw new InternalServerErrorException('INTERNAL_API_KEY not configured');
    }

    const request = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const provided = request.headers['x-internal-key'];

    if (!provided || provided !== apiKey) {
      throw new ForbiddenException('Invalid or missing internal API key');
    }

    return true;
  }
}
