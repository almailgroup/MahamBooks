import type { ReactElement } from 'react';
import { Document, Page, type DocumentProps } from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';
import { APP_NAME } from '@/lib/brand';
import { FONT_FAMILIES } from './fonts';
import { DirectionProvider, Image, Text, View, sx } from './templates/primitives';
import type { CostingSheetModel } from './costing-model';

/**
 * The cost sheet of a manpower costing (كشف التكلفة) on A4 landscape: the
 * company, the costing and its customer, a line per post with what a person
 * costs a month and sells for, the totals, the margin and what needs a
 * second look. Internal: printed from the costing page only, never attached
 * to the quote or emailed. Laid out left to right and mirrored for Arabic by
 * the direction-aware primitives.
 */

const INK = '#0f172a';
const BODY = '#1e293b';
const MUTED = '#64748b';
const LINE = '#e2e8f0';
const SOFT = '#f8fafc';
const ACCENT = '#0f766e';
const WARN = '#92400e';
const TNUM: Style = { fontFeatureSettings: ['tnum'] };

/** Fonts the cost sheet needs (the Arabic one is the fallback for Arabic letters). */
export const COSTING_FONTS = ['inter', 'plexarabic'] as const;

const POST_WIDTH = 150;

function CostingPage({ model }: { model: CostingSheetModel }) {
  const font = FONT_FAMILIES.inter.family;
  const amount = (strong = false): Style =>
    sx(TNUM, { flex: 1, textAlign: 'right', paddingHorizontal: 3 }, strong && { fontWeight: 700 });
  return (
    <Page
      size="A4"
      orientation="landscape"
      style={{
        fontFamily: font,
        fontSize: 8,
        color: BODY,
        paddingTop: 30,
        paddingBottom: 44,
        paddingHorizontal: 32,
        textAlign: model.dir === 'rtl' ? 'right' : 'left',
      }}
    >
      <DirectionProvider dir={model.dir} font={font}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            {model.company.logo ? (
              <Image
                src={model.company.logo}
                style={{ height: 34, width: 130, objectFit: 'contain', marginBottom: 6 }}
              />
            ) : null}
            <Text style={{ fontSize: 12, fontWeight: 700, color: INK }}>{model.company.name}</Text>
          </View>
          <View style={{ width: 300, alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 18, fontWeight: 700, color: ACCENT }}>{model.title}</Text>
            <Text style={{ fontSize: 8, color: WARN, marginTop: 2 }}>{model.notice}</Text>
            <View style={{ marginTop: 6, width: 300 }}>
              {model.meta.map((m) => (
                <View
                  key={m.label}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 1,
                  }}
                >
                  <Text style={{ color: MUTED }}>{m.label}</Text>
                  <Text style={{ color: INK, fontWeight: 600 }}>{m.value}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        <View style={{ height: 2, backgroundColor: ACCENT, marginTop: 8, marginBottom: 8 }} />
        <Text style={{ fontSize: 7, color: MUTED, marginBottom: 4 }}>{model.amountsNote}</Text>

        {/* Posts */}
        <View style={{ borderWidth: 0.75, borderColor: LINE, borderRadius: 4 }}>
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: SOFT,
              paddingVertical: 5,
              borderBottomWidth: 0.75,
              borderBottomColor: LINE,
            }}
          >
            {model.columns.map((label, i) => (
              <Text
                key={label}
                style={sx(
                  { fontSize: 6.5, color: MUTED, fontWeight: 600 },
                  i === 0 ? { width: POST_WIDTH, paddingHorizontal: 6 } : amount(),
                )}
              >
                {label}
              </Text>
            ))}
          </View>
          {model.rows.map((row, r) => (
            <View
              key={r}
              wrap={false}
              style={{
                flexDirection: 'row',
                paddingVertical: 5,
                borderBottomWidth: 0.5,
                borderBottomColor: LINE,
              }}
            >
              <View style={{ width: POST_WIDTH, paddingHorizontal: 6 }}>
                <Text style={{ color: INK, fontWeight: 600 }}>{row.title}</Text>
                <Text style={{ fontSize: 6.5, color: MUTED, marginTop: 1 }}>{row.subtitle}</Text>
              </View>
              {row.cells.map((cell, i) => (
                <Text key={i} style={amount(i === row.cells.length - 1)}>
                  {cell}
                </Text>
              ))}
            </View>
          ))}
          <View style={{ flexDirection: 'row', paddingVertical: 5, backgroundColor: SOFT }}>
            <Text style={{ width: POST_WIDTH, paddingHorizontal: 6, fontWeight: 700, color: INK }}>
              {model.totals.label}
            </Text>
            <Text style={amount(true)}>{model.totals.cells[0]}</Text>
            {/* The amounts per person don't add up across posts. */}
            <Text style={{ flex: 9 }}> </Text>
            <Text style={amount(true)}>{model.totals.cells[1]}</Text>
          </View>
        </View>

        {/* Totals and warnings */}
        <View style={{ flexDirection: 'row', marginTop: 12, justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            {model.warnings.map((w, i) => (
              <Text key={i} style={{ color: WARN, marginBottom: 3, lineHeight: 1.35 }}>
                {`• ${w}`}
              </Text>
            ))}
          </View>
          <View style={{ width: 260, borderWidth: 0.75, borderColor: LINE, borderRadius: 4 }}>
            {model.summary.map((s) => (
              <View
                key={s.label}
                style={sx(
                  {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                  },
                  s.strong && { backgroundColor: SOFT },
                )}
              >
                <Text style={sx({ color: MUTED }, s.strong && { color: INK, fontWeight: 700 })}>
                  {s.label}
                </Text>
                <Text style={sx(TNUM, { color: INK }, s.strong && { fontWeight: 700 })}>
                  {s.value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View
          fixed
          style={{
            position: 'absolute',
            left: 32,
            right: 32,
            bottom: 18,
            borderTopWidth: 0.5,
            borderTopColor: LINE,
            paddingTop: 5,
          }}
        >
          <Text style={{ fontSize: 6.5, color: MUTED }}>{model.footer}</Text>
        </View>
      </DirectionProvider>
    </Page>
  );
}

/** The cost sheet as a react-pdf document. */
export function costingDocument(model: CostingSheetModel): ReactElement<DocumentProps> {
  return (
    <Document title={model.title} creator={APP_NAME} producer={APP_NAME}>
      <CostingPage model={model} />
    </Document>
  );
}

/**
 * Renders the cost sheet to a PDF on the page (the shared worker only knows
 * invoice templates); the page loads this module and the fonts on first use.
 */
export async function renderCostingPdf(model: CostingSheetModel): Promise<Blob> {
  await import('./buffer-shim');
  const [{ pdf }, { registerFonts }, fonts] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./fonts'),
    import('./font-urls'),
  ]);
  registerFonts(COSTING_FONTS, fonts.resolveFontUrl);
  return pdf(costingDocument(model)).toBlob();
}
