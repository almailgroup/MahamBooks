/**
 * Draws the fictional sample company's logo (scripts/assets/sample-logo.png)
 * used in template previews. Requires poppler (pdftocairo).
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/make-sample-logo.tsx
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  Circle,
  Document,
  Page,
  Path,
  Rect,
  Svg,
  Text,
  View,
  renderToFile,
} from '@react-pdf/renderer';
import { registerFonts } from '../src/pdf/fonts';

registerFonts(['inter', 'plexarabic'], (file) => join(resolve('src/pdf/fonts'), file));

const TEAL = '#0f766e';
const SAND = '#f59e0b';

const logo = (
  <Document>
    <Page size={[640, 160]} style={{ flexDirection: 'row', alignItems: 'center', padding: 8 }}>
      <Svg width={144} height={144} viewBox="0 0 144 144">
        <Rect x={0} y={0} width={144} height={144} rx={30} ry={30} fill={TEAL} />
        <Circle cx={98} cy={44} r={16} fill={SAND} />
        <Rect x={28} y={60} width={88} height={58} rx={8} ry={8} fill="#ffffff" />
        <Path d="M32 66 L72 94 L112 66" stroke={TEAL} strokeWidth={7} fill="none" />
      </Svg>
      <View style={{ marginLeft: 22, flex: 1 }}>
        <Text
          style={{
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 58,
            color: '#0f172a',
            letterSpacing: -1.5,
            lineHeight: 1,
          }}
        >
          Al Waha
        </Text>
        <Text
          style={{
            fontFamily: 'IBM Plex Sans Arabic',
            fontWeight: 600,
            fontSize: 30,
            color: TEAL,
            direction: 'rtl',
            textAlign: 'left',
            marginTop: 6,
          }}
        >
          الواحة للطباعة والبريد
        </Text>
      </View>
    </Page>
  </Document>
);

const dir = mkdtempSync(join(tmpdir(), 'logo-'));
const pdf = join(dir, 'logo.pdf');
await renderToFile(logo, pdf);
execFileSync('pdftocairo', ['-png', '-transp', '-singlefile', '-r', '108', pdf, join(dir, 'logo')]);
renameSync(join(dir, 'logo.png'), resolve('scripts/assets/sample-logo.png'));
console.log('scripts/assets/sample-logo.png');
