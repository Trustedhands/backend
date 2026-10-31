import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MinLength,
  ValidateIf,
  validateSync,
} from 'class-validator';

export class Env {
  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  /** HS256 key for access tokens */
  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  /** How emails (incl. verification codes) are sent; "log" is for development only */
  @IsIn(['log', 'resend'])
  EMAIL_PROVIDER: 'log' | 'resend' = 'log';

  @ValidateIf((env: Env) => env.EMAIL_PROVIDER === 'resend')
  @IsString()
  @IsNotEmpty()
  RESEND_API_KEY?: string;

  /** Verified sending domain in Resend, e.g. trustedhands.rw */
  @ValidateIf((env: Env) => env.EMAIL_PROVIDER === 'resend' && !env.EMAIL_FROM)
  @IsString()
  @IsNotEmpty()
  EMAIL_DOMAIN?: string;

  /** Optional full sender, e.g. "TrustedHands <hello@trustedhands.rw>" */
  @IsOptional()
  @IsString()
  EMAIL_FROM?: string;

  /** How phone codes are delivered; "log" is for development only */
  @IsIn(['log', 'africastalking'])
  SMS_PROVIDER: 'log' | 'africastalking' = 'log';

  @ValidateIf((env: Env) => env.SMS_PROVIDER === 'africastalking')
  @IsString()
  @IsNotEmpty()
  AFRICAS_TALKING_API_KEY?: string;

  /** "sandbox" selects Africa's Talking's sandbox */
  @ValidateIf((env: Env) => env.SMS_PROVIDER === 'africastalking')
  @IsString()
  @IsNotEmpty()
  AFRICAS_TALKING_USERNAME?: string;

  /** Registered alphanumeric sender ID; omit to use Africa's Talking's shared one */
  @IsOptional()
  @IsString()
  AFRICAS_TALKING_SENDER_ID?: string;

  @IsInt()
  PORT: number = 3000;

  /** Comma-separated list of allowed browser origins */
  @IsString()
  CORS_ORIGINS: string = '';

  @IsUrl({ require_tld: false })
  MOMO_BASE_URL: string = 'https://sandbox.momodeveloper.mtn.com';

  @IsString()
  MOMO_TARGET_ENVIRONMENT: string = 'sandbox';

  /** The sandbox only accepts EUR; production in Rwanda uses RWF */
  @IsIn(['EUR', 'RWF'])
  MOMO_COLLECTION_CURRENCY: string = 'EUR';

  /** Collections product subscription key (primary) */
  @IsOptional()
  @IsString()
  MOMO_PRY_KEY?: string;

  @IsOptional()
  @IsString()
  MOMO_API_USER_ID?: string;

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
  if (
    env.NODE_ENV === 'production' &&
    (env.EMAIL_PROVIDER === 'log' || env.SMS_PROVIDER === 'log')
  ) {
    throw new Error(
      'EMAIL_PROVIDER and SMS_PROVIDER must be real providers in production: "log" would print verification codes to the logs',
    );
  }
  return env;
}
