import fs from 'fs';
import path from 'path';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
// Scoped to this step's surface (design tokens + shared primitives). `app/**` screens are
// W3.4/Phase 4 territory and out of scope here — see status.md for a known pre-existing
// exception (the placeholder tab-bar colors in app/(tabs)/_layout.tsx from the W0.6
// scaffold) that a future navigation step should replace with theme tokens.
const SCAN_DIRS = ['components', 'theme'];
const ALLOWED_FILES = new Set([path.join(MOBILE_ROOT, 'theme', 'colors.ts')]);
const HEX_PATTERN = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;

function collectSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.') || entry.name === '__tests__') {
        return [];
      }
      return collectSourceFiles(fullPath);
    }

    if (/\.(ts|tsx)$/.test(entry.name)) {
      return [fullPath];
    }

    return [];
  });
}

describe('design token discipline', () => {
  it('has no raw hex color literals outside theme/colors.ts', () => {
    const offenders = SCAN_DIRS.flatMap((dir) => collectSourceFiles(path.join(MOBILE_ROOT, dir)))
      .filter((file) => !ALLOWED_FILES.has(file))
      .filter((file) => HEX_PATTERN.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(MOBILE_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('flags a raw hex literal when one is introduced (sanity check for the rule itself)', () => {
    const tmpDir = path.join(MOBILE_ROOT, 'components');
    const tmpFile = path.join(tmpDir, '__tmp_hex_offender__.ts');
    fs.writeFileSync(tmpFile, "export const oops = '#ABCDEF';\n");

    try {
      const offenders = collectSourceFiles(tmpDir)
        .filter((file) => !ALLOWED_FILES.has(file))
        .filter((file) => HEX_PATTERN.test(fs.readFileSync(file, 'utf8')))
        .map((file) => path.relative(MOBILE_ROOT, file));

      expect(offenders).toContain(path.relative(MOBILE_ROOT, tmpFile));
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
