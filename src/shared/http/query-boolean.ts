import { Transform } from 'class-transformer';

/** Query strings arrive as text; implicit conversion would turn "false" into true. */
export const QueryBoolean = () =>
  Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    return raw === true || raw === 'true' || raw === '1';
  });
