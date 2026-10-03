import type { ReactElement } from 'react';
import { Document, Page, type DocumentProps } from '@react-pdf/renderer';
import type { Style } from '@react-pdf/types';
import { APP_NAME } from '@/lib/brand';
import { readableOn, textSafe, tint } from '@/lib/color';
import { FONT_FAMILIES } from '../fonts';
import { DirectionProvider, Image, Text, View, sx } from '../templates/primitives';
import type { Phrase, StatementRenderModel } from './model';

/**
 * A statement of account on A4: letterhead, the customer and an account
 * summary, every transaction with a running balance, aging, cheques not yet
 * cleared, the balance in words, and room for the stamp, the signature and
 * the customer's confirmation. Laid out left to right and mirrored for
 * Arabic by the direction-aware primitives.
 */

const INK = '#0f172a';
const BODY = '#1e293b';
const MUTED = '#64748b';
const FAINT = '#94a3b8';
const LINE = '#e2e8f0';
const SOFT = '#f8fafc';
const TNUM: Style = { fontFeatureSettings: ['tnum'] };

/** Fonts a statement needs (the Arabic one is the fallback for Arabic letters). */
export const STATEMENT_FONTS = ['inter', 'plexarabic'] as const;

const COLUMNS = {
  date: { width: 52 },
  description: { flex: 1 },
  reference: { width: 92 },
  dueDate: { width: 50 },
  debit: { width: 62 },
  credit: { width: 62 },
  balance: { width: 68 },
} satisfies Record<keyof StatementRenderModel['columns'], Style>;

const AMOUNT_COLUMNS = new Set(['debit', 'credit', 'balance']);

function Words({
  phrase,
  style,
  secondaryStyle,
}: {
  phrase: Phrase;
  style?: Style;
  secondaryStyle?: Style;
}) {
  return (
    <View>
      <Text style={style}>{phrase.text}</Text>
      {phrase.secondary ? (
        <Text style={sx({ fontSize: 6.5, color: FAINT, marginTop: 1 }, secondaryStyle)}>
          {phrase.secondary}
        </Text>
      ) : null}
    </View>
  );
}

