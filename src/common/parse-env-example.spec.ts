import {
  parseEnvExampleKeys,
  findEnvExampleContent,
  MAX_ENV_EXAMPLE_KEYS,
} from './parse-env-example';

describe('parseEnvExampleKeys', () => {
  it('parses keys with optional values and export prefix', () => {
    const src = `
# comment
export VITE_A=1
VITE_B=
INVALID-DASH=1
VITE_C
`;
    const { keys, tooManyKeys } = parseEnvExampleKeys(src);
    expect(tooManyKeys).toBe(false);
    expect(keys).toEqual(['VITE_A', 'VITE_B', 'VITE_C']);
  });

  it('dedupes repeated keys', () => {
    const { keys } = parseEnvExampleKeys('VITE_X=1\nVITE_X=2');
    expect(keys).toEqual(['VITE_X']);
  });

  it('flags too many keys', () => {
    const lines = Array.from(
      { length: MAX_ENV_EXAMPLE_KEYS + 3 },
      (_, i) => `K${i}=v`,
    );
    const { keys, tooManyKeys } = parseEnvExampleKeys(lines.join('\n'));
    expect(tooManyKeys).toBe(true);
    expect(keys.length).toBe(MAX_ENV_EXAMPLE_KEYS);
  });
});

describe('findEnvExampleContent', () => {
  it('finds .env.example in flat map', () => {
    const c = findEnvExampleContent({
      'src/x.ts': 'x',
      '.env.example': 'VITE_A=\n',
    });
    expect(c).toBe('VITE_A=\n');
  });
});
