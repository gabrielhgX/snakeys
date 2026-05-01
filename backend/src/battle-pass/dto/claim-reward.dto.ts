import { IsInt, Max, Min } from 'class-validator';
import { MAX_LEVEL } from '../../progression/progression.constants';

export class ClaimRewardDto {
  @IsInt()
  @Min(1)
  @Max(MAX_LEVEL)
  level!: number;
}