function StatementPage({ model }: { model: StatementRenderModel }) {
  const accent = model.accent;
  const accentText = textSafe(accent);
  const soft = tint(accent, 0.92);
  const onAccent = readableOn(accent);
  const font = FONT_FAMILIES.inter.family;
  const page = sx({
    fontFamily: font,
    fontSize: 8.5,
    color: BODY,
    paddingTop: 34,
    paddingBottom: 58,
    paddingHorizontal: 36,
    textAlign: model.dir === 'rtl' ? 'right' : 'left',
  });
  const cell = (key: keyof typeof COLUMNS, extra?: Style): Style =>
    sx(
      COLUMNS[key],
      { paddingHorizontal: 4 },
      AMOUNT_COLUMNS.has(key) && { textAlign: 'right' },
      extra,
    );
  const headerKeys = Object.keys(COLUMNS) as (keyof typeof COLUMNS)[];

  return (
    <Page size="A4" style={page}>
      <DirectionProvider dir={model.dir} font={font}>
        {/* Letterhead */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <View style={{ flex: 1, paddingRight: 24 }}>
            {model.company.logo ? (
              <Image
                src={model.company.logo}
                style={{
                  height: 42,
                  width: 150,
                  objectFit: 'contain',
                  objectPositionX: 0,
                  marginBottom: 8,
                }}
              />
            ) : null}
            <Text style={{ fontSize: 13, fontWeight: 700, color: INK }}>{model.company.name}</Text>
            {model.company.nameSecondary ? (
              <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 1 }}>
                {model.company.nameSecondary}
              </Text>
            ) : null}
            {model.company.lines.map((line, i) => (
              <Text key={i} style={{ fontSize: 7.5, color: MUTED, marginTop: 2, lineHeight: 1.35 }}>
                {line}
              </Text>
            ))}
          </View>
          <View style={{ width: 210, alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 20, fontWeight: 700, color: accentText }}>
              {model.title.text}
            </Text>
            {model.title.secondary ? (
              <Text style={{ fontSize: 9, color: MUTED, marginTop: 1 }}>
                {model.title.secondary}
              </Text>
            ) : null}
            <View style={{ marginTop: 8, width: 210 }}>
              {model.meta.map((m) => (
                <View
                  key={m.label.text}
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 1.5,
                  }}
                >
                  <Text style={{ fontSize: 7.5, color: MUTED }}>
                    {m.label.secondary ? `${m.label.text} · ${m.label.secondary}` : m.label.text}
                  </Text>
                  <Text style={sx(TNUM, { fontSize: 7.5, color: INK, fontWeight: 600 })}>
                    {m.value}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
        <View style={{ height: 2, backgroundColor: accent, marginTop: 10, marginBottom: 12 }} />

        {/* Customer and summary */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Words
              phrase={model.contact.label}
              style={{ fontSize: 7, color: MUTED, fontWeight: 600 }}
              secondaryStyle={{ fontSize: 6 }}
            />
            <Text style={{ fontSize: 11.5, fontWeight: 700, color: INK, marginTop: 4 }}>
              {model.contact.name}
            </Text>
            {model.contact.nameSecondary ? (
              <Text style={{ fontSize: 8.5, color: MUTED, marginTop: 1 }}>
                {model.contact.nameSecondary}
              </Text>
            ) : null}
            {model.contact.lines.map((line, i) => (
              <Text key={i} style={{ fontSize: 7.5, color: MUTED, marginTop: 2, lineHeight: 1.35 }}>
                {line}
              </Text>
            ))}
          </View>
          <View style={{ width: 230, borderWidth: 0.75, borderColor: LINE, borderRadius: 6 }}>
            <View style={{ paddingHorizontal: 10, paddingTop: 7, paddingBottom: 3 }}>
              <Words
                phrase={model.summaryTitle}
                style={{ fontSize: 8, fontWeight: 700, color: INK }}
              />
            </View>
            {model.summary.map((row) => (
              <View
                key={row.label.text}
                style={sx(
                  {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                  },
                  row.strong && {
                    backgroundColor: soft,
                    borderBottomLeftRadius: 6,
                    borderBottomRightRadius: 6,
                    paddingVertical: 6,
                    marginTop: 2,
                  },
                )}
              >
                <Words
                  phrase={row.label}
                  style={{
                    fontSize: row.strong ? 9 : 8,
                    fontWeight: row.strong ? 700 : 400,
                    color: row.strong ? accentText : MUTED,
                  }}
                />
                <Text
                  style={sx(TNUM, {
                    fontSize: row.strong ? 11 : 8.5,
                    fontWeight: row.strong ? 700 : 500,
                    color: row.strong ? accentText : INK,
                  })}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Transactions */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: accent,
            borderRadius: 3,
            paddingVertical: 5,
          }}
        >
          {headerKeys.map((key) => (
            <View key={key} style={cell(key)}>
              <Text
                style={sx(
                  { fontSize: 7.5, fontWeight: 700, color: onAccent },
                  AMOUNT_COLUMNS.has(key) && { textAlign: 'right' },
                )}
              >
                {model.columns[key].text}
              </Text>
              {model.columns[key].secondary ? (
                <Text
                  style={sx(
                    { fontSize: 6, color: onAccent, opacity: 0.85, marginTop: 1 },
                    AMOUNT_COLUMNS.has(key) && { textAlign: 'right' },
                  )}
                >
                  {model.columns[key].secondary}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: SOFT,
            paddingVertical: 5,
            borderBottomWidth: 0.5,
            borderBottomColor: LINE,
          }}
          wrap={false}
        >
          <View style={cell('date')} />
          <View style={cell('description')}>
            <Words
              phrase={model.opening.label}
              style={{ fontSize: 8, fontWeight: 600, color: INK }}
            />
          </View>
          <View style={cell('reference')} />
          <View style={cell('dueDate')} />
          <View style={cell('debit')} />
          <View style={cell('credit')} />
          <Text style={sx(cell('balance'), TNUM, { fontWeight: 600, color: INK })}>
            {model.opening.balance}
          </Text>
        </View>
        {model.rows.map((row, i) => (
          <View
            key={row.key}
            wrap={false}
            style={sx(
              {
                flexDirection: 'row',
                paddingVertical: 3.5,
                borderBottomWidth: 0.5,
                borderBottomColor: LINE,
              },
              i % 2 === 1 && { backgroundColor: '#fcfcfd' },
            )}
          >
            <Text style={sx(cell('date'), TNUM, { fontSize: 7.5 })}>{row.date}</Text>
            <View style={cell('description')}>
              <Words phrase={row.title} style={{ fontSize: 8, color: row.muted ? MUTED : INK }} />
            </View>
            <Text style={sx(cell('reference'), { fontSize: 7.5, color: MUTED })}>
              {row.reference}
            </Text>
            <Text style={sx(cell('dueDate'), TNUM, { fontSize: 7.5, color: MUTED })}>
              {row.dueDate}
            </Text>
            <Text style={sx(cell('debit'), TNUM, { color: row.muted ? MUTED : BODY })}>
              {row.debit}
            </Text>
            <Text style={sx(cell('credit'), TNUM, { color: row.muted ? MUTED : BODY })}>
              {row.credit}
            </Text>
            <Text style={sx(cell('balance'), TNUM, { fontWeight: 600, color: INK })}>
              {row.balance}
            </Text>
          </View>
        ))}
        {model.empty ? (
          <View style={{ paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: LINE }}>
            <Words
              phrase={model.empty}
              style={{ fontSize: 8, color: MUTED, textAlign: 'center' }}
              secondaryStyle={{ textAlign: 'center' }}
            />
          </View>
        ) : null}
        <View
          wrap={false}
          style={{
            flexDirection: 'row',
            paddingVertical: 6,
            borderTopWidth: 1.25,
            borderTopColor: accent,
            backgroundColor: soft,
          }}
        >
          <View style={cell('date')} />
          <View style={cell('description')}>
            <Words
              phrase={model.closing.label}
              style={{ fontSize: 8.5, fontWeight: 700, color: INK }}
            />
          </View>
          <View style={cell('reference')} />
          <View style={cell('dueDate')} />
          <Text style={sx(cell('debit'), TNUM, { fontWeight: 600 })}>{model.closing.debit}</Text>
          <Text style={sx(cell('credit'), TNUM, { fontWeight: 600 })}>{model.closing.credit}</Text>
          <Text style={sx(cell('balance'), TNUM, { fontWeight: 700, color: accentText })}>
            {model.closing.balance}
          </Text>
        </View>

        {/* Aging */}
        <View wrap={false} style={{ marginTop: 16 }}>
          <Words phrase={model.aging.title} style={{ fontSize: 9, fontWeight: 700, color: INK }} />
          <View
            style={{
              flexDirection: 'row',
              marginTop: 5,
              borderWidth: 0.75,
              borderColor: LINE,
              borderRadius: 4,
            }}
          >
            {model.aging.headers.map((header, i) => {
              const last = i === model.aging.headers.length - 1;
              return (
                <View
                  key={header.text}
                  style={sx(
                    { flex: 1, paddingVertical: 5, paddingHorizontal: 6 },
                    !last && { borderRightWidth: 0.75, borderRightColor: LINE },
                    last && { backgroundColor: soft },
                  )}
                >
                  <Words
                    phrase={header}
                    style={{ fontSize: 7, color: MUTED, textAlign: 'center' }}
                    secondaryStyle={{ textAlign: 'center' }}
                  />
                  <Text
                    style={sx(TNUM, {
                      fontSize: 8.5,
                      fontWeight: last ? 700 : 500,
                      color: last ? accentText : INK,
                      textAlign: 'center',
                      marginTop: 3,
                    })}
                  >
                    {model.aging.values[i]}
                  </Text>
                </View>
              );
            })}
          </View>
          {model.aging.unapplied ? (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 }}>
              <Text style={{ fontSize: 7.5, color: MUTED }}>
                {model.aging.unapplied.label.secondary
                  ? `${model.aging.unapplied.label.text} · ${model.aging.unapplied.label.secondary}`
                  : model.aging.unapplied.label.text}
              </Text>
              <Text style={sx(TNUM, { fontSize: 7.5, color: INK, marginLeft: 8 })}>
                {model.aging.unapplied.value}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Cheques not yet cleared */}
        {model.cheques ? (
          <View wrap={false} style={{ marginTop: 14 }}>
            <Words
              phrase={model.cheques.title}
              style={{ fontSize: 9, fontWeight: 700, color: INK }}
            />
            <Words
              phrase={model.cheques.note}
              style={{ fontSize: 7, color: MUTED, marginTop: 2 }}
            />
            <View style={{ marginTop: 5, borderTopWidth: 0.75, borderTopColor: LINE }}>
              <View
                style={{
                  flexDirection: 'row',
                  paddingVertical: 4,
                  borderBottomWidth: 0.5,
                  borderBottomColor: LINE,
                }}
              >
                {model.cheques.headers.map((h, i) => (
                  <View
                    key={h.text}
                    style={sx(
                      { flex: 1, paddingHorizontal: 4 },
                      i === 3 && { alignItems: 'flex-end' },
                    )}
                  >
                    <Words
                      phrase={h}
                      style={sx(
                        { fontSize: 7, color: MUTED, fontWeight: 600 },
                        i === 3 && { textAlign: 'right' },
                      )}
                    />
                  </View>
                ))}
              </View>
              {model.cheques.rows.map((row) => (
                <View
                  key={row.key}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: 4,
                    borderBottomWidth: 0.5,
                    borderBottomColor: LINE,
                  }}
                >
                  {row.cells.map((value, i) => (
                    <Text
                      key={i}
                      style={sx(
                        { flex: 1, paddingHorizontal: 4, fontSize: 8 },
                        TNUM,
                        i === 3 && { textAlign: 'right' },
                      )}
                    >
                      {value}
                    </Text>
                  ))}
                </View>
              ))}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 4,
                  paddingHorizontal: 4,
                }}
              >
                <Words
                  phrase={model.cheques.total.label}
                  style={{ fontSize: 8, fontWeight: 700, color: INK }}
                />
                <Text style={sx(TNUM, { fontSize: 8.5, fontWeight: 700, color: INK })}>
                  {model.cheques.total.value}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* Retention, balance in words and payment details */}
        <View wrap={false} style={{ marginTop: 14 }}>
          {model.retention ? (
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: SOFT,
                borderRadius: 4,
                paddingHorizontal: 10,
                paddingVertical: 6,
                marginBottom: 8,
              }}
            >
              <Words
                phrase={model.retention.label}
                style={{ fontSize: 8, color: BODY, fontWeight: 600 }}
              />
              <Text style={sx(TNUM, { fontSize: 9, fontWeight: 700, color: INK })}>
                {model.retention.value}
              </Text>
            </View>
          ) : null}
          {model.words.map((line, i) => (
            <Text
              key={i}
              style={{
                fontSize: 8,
                color: BODY,
                fontWeight: i === 0 ? 600 : 400,
                marginBottom: 2,
                lineHeight: 1.4,
              }}
            >
              {line}
            </Text>
          ))}
          {model.bankDetails ? (
            <View style={{ marginTop: 6 }}>
              <Words
                phrase={model.bankDetails.label}
                style={{ fontSize: 7.5, color: MUTED, fontWeight: 600 }}
              />
              <Text style={{ fontSize: 7.5, color: BODY, marginTop: 2, lineHeight: 1.4 }}>
                {model.bankDetails.text}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Confirmation and signatures */}
        <View wrap={false} style={{ marginTop: 14 }}>
          <View
            style={{
              borderLeftWidth: 2,
              borderLeftColor: accent,
              paddingLeft: 8,
              paddingVertical: 2,
            }}
          >
            <Words
              phrase={model.note}
              style={{ fontSize: 7.5, color: BODY, lineHeight: 1.45 }}
              secondaryStyle={{ fontSize: 6.5, lineHeight: 1.4 }}
            />
          </View>
          <View style={{ flexDirection: 'row', marginTop: 18 }}>
            <View style={{ flex: 1, paddingRight: 28 }}>
              <View style={{ height: 44, flexDirection: 'row', alignItems: 'flex-end' }}>
                {model.company.signature ? (
                  <Image
                    src={model.company.signature}
                    style={{ height: 40, width: 110, objectFit: 'contain', objectPositionX: 0 }}
                  />
                ) : null}
                {model.company.stamp ? (
                  <Image
                    src={model.company.stamp}
                    style={{
                      height: 44,
                      width: 70,
                      objectFit: 'contain',
                      objectPositionX: 0,
                      marginLeft: 6,
                    }}
                  />
                ) : null}
              </View>
              <View
                style={{ borderTopWidth: 0.75, borderTopColor: FAINT, marginTop: 4, paddingTop: 4 }}
              >
                <Words phrase={model.signatures.company} style={{ fontSize: 7.5, color: MUTED }} />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ height: 44 }} />
              <View
                style={{ borderTopWidth: 0.75, borderTopColor: FAINT, marginTop: 4, paddingTop: 4 }}
              >
                <Words phrase={model.signatures.contact} style={{ fontSize: 7.5, color: MUTED }} />
              </View>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View
          fixed
          style={{
            position: 'absolute',
            left: 36,
            right: 36,
            bottom: 24,
            flexDirection: 'row',
            justifyContent: 'space-between',
            borderTopWidth: 0.5,
            borderTopColor: LINE,
            paddingTop: 6,
          }}
        >
          <Text style={{ fontSize: 7, color: FAINT, flex: 1 }}>{model.footer}</Text>
        </View>
        <Text
          fixed
          style={{
            position: 'absolute',
            right: 36,
            bottom: 24,
            width: 140,
            fontSize: 7,
            color: FAINT,
            textAlign: 'right',
          }}
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `${model.page.text} ${pageNumber} ${model.of.text} ${totalPages}` : ''
          }
        />
      </DirectionProvider>
    </Page>
  );
}

/** One PDF with a statement per model (a batch prints one after another). */
export function statementDocument(models: StatementRenderModel[]): ReactElement<DocumentProps> {
  const first = models[0];
  return (
    <Document
      title={models.length === 1 ? first.documentTitle : first.title.secondary || first.title.text}
      author={first.company.name}
      creator={APP_NAME}
      producer={APP_NAME}
      language={first.dir === 'rtl' ? 'ar' : 'en'}
    >
      {models.map((model, i) => (
        <StatementPage key={i} model={model} />
      ))}
    </Document>
  );
}
