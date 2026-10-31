import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  validateSync,
} from 'class-validator';

export class Env {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsUrl({ require_tld: false })
  SUPABASE_URL: string;

  @IsInt()
  PORT: number = 3000;

  /** Comma-separated list of allowed browser origins */
  @IsString()
  CORS_ORIGINS: string = '';

  @IsUrl({ require_tld: false })
  MOMO_BASE_URL: string = 'https://sandbox.momodeveloper.mtn.com';

  @IsString()
  MOMO_TARGET_ENVIRONMENT: string = 'sandbox';

  @IsIn(['EUR', 'RWF'])
  MOMO_CURRENCY: string = 'EUR';

  @IsOptional()
  @IsString()
  MOMO_SUBSCRIPTION_KEY?: string;

  @IsOptional()
  @IsString()
  MOMO_API_USER?: string;

  @IsOptional()
  @IsString()
  MOMO_API_KEY?: string;

  @IsOptional()
  @IsString()
  MOMO_CALLBACK_URL?: string;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  return env;
}
