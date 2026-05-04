import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

export class BackendClient {
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.backendUrl,
      headers: { 'X-Internal-Key': config.internalApiKey },
      timeout: 5000,
    });
  }

  async processBetEntry(
    userId:  string,
    amount:  number,
    matchId: string,
    mode?:   string,
  ): Promise<void> {
    await this.http.post('/api/internal/match/entry', { userId, amount, matchId, mode });
  }

  async processMatchResult(
    userId:     string,
    matchId:    string,
    betAmount:  number,
    payout:     number,
    finalMass?: number,
  ): Promise<void> {
    await this.http.post('/api/internal/match/result', {
      userId,
      matchId,
      betAmount,
      payout,
      finalMass,
    });
  }

  async getUser(token: string): Promise<{ id: string; email: string } | null> {
    try {
      const res = await this.http.get('/api/users/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.data;
    } catch {
      return null;
    }
  }
}
